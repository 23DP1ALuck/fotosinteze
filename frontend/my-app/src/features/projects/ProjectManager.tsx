import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FolderKanban, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { deleteProject, loadProjectCatalog, saveProject, type ApiProject } from './api'
import type { ProjectCatalog } from './use-project-catalog'
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-40'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4] disabled:opacity-40'
const iconButton = 'rounded-lg p-2 text-[#7d877f] hover:bg-[#eaf0e6] hover:text-[#193f33] disabled:opacity-40'
const selectClass = 'h-11 w-full rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#193f33]'
const formSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(100, 'Use 100 characters or fewer'), status: z.string(), start_date: z.string(), end_date: z.string(), department_ids: z.array(z.string()) }).refine(value => !value.start_date || !value.end_date || value.start_date <= value.end_date, { message: 'End date must be on or after the start date.', path: ['end_date'] })
type Action = { kind: 'create' } | { kind: 'edit' | 'delete'; project: ApiProject }

function ProjectDialog({ action, catalog, onClose, onSuccess }: { action: Action; catalog: ProjectCatalog; onClose: () => void; onSuccess: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const project = action.kind === 'create' ? undefined : action.project
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: { name: project?.name ?? '', status: project?.status ?? (project ? '' : 'Planned'), start_date: project?.start_date?.slice(0,10) ?? '', end_date: project?.end_date?.slice(0,10) ?? '', department_ids: project?.department_ids.map(String) ?? [] } })
  useEffect(() => { dialog.current?.showModal() }, [])
  async function mutate(values?: z.infer<typeof formSchema>) {
    if (busy || catalog.workspaceId === undefined) return
    setBusy(true); setError('')
    try {
      if (action.kind === 'delete') { await deleteProject(catalog.workspaceId, action.project.id); catalog.remove(action.project.id) }
      else if (values) {
        const result = await saveProject(catalog.workspaceId, { name: values.name, status: values.status || null, start_date: values.start_date ? `${values.start_date}T00:00:00` : null, end_date: values.end_date ? `${values.end_date}T00:00:00` : null, department_ids: values.department_ids.map(Number) }, project?.id)
        catalog.upsert(result)
      }
      onSuccess(action.kind === 'delete' ? 'Project deleted.' : action.kind === 'create' ? 'Project added.' : 'Project updated.')
      catalog.refresh(); onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the project. Please retry.') }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  const statuses = [...new Set(['Planned', 'Active', 'Completed', ...(project?.status ? [project.status] : [])])]
  return <dialog ref={dialog} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(540px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 backdrop:backdrop-blur-[4px]">
    <div className="flex items-center justify-between"><h2 id={titleId} className="text-2xl font-semibold!">{action.kind === 'create' ? 'Add' : action.kind === 'edit' ? 'Edit' : 'Delete'} project</h2><button disabled={busy} aria-label="Close project dialog" onClick={close} className={iconButton}><X size={20} /></button></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{error}</p>}
    {action.kind === 'delete' ? <div className="mt-5 space-y-5"><p>Delete <strong>{project?.name}</strong> from this workspace?</p><div className="flex justify-end gap-3"><button disabled={busy} onClick={close} className={secondary}>Cancel</button><button disabled={busy} onClick={() => void mutate()} className="rounded-xl bg-[#a43b32] px-4 py-3 text-sm text-white disabled:opacity-40">Delete project</button></div></div> : <form onSubmit={handleSubmit(values => mutate(values))} className="mt-5 space-y-5" noValidate><fieldset disabled={busy} className="grid gap-5">
      <label className="grid gap-2 text-sm">Project name<Input autoFocus maxLength={100} {...register('name')} aria-invalid={Boolean(errors.name)} />{errors.name && <span role="alert" className="text-xs text-[#a43b32]">{errors.name.message}</span>}</label>
      <label className="grid gap-2 text-sm">Status<select {...register('status')} className={selectClass}><option value="">Unspecified</option>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"><label className="grid gap-2 text-sm">Start date<Input type="date" {...register('start_date')} /></label><label className="grid gap-2 text-sm">End date<Input type="date" {...register('end_date')} aria-invalid={Boolean(errors.end_date)} />{errors.end_date && <span role="alert" className="text-xs text-[#a43b32]">{errors.end_date.message}</span>}</label></div>
      <fieldset className="rounded-xl border border-[#dce4d8] p-4"><legend className="px-1 text-sm">Departments · optional</legend><p className="mb-3 text-xs text-[#7d877f]">Leave unselected for a workspace-wide project. A shared project can link to several departments.</p>{catalog.departments.map(department => <label key={department.id} className="mt-3 flex items-center gap-3 text-sm"><input type="checkbox" value={String(department.id)} {...register('department_ids')} className="size-4 accent-[#193f33]" />{department.name}</label>)}{!catalog.departments.length && <p className="text-xs text-[#7d877f]">No departments in this workspace yet.</p>}</fieldset>
    </fieldset><div className="flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button disabled={busy} type="button" onClick={close} className={secondary}>Cancel</button><button disabled={busy} className={primary}>{busy && <LoaderCircle size={16} className="animate-spin" />}{action.kind === 'create' ? 'Add project' : 'Save changes'}</button></div></form>}
  </dialog>
}

export function ProjectManager({ catalog, workspaceId, onConnect, canManage }: { catalog: ProjectCatalog; workspaceId?: number; onConnect: (id: number | undefined) => void; canManage: boolean }) {
  const [action, setAction] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  async function connect(id: number) {
    if (connecting) return
    setConnecting(true)
    setConnectionError('')
    try {
      await loadProjectCatalog(id)
      onConnect(id)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not connect this workspace. Please try again.')
    } finally { setConnecting(false) }
  }
  const rows = catalog.projects.filter(project => project.name.toLowerCase().includes(query.toLowerCase()) && (!department || project.department_ids.includes(Number(department))))
  return <section aria-label="Projects management" className="rounded-[20px] bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#d5f579]"><FolderKanban size={20} /></span><div><h2 className="text-[22px] font-semibold!">Your projects</h2><p className="mt-1 text-xs text-[#7d877f]">Bring your people and plans together.</p></div></div>{canManage && workspaceId !== undefined && <button disabled={catalog.loading || Boolean(catalog.error)} onClick={() => setAction({ kind: 'create' })} className={primary}><Plus size={17} />Add project</button>}</div>
    {workspaceId === undefined ? <form className="mt-6 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const id = Number(new FormData(event.currentTarget).get('workspaceId')); if (Number.isSafeInteger(id) && id > 0) void connect(id) }}><p className="w-full text-sm text-[#7d877f]">Connect an existing Business workspace owned by, or shared with, your account. Your backend developer must create the workspace and membership until the workspace API is available.</p>{connectionError && <p role="alert" className="w-full rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{connectionError}</p>}<label className="grid flex-1 gap-2 text-sm">Workspace ID<Input disabled={connecting} name="workspaceId" type="number" min="1" max={Number.MAX_SAFE_INTEGER} required step="1" /></label><button disabled={connecting} className={primary}>{connecting ? 'Checking access…' : 'Load projects'}</button></form> : <>
      <div className="mt-4 flex justify-between gap-3 text-xs text-[#7d877f]"><span>Business workspace · ID {workspaceId} · {catalog.loading ? 'Checking access…' : catalog.error ? 'Connection failed' : 'Saved to backend'}</span><button onClick={() => onConnect(undefined)}>Change workspace ID</button></div>
      <div className="mt-6 flex flex-wrap gap-3"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f7f8f2] px-4"><Search size={16} /><input aria-label="Search projects" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 w-full bg-transparent py-3 text-sm outline-none" placeholder="Search projects" /></label><select aria-label="Filter projects by department" value={department} onChange={event => setDepartment(event.target.value)} className={`${selectClass} !w-auto`}><option value="">All departments</option>{catalog.departments.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select><button disabled={catalog.loading} onClick={catalog.refresh} aria-label="Refresh projects" className={secondary}><RefreshCw size={16} /></button></div>
      {notice && <p role="status" className="mt-4 rounded-xl bg-[#eaf0e5] p-4 text-sm">{notice}</p>}
      {catalog.loading && <p role="status" className="mt-5 text-sm text-[#7d877f]">Loading projects…</p>}
      {catalog.error && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{catalog.error}</p><button onClick={catalog.refresh} className={`${secondary} mt-3`}>Retry</button></div>}
      {!catalog.loading && !catalog.error && !rows.length && <p className="mt-5 rounded-2xl border border-dashed border-[#dce4d8] px-5 py-10 text-center text-sm text-[#7d877f]">{catalog.projects.length ? 'No projects match these filters.' : 'No projects yet. Add your first project to get started.'}</p>}
      <ul aria-label="Projects" className="mt-5 grid gap-3">{rows.map(project => <li key={project.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e5df] p-4 transition-colors hover:border-[#b4c69d]"><div className="min-w-0"><strong className="block wrap-anywhere text-sm">{project.name}</strong><p className="mt-1 text-xs text-[#7d877f]">{project.department_ids.map(id => catalog.departments.find(item => item.id === id)?.name ?? `Department ${id}`).join(' · ') || 'No department links'}</p><p className="mt-1 text-xs text-[#7d877f]">{project.start_date?.slice(0,10) || 'No start date'} → {project.end_date?.slice(0,10) || 'No end date'}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs ${project.status === 'Active' ? 'bg-[#d5f579]' : 'bg-[#f3f6ed]'}`}>{project.status || 'Unspecified'}</span>{canManage && <><button disabled={catalog.loading} aria-label={`Edit ${project.name}`} onClick={() => setAction({ kind: 'edit', project })} className={iconButton}><Pencil size={16} /></button><button disabled={catalog.loading} aria-label={`Delete ${project.name}`} onClick={() => setAction({ kind: 'delete', project })} className={iconButton}><Trash2 size={16} /></button></>}</div></li>)}</ul>
    </>}
    {canManage && action && <ProjectDialog action={action} catalog={catalog} onClose={() => setAction(null)} onSuccess={setNotice} />}
  </section>
}

export function ProjectFields({ catalog, departmentId, projectId, onDepartmentChange, onProjectChange, namePrefix = '' }: { catalog: ProjectCatalog; departmentId: string; projectId: string; onDepartmentChange: (id: string) => void; onProjectChange: (id: string) => void; namePrefix?: string }) {
  const available = catalog.projects.filter(project => !departmentId || !project.department_ids.length || project.department_ids.includes(Number(departmentId)))
  const currentProject = available.some(project => String(project.id) === projectId) ? projectId : ''
  const disabled = catalog.workspaceId === undefined || catalog.loading || Boolean(catalog.error)
  return <>
    <label>Department<select name={`${namePrefix}department_id`} disabled={disabled} value={catalog.departments.some(item => String(item.id) === departmentId) ? departmentId : ''} onChange={event => {
      const id = event.target.value; onDepartmentChange(id)
      const selected = catalog.projects.find(project => String(project.id) === projectId)
      if (id && selected?.department_ids.length && !selected.department_ids.includes(Number(id))) onProjectChange('')
    }} className={selectClass}><option value="">No department</option>{catalog.departments.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select></label>
    <label>Project<select name={`${namePrefix}project_id`} disabled={disabled} value={currentProject} onChange={event => onProjectChange(event.target.value)} className={selectClass}><option value="">No project</option>{available.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>
    {catalog.workspaceId === undefined && <p className="text-xs text-[#7d877f]">Connect this Business workspace on the Projects page to select a department or project.</p>}
    {catalog.loading && <p role="status" className="text-xs text-[#7d877f]">Loading project options…</p>}
    {catalog.error && <p role="alert" className="text-xs text-[#a43b32]">{catalog.error}</p>}
  </>
}
