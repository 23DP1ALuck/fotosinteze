import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useAdminTranslation } from '@/i18n/use-admin-translation'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { deleteCategory, listCategories, saveCategory, verifyCategoryWorkspace } from './api'
import type { Category, CategoryInput, WorkspaceKind } from './types'
import { listAccessibleWorkspaces, type AccessibleWorkspace } from '@/features/workspaces/api'

const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#193f33] px-4 py-3 text-sm text-white transition-colors hover:bg-[#285947] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] transition-colors hover:bg-[#dce6d4] disabled:opacity-50'
const iconButton = 'rounded-lg p-2 text-[#627168] transition-colors hover:bg-[#edf0e8] hover:text-[#193f33] disabled:opacity-50'
const schema = z.object({ name: z.string().trim().min(1, 'Name is required').max(100, 'Use 100 characters or fewer'), type: z.enum(['income', 'expense']) })
type Action = { kind: 'create'; type: Category['type'] } | { kind: 'edit' | 'delete'; category: Category }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
type ConnectionProps = { canManage?: boolean; workspaceKind: WorkspaceKind; workspaceName?: string; workspaceId?: number; onConnect: (id: number | undefined) => void }

function CategoryDialog({ action, categories, workspaceId, onClose, onSaved }: {
  action: Action; categories: Category[]; workspaceId: number; onClose: () => void; onSaved: (category: Category, deleted: boolean) => void
}) {
  const { tr, trError } = useAdminTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const errorId = useId()
  const category = action.kind === 'create' ? undefined : action.category
  const [busy, setBusy] = useState(false)
  const [error, setErrorMessage] = useState('')
  const { register, trigger, handleSubmit, setError, formState: { errors } } = useForm<CategoryInput>({
    resolver: zodResolver(schema), defaultValues: { name: category?.name ?? '', type: category?.type ?? (action.kind === 'create' ? action.type : 'expense') },
  })
  useEffect(() => { dialog.current?.showModal() }, [])
  async function mutate(input?: CategoryInput) {
    if (busy) return
    setBusy(true)
    setErrorMessage('')
    try {
      if (action.kind === 'delete') {
        await deleteCategory(workspaceId, action.category.id)
        onSaved(action.category, true)
      } else if (input) onSaved(await saveCategory(workspaceId, input, category?.id), false)
      onClose()
    } catch (failure) { setErrorMessage(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  const save = handleSubmit(async values => {
    if (categories.some(item => item.id !== category?.id && item.name.toLocaleLowerCase() === values.name.toLocaleLowerCase())) {
      setError('name', { message: 'A category with this name already exists.' }, { shouldFocus: true })
      return
    }
    await mutate(values)
  })
  const close = () => { if (!busy) onClose() }
  const title = action.kind === 'create' ? 'Create category' : action.kind === 'edit' ? 'Edit category' : 'Delete category'
  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }}
    className="m-auto max-h-[calc(100svh-40px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[18px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/35 backdrop:backdrop-blur-[3px]">
    <div className="mb-4 flex justify-end"><LanguageSwitcher /></div>
    <div className="flex items-center justify-between gap-4"><h2 id={titleId} className="m-0 text-[23px] font-semibold!">{tr(title)}</h2><button disabled={busy} type="button" aria-label={tr("Close category dialog")} onClick={close} className={iconButton}><X size={20} /></button></div>
    {error && <p role="alert" className="mt-5 rounded-lg bg-[#fcf0ed] p-3 text-sm text-[#a43b32]">{trError(error)}</p>}
    {action.kind === 'delete' ? <div className="mt-5 space-y-5"><p className="text-sm">{tr('Delete {{name}} from this workspace?', { name: category?.name ?? '' })}</p><p className="text-xs text-[#627168]">{tr("If this category is in use, the server may prevent deletion.")}</p><div className="flex justify-end gap-3"><button disabled={busy} onClick={close} className={secondaryButton}>{tr("Cancel")}</button><button disabled={busy} onClick={() => void mutate()} className="inline-flex items-center gap-2 rounded-[10px] bg-[#a43b32] px-4 py-3 text-sm text-white hover:bg-[#862e27] disabled:opacity-50">{busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />}{tr("Delete category")}</button></div></div>
      : <KeyboardForm validateField={trigger} onSubmit={save} noValidate className="mt-5 grid gap-5"><fieldset disabled={busy} className="grid gap-5">
        <label className="grid gap-2 text-sm">{tr("Name")}<Input autoFocus maxLength={100} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? errorId : undefined} {...register('name')} />{errors.name && <span id={errorId} role="alert" className="text-xs text-[#a43b32]">{tr(errors.name.message)}</span>}</label>
        <label className="grid gap-2 text-sm">{tr("Type")}<select {...register('type')} className="h-11 rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#193f33]"><option value="expense">{tr("Expense")}</option><option value="income">{tr("Income")}</option></select></label>
      </fieldset><div className="flex justify-end gap-3"><button disabled={busy} type="button" onClick={close} className={secondaryButton}>{tr("Cancel")}</button><button disabled={busy} type="submit" className={primaryButton}>{busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />}{action.kind === 'create' ? tr("Create category") : tr("Save changes")}</button></div></KeyboardForm>}
  </dialog>
}

