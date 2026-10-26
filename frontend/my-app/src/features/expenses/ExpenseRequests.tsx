import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ExternalLink, LoaderCircle, Plus, RefreshCw, X } from 'lucide-react'
import type { Category } from '@/features/categories/types'
import { loadProjectCatalog } from '@/features/projects/api'
import type { ProjectCatalog } from '@/features/projects/use-project-catalog'
import { listAccessibleWorkspaces } from '@/features/workspaces/api'
import { authAccountId } from '@/features/workspaces/workspace-state'
import { updateExpenseRequest, deleteExpenseRequest, createExpenseRequest, decideExpenseRequest, listExpenseCategories, listExpenseAccounts, listExpenseRequests, type ExpenseAccount, type ExpenseRequest } from './api'

const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4] disabled:opacity-50'
const field = 'h-11 w-full rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm text-[#193f33] focus-visible:outline-2 focus-visible:outline-[#193f33]'
const euro = (amount: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amount)

export function ExpenseRequests({ workspaceId, onConnect, catalog, onApproved }: {
  workspaceId?: number; onConnect: (id: number) => void; catalog: ProjectCatalog
  onApproved: (expense: ExpenseRequest, labels: { categoryName: string; departmentName: string; projectName: string }) => void
}) {
  const { t } = useTranslation('finance')
  const [rows, setRows] = useState<ExpenseRequest[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<ExpenseAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ExpenseRequest | null>(null)
  const [withdrawing, setWithdrawing] = useState<ExpenseRequest | null>(null)
  const userId = authAccountId()
  const canModify = (item?: ExpenseRequest) => item?.status === 'PENDING' && item.submitted_by === userId
  const [memberRole, setMemberRole] = useState<'OWNER' | 'EMPLOYEE' | null>(null)
  const canReview = memberRole === 'OWNER'

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (workspaceId === undefined) return
    setLoading(true); setError('')
    try {
      const [items, categoryItems, memberships] = await Promise.all([listExpenseRequests(workspaceId, signal), listExpenseCategories(workspaceId, signal), listAccessibleWorkspaces(signal)])
      const membership = memberships.find(item => item.id === workspaceId && item.type === 'BUSINESS')
      if (!membership) throw new Error('This Business workspace is not available to your account.')
      const accountItems = membership.role === 'OWNER' ? await listExpenseAccounts(workspaceId, signal) : []
      if (!signal?.aborted) { setRows(items); setCategories(categoryItems.filter(item => item.type === 'expense')); setMemberRole(membership.role); setAccounts(accountItems); setAccountId(accountItems.length === 1 ? String(accountItems[0].account_id) : '') }
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not load expense requests.') }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [workspaceId])
  useEffect(() => {
    if (workspaceId === undefined) return
    const activeWorkspaceId: number = workspaceId
    const controller = new AbortController()
    async function load() {
      try {
        const [items, categoryItems, memberships] = await Promise.all([listExpenseRequests(activeWorkspaceId, controller.signal), listExpenseCategories(activeWorkspaceId, controller.signal), listAccessibleWorkspaces(controller.signal)])
        const membership = memberships.find(item => item.id === activeWorkspaceId && item.type === 'BUSINESS')
        if (!membership) throw new Error('This Business workspace is not available to your account.')
        const accountItems = membership.role === 'OWNER' ? await listExpenseAccounts(activeWorkspaceId, controller.signal) : []
        if (!controller.signal.aborted) { setRows(items); setCategories(categoryItems.filter(item => item.type === 'expense')); setMemberRole(membership.role); setAccounts(accountItems); setAccountId(accountItems.length === 1 ? String(accountItems[0].account_id) : ''); setError('') }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load expense requests.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [workspaceId])

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = Number(workspaceInput)
    if (!Number.isSafeInteger(id) || id < 1 || connecting) return
    setConnecting(true); setError('')
    try {
      const [memberships] = await Promise.all([listAccessibleWorkspaces(), listExpenseCategories(id), loadProjectCatalog(id)])
      const membership = memberships.find(item => item.id === id && item.type === 'BUSINESS')
      if (!membership) throw new Error('This Business workspace is not available to your account.')
      setMemberRole(membership.role)
      onConnect(id)
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not connect this workspace.') }
    finally { setConnecting(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (workspaceId === undefined || saving) return
    if (editing && !canModify(rows.find(item => item.id === editing.id))) { setError('Only your own pending requests can be edited.'); return }
    const data = new FormData(event.currentTarget)
    const amount = Number(data.get('amount'))
    const categoryId = Number(data.get('category_id'))
    const description = String(data.get('description') || '').trim()
    if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99 || !categories.some(item => item.id === categoryId) || !description) { setError('Enter a valid amount, category and description.'); return }
    setSaving(true); setError('')
    try {
      const input = {
        amount, currency: editing?.currency ?? 'EUR', description, category_id: categoryId,
        department_id: Number(data.get('department_id')) || undefined, project_id: Number(data.get('project_id')) || undefined,
        receipt_url: String(data.get('receipt_url') || '').trim() || undefined,
      }
      const saved = editing ? await updateExpenseRequest(workspaceId, editing.id, input) : await createExpenseRequest(workspaceId, input)
      setRows(previous => editing ? previous.map(item => item.id === saved.id ? saved : item) : [saved, ...previous])
      setNotice(editing ? 'Expense request updated.' : 'Expense request submitted.'); setShowForm(false); setEditing(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not submit your request.') }
    finally { setSaving(false) }
  }
  async function withdraw() {
    if (workspaceId === undefined || saving || !withdrawing) return
    if (!canModify(rows.find(item => item.id === withdrawing.id))) { setError('Only your own pending requests can be withdrawn.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      await deleteExpenseRequest(workspaceId, withdrawing.id)
      setRows(previous => previous.filter(item => item.id !== withdrawing.id))
      setWithdrawing(null); setNotice('Expense request withdrawn.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not withdraw your request.') }
    finally { setSaving(false) }
  }
  async function decide(id: number, decision: 'approve' | 'reject') {
    if (workspaceId === undefined || saving) return
    setSaving(true); setError('')
    try {
      const updated = await decideExpenseRequest(workspaceId, id, decision, decision === 'approve' ? Number(accountId) : undefined)
      setRows(previous => previous.map(item => item.id === updated.id ? updated : item))
      if (decision === 'approve') onApproved(updated, {
        categoryName: categories.find(category => category.id === updated.category_id)?.name || f('Expense'),
        departmentName: catalog.departments.find(department => department.id === updated.department_id)?.name || f('No department'),
        projectName: catalog.projects.find(project => project.id === updated.project_id)?.name || f('No project'),
      })
      setNotice(decision === 'approve' ? 'Expense approved and added to transaction history.' : 'Expense request rejected.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not review this expense request.') }
    finally { setSaving(false) }
  }

  return <section aria-label={f("Business expense requests")} className="rounded-2xl bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[22px] font-semibold!">{f("Expense requests")}</h2><p className="mt-2 text-sm text-[#627168]">{f("Submit expenses for review and follow their status.")}</p></div>{workspaceId !== undefined && <div className="flex gap-2"><button disabled={loading || saving} onClick={() => void refresh()} aria-label={f("Refresh expense requests")} className={secondary}><RefreshCw size={16} />{f("Refresh")}</button><button disabled={saving} onClick={() => { setEditing(null); setWithdrawing(null); setError(''); setNotice(''); setShowForm(value => !value) }} className={primary}><Plus size={16} />{showForm ? f("Close form") : f("Submit expense")}</button></div>}</div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{f(error, true)}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-[#eaf0e5] p-4 text-sm">{f(notice)}</p>}
    {workspaceId === undefined ? <KeyboardForm onSubmit={connect} className="mt-6 grid max-w-lg gap-3"><p className="text-sm text-[#627168]">{f("Connect the existing Business workspace that stores the requests. You can also connect it from Projects.")}</p><label className="grid gap-2 text-sm">{f("Workspace ID")}<input className={field} type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} value={workspaceInput} onChange={event => setWorkspaceInput(event.target.value)} required /></label><button disabled={connecting} className={`${primary} justify-self-start`}>{connecting && <LoaderCircle size={16} className="animate-spin" />}{connecting ? f("Checking access…") : f("Connect workspace")}</button></KeyboardForm> : <>
      {showForm && (!editing || canModify(rows.find(item => item.id === editing.id))) && <KeyboardForm key={editing?.id ?? 'new'} onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border border-[#dce4d8] bg-[#f9faf6] p-5 sm:grid-cols-2" aria-label={editing ? f("Edit expense request") : f("Submit expense request")}>
        <label className="grid gap-2 text-sm">{editing && editing.currency !== 'EUR' ? t('amountCurrency', { currency: editing.currency }) : f("Amount (€)")}<input className={field} name="amount" defaultValue={editing?.amount} type="number" min="0.01" max="99999999.99" step="0.01" placeholder="0.00" required /></label>
        <label className="grid gap-2 text-sm">{f("Category")}<select className={field} name="category_id" defaultValue={editing?.category_id ?? ""} required><option value="" disabled>{f("Select a category")}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-2 text-sm">{f("Department")}<select className={field} name="department_id" defaultValue={editing?.department_id ?? ""}><option value="">{f("My assigned department")}</option>{catalog.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-2 text-sm">{f("Project")}<select className={field} name="project_id" defaultValue={editing?.project_id ?? ""}><option value="">{f("No project")}</option>{catalog.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-2 text-sm sm:col-span-2">{f("Description")}<input className={field} name="description" defaultValue={editing?.description ?? ""} maxLength={255} required placeholder={f("What was this expense for?")} /></label>
        <label className="grid gap-2 text-sm sm:col-span-2">{f("Receipt URL")} <span className="text-xs text-[#627168]">{f("Optional for now. Add a shareable link to the receipt.")}</span><input className={field} name="receipt_url" defaultValue={editing?.receipt_url ?? ""} type="url" maxLength={255} placeholder="https://…" /></label>
        <div className="flex justify-end gap-2 sm:col-span-2"><button disabled={saving} type="button" onClick={() => { setShowForm(false); setEditing(null) }} className={secondary}>{f("Cancel")}</button><button disabled={saving || !categories.length} className={primary}>{saving && <LoaderCircle size={16} className="animate-spin" />}{editing ? f("Save changes") : f("Submit request")}</button></div>
      </KeyboardForm>}
      {withdrawing && canModify(rows.find(item => item.id === withdrawing.id)) && <div role="group" aria-label={f("Confirm withdrawal")} className="mt-5 rounded-xl bg-[#fae8e5] p-4">
        <p className="text-sm">{t('withdrawDescription', { name: withdrawing.description })}</p>
        <div className="mt-3 flex gap-2"><button disabled={saving} onClick={() => void withdraw()} className={primary}>{f("Withdraw request")}</button><button disabled={saving} onClick={() => setWithdrawing(null)} className={secondary}>{f("Cancel withdrawal")}</button></div>
      </div>}
      {loading && <p role="status" className="mt-6 text-sm text-[#627168]">{f("Loading expense requests…")}</p>}
      {!loading && !error && rows.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-[#dce4d8] px-5 py-10 text-center text-sm text-[#627168]">{f("No expense requests yet.")}</p>}
      {canReview && rows.some(item => item.status === 'PENDING') && <div className="mt-5 max-w-sm"><label className="grid gap-2 text-sm">{f("Account for approvals")}<select className={field} value={accountId} onChange={event => setAccountId(event.target.value)} required><option value="" disabled>{f("Select an account")}</option>{accounts.map(account => <option key={account.account_id} value={account.account_id}>{account.name} · {account.currency}</option>)}</select></label>{accounts.length === 0 && <p role="status" className="mt-2 text-xs text-[#627168]">{f("Add a business account before approving expense requests.")}</p>}</div>}
      <ul aria-label={f("Expense request list")} className="mt-5 grid gap-3">{rows.map(item => {
        const categoryName = categories.find(category => category.id === item.category_id)?.name || f("Expense")
        const departmentName = catalog.departments.find(department => department.id === item.department_id)?.name || f("No department")
        const projectName = catalog.projects.find(project => project.id === item.project_id)?.name || f("No project")
        const status = t(item.status.toLowerCase())
        return <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e5df] p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.description}</strong><span className={`rounded-full px-3 py-1 text-xs capitalize ${item.status === 'APPROVED' ? 'bg-[#eaf0e6] text-[#486c43]' : item.status === 'REJECTED' ? 'bg-[#fae8e5] text-[#a43b32]' : 'bg-[#fff3d6] text-[#8a6200]'}`}>{f(status)}</span></div><p className="mt-1 text-xs text-[#627168]">{categoryName} · {departmentName} · {projectName} · {t('submittedBy', { id: item.submitted_by })}</p><p className="mt-1 text-xs text-[#627168]">{new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(item.created_at))}{item.receipt_url && <> · <a className="inline-flex items-center gap-1 text-[#193f33] underline" href={item.receipt_url} target="_blank" rel="noreferrer">{f("Receipt")} <ExternalLink size={12} /></a></>}</p></div><div className="flex items-center gap-2"><strong className="mr-2 whitespace-nowrap text-sm tabular-nums">{euro(item.amount, item.currency)}</strong>{canModify(item) && <><button disabled={saving} aria-label={t('editNamed', { name: item.description })} onClick={() => { setEditing(item); setWithdrawing(null); setError(''); setNotice(''); setShowForm(true) }} className={secondary}>{f("Edit")}</button><button disabled={saving} aria-label={t('withdrawNamed', { name: item.description })} onClick={() => { setWithdrawing(item); setShowForm(false); setEditing(null); setError(''); setNotice('') }} className={secondary}>{f("Withdraw")}</button></>}{canReview && item.status === 'PENDING' && <><button disabled={saving || !accountId} aria-label={t('approveNamed', { name: item.description })} onClick={() => void decide(item.id, 'approve')} className="rounded-lg p-2 text-[#486c43] hover:bg-[#eaf0e6] disabled:opacity-50"><Check size={18} /></button><button disabled={saving} aria-label={t('rejectNamed', { name: item.description })} onClick={() => void decide(item.id, 'reject')} className="rounded-lg p-2 text-[#a43b32] hover:bg-[#fae8e5] disabled:opacity-50"><X size={18} /></button></>}</div></li>
      })}</ul>
    </>}
  </section>
}
