import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { deleteDepartment, departmentInputSchema, saveDepartment, type Department } from './api'
import { useDepartments } from './use-departments'

const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4] disabled:opacity-50'
const iconButton = 'rounded-xl p-2 text-[#68796e] hover:bg-[#eaf0e6] hover:text-[#193f33] disabled:opacity-50'
type Action = { kind: 'create' } | { kind: 'rename' | 'delete'; department: Department }

function DepartmentDialog({ action, onChange, onClose }: { action: Action; onChange: (action: Action, name?: string) => Promise<boolean>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string }>({ resolver: zodResolver(departmentInputSchema), defaultValues: { name: action.kind === 'create' ? '' : action.department.name } })
  useEffect(() => { dialog.current?.showModal() }, [])
  async function submit(name?: string) {
    if (busy) return
    setBusy(true); setError('')
    try { if (await onChange(action, name)) onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the department. Please retry.') }
    finally { setBusy(false) }
  }
  const title = action.kind === 'create' ? 'Create department' : action.kind === 'rename' ? 'Rename department' : 'Delete department'
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(480px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 max-sm:p-5">
    <div className="flex items-center justify-between gap-4"><h2 id={`${id}-title`} className="text-2xl font-semibold!">{title}</h2><button type="button" aria-label="Close department dialog" disabled={busy} onClick={onClose} className={iconButton}><X size={20} /></button></div>
    {error && <p role="alert" className="mt-5 rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{error}</p>}
    {action.kind === 'delete' ? <div className="mt-6"><p className="text-sm">Delete <strong>{action.department.name}</strong> from this workspace?</p><p className="mt-3 text-xs text-[#68796e]">Employees must be reassigned first. Projects remain in the workspace.</p><div className="mt-6 flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className="rounded-xl bg-[#a43b32] px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete department'}</button></div></div> : <form onSubmit={handleSubmit(value => submit(value.name))} noValidate className="mt-6">
      <label htmlFor={`${id}-name`} className="text-sm font-medium">Department name</label><Input id={`${id}-name`} autoFocus maxLength={100} disabled={busy} {...register('name')} aria-invalid={Boolean(errors.name)} aria-describedby={`${id}-hint`} placeholder="e.g. Product design" className="mt-2 h-12 bg-[#f7f8f2]" />
      <p id={`${id}-hint`} role={errors.name ? 'alert' : undefined} className={`mt-2 text-xs ${errors.name ? 'text-[#a43b32]' : 'text-[#68796e]'}`}>{errors.name?.message ?? 'Give your team a clear, recognisable name.'}</p>
      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancel</button><button type="submit" disabled={busy} className={primary}>{busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />}{busy ? 'Saving…' : action.kind === 'create' ? 'Create department' : 'Save changes'}</button></div>
    </form>}
  </dialog>
}

export function DepartmentManager({ workspaceId, workspaceName, canManage }: { workspaceId: number; workspaceName: string; canManage: boolean }) {
  const client = useQueryClient()
  const accountId = authAccountId()
  const catalog = useDepartments(workspaceId, true, canManage ? 'OWNER' : 'EMPLOYEE')
  const [action, setAction] = useState<Action | null>(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const rows = catalog.departments.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  async function changeDepartment(next: Action, name?: string) {
    if (!canManage || accountId === null || accountId !== authAccountId() || activeWorkspaceId() !== workspaceId) throw new Error('Your workspace or permissions changed. Please reopen Departments.')
    if (next.kind === 'delete') await deleteDepartment(workspaceId, next.department.id)
    const updated = next.kind === 'delete' ? undefined : await saveDepartment(workspaceId, name ?? '', next.kind === 'rename' ? next.department.id : undefined)
    if (accountId !== authAccountId()) return false
    const key = ['departments', accountId, workspaceId, canManage ? 'OWNER' : 'EMPLOYEE']
    await client.cancelQueries({ queryKey: key, exact: true })
    if (accountId !== authAccountId()) return false
    client.setQueryData<Department[]>(key, previous => next.kind === 'delete' ? previous?.filter(item => item.id !== next.department.id) : updated ? [...(previous ?? []).filter(item => item.id !== updated.id), updated] : previous)
    await Promise.all(['statistics', 'departments', 'projects', 'dashboard', 'transactions', 'budgets', 'business-budgets'].map(feature => client.invalidateQueries({ queryKey: [feature, accountId, workspaceId] })))
    if (accountId !== authAccountId() || activeWorkspaceId() !== workspaceId) return false
    setNotice(next.kind === 'create' ? 'Department created.' : next.kind === 'rename' ? 'Department renamed.' : 'Department deleted.')
    return true
  }
  return <section aria-label="Departments management" className="rounded-[20px] bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-[#d5f579]"><Building2 size={22} /></span><div><h2 className="text-[22px] font-semibold!">Your departments</h2><p className="mt-1 text-xs text-[#7d877f]">{workspaceName} · {canManage ? 'Give every team its own place.' : 'Departments available to your membership.'}</p></div></div>{canManage && <button type="button" disabled={catalog.refreshing || Boolean(catalog.error)} onClick={() => setAction({ kind: 'create' })} className={primary}><Plus size={17} />Add department</button>}</div>
    {!canManage && <p className="mt-5 rounded-xl bg-[#eaf0e6] p-4 text-sm text-[#68796e]">You can view and select your assigned department. Workspace owners manage departments.</p>}
    <div className="mt-6 flex flex-wrap gap-3"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f7f8f2] px-4"><Search size={16} className="shrink-0 text-[#68796e]" /><input aria-label="Search departments" placeholder="Search departments" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 w-full bg-transparent py-3 text-sm outline-none" /></label><button type="button" disabled={catalog.refreshing} onClick={catalog.refresh} aria-label="Refresh departments" className={secondary}><RefreshCw size={16} className={catalog.refreshing ? 'animate-spin motion-reduce:animate-none' : ''} /></button></div>
    {notice && <p role="status" className="mt-4 rounded-xl bg-[#eaf0e5] p-4 text-sm">{notice}</p>}
    {catalog.loading && <p role="status" aria-label="Loading departments" className="mt-6 text-sm text-[#7d877f]">Loading departments…</p>}
    {catalog.error && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{catalog.error}</p><button type="button" onClick={catalog.refresh} className={`${secondary} mt-3`}>Retry departments</button></div>}
    {!catalog.loading && !catalog.error && !rows.length && <div className="mt-6 rounded-2xl border border-dashed border-[#dce4d8] p-8 text-center text-sm text-[#7d877f]"><p>{search ? 'No departments match your search.' : canManage ? 'No departments yet. Add your first team to get started.' : 'No department is assigned to your account. Ask a workspace owner to assign you.'}</p>{search && <button type="button" onClick={() => setSearch('')} className="mt-3 underline">Clear search</button>}</div>}
    {!catalog.error && <ul aria-label="Departments" className="mt-5 grid gap-3">{rows.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e5df] p-5"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eaf0e6]"><Building2 size={17} /></span><strong className="min-w-0 wrap-anywhere text-sm">{item.name}</strong></div>{canManage ? <div className="flex gap-2"><button type="button" aria-label={`Rename ${item.name}`} disabled={catalog.refreshing} onClick={() => setAction({ kind: 'rename', department: item })} className={iconButton}><Pencil size={17} /></button><button type="button" aria-label={`Delete ${item.name}`} disabled={catalog.refreshing} onClick={() => setAction({ kind: 'delete', department: item })} className={iconButton}><Trash2 size={17} /></button></div> : <span className="rounded-full bg-[#eaf0e6] px-3 py-1 text-xs text-[#68796e]">Assigned department</span>}</li>)}</ul>}
    {canManage && action && <DepartmentDialog action={action} onChange={changeDepartment} onClose={() => setAction(null)} />}
  </section>
}