function ConnectedCategories({ workspaceId, workspaceKind, onConnect, canManage = true }: ConnectionProps & { workspaceId: number }) {
  const { tr, trError } = useAdminTranslation()
  const client = useQueryClient()
  const key = workspaceQueryKey('categories',workspaceId)
  const query = useQuery({ queryKey: key, queryFn: ({signal}) => listCategories(workspaceId,signal) })
  const categories = query.isError ? [] : query.data ?? []
  const loading = query.isPending || query.isFetching
  const error = query.error instanceof Error ? query.error.message : ''
  const [action, setAction] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')
  const [selectedType, setSelectedType] = useState<Category['type']>('expense')
  const switchId = useId()
  const visibleCategories = categories.filter(category => category.type === selectedType)
  function reload() { void client.invalidateQueries({ queryKey:key, exact:true }) }
  function saved(category: Category, deleted: boolean) {
    if (authAccountId() !== key[1]) return
    client.setQueryData<Category[]>(key, previous => {
      const rows = previous ?? []
      return deleted ? rows.filter(item=>item.id!==category.id) : rows.some(item=>item.id===category.id) ? rows.map(item=>item.id===category.id?category:item) : [...rows,category]
    })
    if (!deleted) setSelectedType(category.type)
    setNotice(deleted ? 'Category deleted.' : action?.kind === 'create' ? 'Category created.' : 'Category updated.')
    reload()
    for (const feature of ['statistics', 'dashboard', 'transactions', 'budgets', 'business-budgets']) void client.invalidateQueries({ queryKey: workspaceQueryKey(feature, workspaceId) })
  }
  const label = workspaceKind === 'personal' ? 'Personal' : 'Business'
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="m-0 text-[22px] font-semibold!">{tr("Your categories")}</h2><p className="mt-2 text-xs text-[#627168]">{tr("Organise your income and expenses.")}</p></div>{canManage && <button disabled={loading || Boolean(error)} onClick={() => setAction({ kind: 'create', type: selectedType })} className={primaryButton}><Plus size={17} />{tr("Create category")}</button>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#627168]"><span>{tr('{{kind}} workspace · ID {{id}}', { kind: tr(label), id: workspaceId })}</span><div className="flex gap-4"><button disabled={loading} onClick={reload} className="inline-flex items-center gap-1 hover:text-[#193f33] disabled:opacity-50"><RefreshCw size={13} />{tr("Refresh")}</button><button onClick={() => onConnect(undefined)} className="hover:text-[#193f33]">{tr("Change workspace")}</button></div></div>
    {notice && <p role="status" className="mt-4 rounded-lg bg-[#eaf0e5] px-4 py-3 text-sm">{tr(notice)}</p>}
    <div className="relative mt-6 grid w-full max-w-[360px] grid-cols-2 rounded-full bg-[#eaf0e6] p-1" role="tablist" aria-label={tr("Category type")}>
      <span aria-hidden className="category-type-indicator pointer-events-none absolute inset-y-1 left-1 w-[calc(50%_-_4px)] rounded-full bg-[#193f33] shadow-sm" style={{ transform: `translateX(${selectedType === 'expense' ? '0' : '100'}%)` }} />
      {(['expense', 'income'] as const).map((type, index) => <button key={type} type="button" role="tab" id={`${switchId}-${type}`} aria-label={type === 'expense' ? tr("Expenses") : tr("Income")} aria-selected={selectedType === type} aria-controls={`${switchId}-panel`} tabIndex={selectedType === type ? 0 : -1} onClick={() => setSelectedType(type)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
        setSelectedType(next === 0 ? 'expense' : 'income')
        ;(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus()
      }} className={`relative z-10 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium ${selectedType === type ? 'text-white' : 'text-[#526259]'}`}>
        {type === 'expense' ? tr("Expenses") : tr("Income")}<span aria-hidden className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${selectedType === type ? 'bg-white/15 text-white' : 'bg-white/70 text-[#526259]'}`}>{categories.filter(category => category.type === type).length}</span>
      </button>)}
    </div>
    <div key={selectedType} role="tabpanel" id={`${switchId}-panel`} aria-labelledby={`${switchId}-${selectedType}`} tabIndex={0} className="motion-content mt-5 min-h-[180px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#82965b]">
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-[#627168]"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />{tr("Loading categories…")}</p>}
      {error && <div className="rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{trError(error)}</p><button onClick={reload} className={`${secondaryButton} mt-3`}>{tr("Retry")}</button></div>}
      {!loading && !error && visibleCategories.length === 0 && <div className="rounded-xl border border-dashed border-[#dce4d8] px-5 py-10 text-center"><p className="font-medium">{categories.length === 0 ? tr("No categories yet") : tr(selectedType === 'income' ? 'No income categories yet' : 'No expense categories yet')}</p><p className="mt-2 text-sm text-[#627168]">{canManage ? tr(selectedType === 'income' ? workspaceKind === 'personal' ? 'Create an income category for your personal workspace.' : 'Create an income category for your business workspace.' : workspaceKind === 'personal' ? 'Create an expense category for your personal workspace.' : 'Create an expense category for your business workspace.') : tr("The workspace owner can add categories here.")}</p></div>}
      {visibleCategories.length > 0 && <ul aria-label={tr(workspaceKind === 'personal' ? 'Personal categories' : 'Business categories')} className="space-y-3">{visibleCategories.map(category => <li key={category.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e1e5df] bg-[#f7f8f2] px-4 py-3"><div className="min-w-0"><strong className="block wrap-anywhere text-sm font-semibold">{category.name}</strong><span className="text-xs text-[#627168]">{category.type === 'income' ? tr("Income") : tr("Expense")}</span></div>{canManage && <div className="flex shrink-0 gap-1"><button disabled={loading} aria-label={tr('Edit {{name}}', { name: category.name })} onClick={() => setAction({ kind: 'edit', category })} className={iconButton}><Pencil size={16} /></button><button disabled={loading} aria-label={tr('Delete {{name}}', { name: category.name })} onClick={() => setAction({ kind: 'delete', category })} className={`${iconButton} hover:text-[#a43b32]`}><Trash2 size={16} /></button></div>}</li>)}</ul>}
    </div>
    {canManage && action && <CategoryDialog action={action} workspaceId={workspaceId} categories={categories} onClose={() => setAction(null)} onSaved={saved} />}
  </>
}

function WorkspaceConnection({ workspaceKind, workspaceName, onConnect }: ConnectionProps) {
  const { tr, trError } = useAdminTranslation()
  const [workspaces, setWorkspaces] = useState<AccessibleWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | null>(null)
  const onConnectRef = useRef(onConnect)
  useEffect(() => { onConnectRef.current = onConnect }, [onConnect])
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    listAccessibleWorkspaces(controller.signal).then(async data => {
      if (controller.signal.aborted) return
      const available = data.filter(item => item.type === (workspaceKind === 'personal' ? 'PERSONAL' : 'BUSINESS'))
      setWorkspaces(available)
      const automatic = workspaceKind === 'personal' && available.length === 1 ? available[0] : available.find(item => item.name === workspaceName)
      if (automatic) {
        setSelectedId(String(automatic.id))
        await verifyCategoryWorkspace(automatic.id, workspaceKind, controller.signal)
        if (!controller.signal.aborted) onConnectRef.current(automatic.id)
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [workspaceKind, workspaceName, revision])
  async function connect() {
    const id = Number(selectedId)
    if (connecting || !workspaces.some(item => item.id === id)) return
    const controller = new AbortController()
    request.current = controller
    setConnecting(true); setError('')
    try {
      await verifyCategoryWorkspace(id, workspaceKind, controller.signal)
      if (!controller.signal.aborted) onConnectRef.current(id)
    } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)) }
    finally { if (!controller.signal.aborted) setConnecting(false) }
  }
  useEffect(() => () => { request.current?.abort() }, [])
  return <><h2 className="text-[22px] font-semibold!">{tr("Your categories")}</h2>
    <p className="mt-2 text-sm text-[#627168]">{tr(workspaceKind === 'personal' ? 'Choose one of your accessible personal workspaces.' : 'Choose one of your accessible business workspaces.')}</p>
    {loading && <p role="status" className="mt-5 text-sm text-[#627168]">{tr("Loading your workspaces…")}</p>}
    {error && <div className="mt-4 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{trError(error)}</p><button className={`${secondaryButton} mt-3`} onClick={() => { setLoading(true); setError(''); setRevision(value => value + 1) }}>{tr("Retry")}</button></div>}
    {!loading && !error && !workspaces.length && <div className="mt-5 rounded-xl border border-dashed border-[#dce4d8] p-5"><p className="font-medium">{tr(workspaceKind === 'personal' ? 'No accessible Personal workspaces' : 'No accessible Business workspaces')}</p><p className="mt-2 text-sm text-[#627168]">{workspaceKind === 'business' ? tr("Ask your workspace owner to add your account to a Business workspace. A session-only workspace is not a backend workspace.") : tr("Your account has no Personal workspace available. Please ask your backend developer to check your workspace membership.")}</p></div>}
    {!loading && workspaces.length > 0 && <KeyboardForm className="mt-5 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void connect() }}><label className="grid flex-1 gap-2 text-sm">{tr("Workspace")}<select disabled={connecting} value={selectedId} onChange={event => setSelectedId(event.target.value)} required className="h-11 rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm"><option value="">{tr("Select a workspace")}</option>{workspaces.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select></label><button disabled={connecting || !selectedId} className={primaryButton}>{connecting ? tr("Checking access…") : tr("Load categories")}</button></KeyboardForm>}
  </>
}

export function CategoryManager(props: ConnectionProps) {
  const { tr } = useAdminTranslation()
  return <section className="rounded-2xl bg-white p-6 max-sm:p-[18px]" aria-label={tr("Category management")}>
    {props.workspaceId === undefined ? <WorkspaceConnection {...props} /> : <ConnectedCategories key={`${props.workspaceKind}-${props.workspaceId}`} {...props} workspaceId={props.workspaceId} />}
  </section>
}
