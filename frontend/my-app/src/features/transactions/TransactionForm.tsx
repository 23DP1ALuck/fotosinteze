import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useMemo, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { X } from 'lucide-react'
import type { Category, CategoryType } from '@/features/categories/types'
import type { ProjectCatalog } from '@/features/projects/use-project-catalog'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { saveTransaction, type ApiTransaction, type TransactionAccount } from './api'

export type TransactionOptions = { accounts: TransactionAccount[]; categories: Category[]; loading: boolean; error: string; retry: () => void }
const field = 'mt-2 w-full rounded-xl border border-[#dce4d8] bg-[#f7f8f2] px-3 py-3 font-normal outline-none focus:border-[#82965b] focus:ring-2 focus:ring-[#82965b]/20'
const button = 'rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const schema = z.object({
  amount: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount up to 99,999,999.99 with at most 2 decimal places').refine(value => Number(value) > 0, 'Amount must be greater than zero'),
  description: z.string().trim().max(255, 'Use 255 characters or fewer'),
  transaction_type: z.enum(['', 'income', 'expense']), account_id: z.string(), category_id: z.string(), department_id: z.string(), project_id: z.string(),
})
type Values = z.infer<typeof schema>

export function TransactionForm({ workspaceId, type, transaction, options, catalog, role = 'OWNER', onClose, onSaved }: {
  workspaceId: number; type: CategoryType; transaction?: ApiTransaction; options: TransactionOptions; catalog?: ProjectCatalog; role?: 'OWNER' | 'EMPLOYEE'
  onClose: () => void; onSaved: () => void
}) {
  const client = useQueryClient()
  const ownerId = authAccountId()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const needsType = Boolean(transaction && !options.categories.some(item => item.id === transaction.category_id))
  const accounts = options.accounts.filter(item => item.workspace_id === workspaceId)
  const mainAccountId = accounts.find(item => item.is_main)?.account_id
  const mainAccountApplied = useRef(false)
  const requiresDepartment = Boolean(catalog && role === 'EMPLOYEE')
  const departments = useMemo(() => catalog?.workspaceId === workspaceId ? catalog.departments.filter(item => item.workspace_id === workspaceId) : [], [catalog, workspaceId])
  const validator = schema.superRefine((value, ctx) => {
    if (!accounts.some(item => String(item.account_id) === value.account_id)) ctx.addIssue({ code: 'custom', path: ['account_id'], message: 'Choose an available account' })
    const categoryType = needsType ? value.transaction_type : type
    if (!categoryType) ctx.addIssue({ code: 'custom', path: ['transaction_type'], message: 'Choose income or expense' })
    if (!options.categories.some(item => String(item.id) === value.category_id && item.workspaceId === workspaceId && item.type === categoryType)) ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Choose a category for this transaction type' })
    if (requiresDepartment && !value.department_id) ctx.addIssue({ code: 'custom', path: ['department_id'], message: 'An assigned department is required' })
    if (value.department_id && !departments.some(item => String(item.id) === value.department_id)) ctx.addIssue({ code: 'custom', path: ['department_id'], message: 'Choose an available department' })
    const project = catalog?.projects.find(item => String(item.id) === value.project_id)
    if (value.project_id && (!project || (value.department_id && !project.department_ids.includes(Number(value.department_id))))) ctx.addIssue({ code: 'custom', path: ['project_id'], message: 'Choose a project in the selected department' })
  })
  const { register, trigger, control, handleSubmit, setError, clearErrors, setValue, getValues, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(validator), defaultValues: {
    transaction_type: needsType ? '' : type, amount: transaction?.amount ?? '', description: transaction?.description ?? '', account_id: transaction ? String(transaction.account_id) : mainAccountId ? String(mainAccountId) : '', category_id: transaction?.category_id ? String(transaction.category_id) : '',
    department_id: transaction?.department_id ? String(transaction.department_id) : '', project_id: transaction?.project_id ? String(transaction.project_id) : '',
  } })
  useEffect(() => {
    if (transaction || options.loading || options.error || mainAccountApplied.current) return
    mainAccountApplied.current = true
    if (!getValues('account_id') && mainAccountId) setValue('account_id', String(mainAccountId))
  }, [transaction, options.loading, options.error, mainAccountId, getValues, setValue])
  const [accountId, departmentId, selectedType] = useWatch({ control, name: ['account_id', 'department_id', 'transaction_type'] })
  useEffect(() => {
    if (!catalog || catalog.loading || catalog.error) return
    const valid = departments.some(item => String(item.id) === departmentId)
    const next = valid ? departmentId : requiresDepartment && departments.length === 1 ? String(departments[0].id) : ''
    if (next !== departmentId) setValue('department_id', next)
    const project = catalog.projects.find(item => String(item.id) === getValues('project_id'))
    if (getValues('project_id') && (!project || (next && !project.department_ids.includes(Number(next))))) setValue('project_id', '')
  }, [catalog, departments, departmentId, requiresDepartment, getValues, setValue])
  const effectiveType = needsType ? selectedType || type : type
  const matchingCategories = options.categories.filter(item => item.type === effectiveType && item.workspaceId === workspaceId)
  const account = accounts.find(item => String(item.account_id) === accountId)
  const availableProjects = catalog?.projects.filter(item => !departmentId || item.department_ids.includes(Number(departmentId))) ?? []
  const mutation = useMutation({ mutationFn: (value: Values) => saveTransaction(workspaceId, {
    amount: value.amount, description: value.description || (effectiveType === 'income' ? 'Income' : 'Expense'), currency: account!.currency,
    account_id: Number(value.account_id), category_id: Number(value.category_id), department_id: value.department_id ? Number(value.department_id) : null, project_id: value.project_id ? Number(value.project_id) : null, expense_id: null,
  }, transaction?.transaction_id) })
  useEffect(() => { dialog.current?.showModal() }, [])
  const busy = isSubmitting || mutation.isPending
  const loading = options.loading || Boolean(catalog?.loading)
  const loadError = options.error || catalog?.error
  const locked = transaction?.expense_id != null
  const submit = handleSubmit(async value => {
    clearErrors('root')
    if (busy || locked || loading || loadError) return
    if (authAccountId() !== ownerId || activeWorkspaceId() !== workspaceId) {
      setError('root', { message: 'Your workspace changed. Close this form and try again.' })
      return
    }
    try {
      await mutation.mutateAsync(value)
      if (authAccountId() !== ownerId) return
      await Promise.all(['statistics', 'transactions', 'dashboard', 'accounts', 'budgets', 'business-budgets'].map(feature => client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })))
      if (authAccountId() === ownerId && activeWorkspaceId() === workspaceId) onSaved()
    } catch (error) {
      if (authAccountId() === ownerId && activeWorkspaceId() === workspaceId) setError('root', { message: error instanceof Error ? error.message : 'Could not save the transaction. Please retry.' })
    }
  })
  const title = transaction ? 'Edit transaction' : `Add ${type}`
  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(520px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/40 max-sm:p-5">
    <div className="flex items-center justify-between gap-4"><div><p className="mb-2 text-xs text-[#526259]">{effectiveType === 'income' ? 'Money in' : 'Money out'}</p><h2 id={titleId} className="text-[25px] font-semibold!">{title}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close transaction form" className="rounded-xl p-2 hover:bg-[#eaf0e6]"><X size={20} /></button></div>
    {loading && <p role="status" className="mt-5 text-sm">Loading transaction options…</p>}
    {loadError && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4 text-sm"><p role="alert">{loadError}</p><button type="button" onClick={() => { options.retry(); catalog?.refresh() }} className="mt-3 underline">Retry options</button></div>}
    {!loading && !loadError && (!accounts.length || !matchingCategories.length) && <p role="status" className="mt-5 rounded-xl bg-[#eaf0e6] p-4 text-sm">{!accounts.length ? 'No accounts are available in this workspace. Create an account before adding a transaction.' : `Create an ${effectiveType} category in Categories before adding this transaction.`}</p>}
    {requiresDepartment && !loading && !loadError && !departments.length && <p role="status" className="mt-5 text-sm">Ask your workspace owner to assign you a department before adding transactions.</p>}
    {locked && <p role="alert" className="mt-5 text-sm">Approved expense transactions cannot be edited.</p>}
    <KeyboardForm validateField={trigger} onSubmit={submit} noValidate className="mt-6" aria-busy={busy}>
      <fieldset disabled={busy || loading || Boolean(loadError) || locked} className="grid min-w-0 gap-5 border-0 p-0 disabled:opacity-60">
        {needsType && <label className="text-sm font-medium">Transaction type<select {...register('transaction_type', { onChange: () => setValue('category_id', '') })} className={field}><option value="">Choose income or expense</option><option value="income">Income</option><option value="expense">Expense</option></select>{errors.transaction_type && <span role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.transaction_type.message}</span>}</label>}
        <label className="text-sm font-medium">Account<select {...register('account_id')} aria-invalid={Boolean(errors.account_id)} aria-describedby={errors.account_id ? `${titleId}-account` : undefined} className={field}><option value="">Choose an account</option>{accounts.map(item => <option key={item.account_id} value={item.account_id}>{item.name} · {item.currency}</option>)}</select>{errors.account_id && <span id={`${titleId}-account`} role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.account_id.message}</span>}</label>
        <label className="text-sm font-medium">Amount ({account?.currency ?? transaction?.currency ?? 'EUR'})<input inputMode="decimal" autoComplete="off" placeholder="0.00" {...register('amount')} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? `${titleId}-amount` : undefined} className={`${field} text-xl tabular-nums`} />{errors.amount && <span id={`${titleId}-amount`} role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.amount.message}</span>}</label>
        <label className="text-sm font-medium">Category<select {...register('category_id')} aria-invalid={Boolean(errors.category_id)} aria-describedby={errors.category_id ? `${titleId}-category` : undefined} className={field}><option value="">Choose a category</option>{matchingCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.category_id && <span id={`${titleId}-category`} role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.category_id.message}</span>}</label>
        {catalog && <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1"><label className="text-sm font-medium">Department<select aria-label="Department" {...register('department_id', { onChange: event => { const selected = catalog.projects.find(item => String(item.id) === getValues('project_id')); if (selected && event.target.value && !selected.department_ids.includes(Number(event.target.value))) setValue('project_id', '', { shouldValidate: true }) } })} className={field}><option value="">{requiresDepartment ? 'Choose a department' : 'No department'}</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.department_id && <span role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.department_id.message}</span>}</label><label className="text-sm font-medium">Project<select {...register('project_id')} className={field}><option value="">No project</option>{availableProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.project_id && <span role="alert" className="mt-2 block text-xs text-[#a43b32]">{errors.project_id.message}</span>}</label></div>}
        <div><label className="text-sm font-medium">Description<textarea {...register('description')} maxLength={255} rows={3} placeholder="Add a note (optional)" aria-invalid={Boolean(errors.description)} aria-describedby={`${titleId}-description`} className={`${field} resize-y`} /></label><p id={`${titleId}-description`} className="mt-2 text-xs text-[#526259]">Optional. Uses “{effectiveType === 'income' ? 'Income' : 'Expense'}” when left blank.</p>{errors.description && <p role="alert" className="mt-2 text-xs text-[#a43b32]">{errors.description.message}</p>}</div>
        {errors.root && <p role="alert" className="rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{errors.root.message}</p>}
        <div className="flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" onClick={onClose} className="rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm">Cancel</button><button type="submit" disabled={busy || !accounts.length || !matchingCategories.length || (requiresDepartment && !departments.length)} className={button}>{busy ? 'Saving…' : transaction ? 'Save changes' : `Save ${type}`}</button></div>
      </fieldset>
    </KeyboardForm>
  </dialog>
}
