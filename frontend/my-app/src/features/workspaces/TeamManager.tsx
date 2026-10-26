import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowUpRight, Building2, FolderKanban, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { TeamData, TeamSection } from './team-types'

const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white transition-colors hover:bg-[#285947] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4]'
const iconButton = 'rounded-lg p-2 text-[#627168] transition-colors hover:bg-[#eaf0e6] hover:text-[#193f33]'
const selectClass = 'h-11 w-full rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm text-[#193f33] focus-visible:outline-2 focus-visible:outline-[#193f33]'
const formSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100, 'Use 100 characters or fewer'),
  email: z.string().trim(),
  departmentId: z.string(),
  departmentIds: z.array(z.string()),
  status: z.enum(['Planned', 'Active', 'Completed']),
})
type Action = { kind: 'create' | 'edit' | 'delete'; id?: string }
type Props = { section: TeamSection; data: TeamData; onChange: (data: TeamData) => void; ownerName: string }
const nouns = { Employees: 'employee', Departments: 'department', Projects: 'project' } as const

function TeamDialog({ section, data, onChange, ownerName, action, onClose, onSuccess }: Props & {
  action: Action; onClose: () => void; onSuccess: (message: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const fieldErrorId = useId()
  const noun = nouns[section]
  const collection = section === 'Employees' ? data.employees : section === 'Departments' ? data.departments : data.projects
  const item = collection.find((record) => record.id === action.id)
  const employee = data.employees.find((record) => record.id === action.id)
  const project = data.projects.find((record) => record.id === action.id)
  const linked = section === 'Departments' && (data.employees.some((record) => record.departmentId === action.id) || data.projects.some((record) => record.departmentIds.includes(action.id ?? '')))
  const { register, trigger, handleSubmit, setError, formState: { errors } } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: item?.name ?? '', email: employee?.email ?? '', departmentId: employee?.departmentId ?? '', departmentIds: project?.departmentIds ?? [], status: project?.status ?? 'Planned' },
  })
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])

  const save = handleSubmit((values) => {
    if (section === 'Employees' && !z.email().safeParse(values.email).success) {
      setError('email', { message: 'Enter a valid email address' }, { shouldFocus: true })
      return
    }
    const duplicate = section === 'Employees'
      ? data.employees.some((record) => record.id !== action.id && record.email.toLowerCase() === values.email.toLowerCase())
      : collection.some((record) => record.id !== action.id && record.name.toLowerCase() === values.name.toLowerCase())
    if (duplicate) {
      setError(section === 'Employees' ? 'email' : 'name', { message: section === 'Employees' ? 'This employee is already in the workspace.' : `A ${noun} with this name already exists.` }, { shouldFocus: true })
      return
    }
    const id = action.id ?? crypto.randomUUID()
    if (section === 'Employees') {
      const next = { id, name: values.name, email: values.email.toLowerCase(), departmentId: values.departmentId || null }
      onChange({ ...data, employees: action.kind === 'edit' ? data.employees.map((record) => record.id === id ? next : record) : [...data.employees, next] })
    } else if (section === 'Departments') {
      const next = { id, name: values.name }
      onChange({ ...data, departments: action.kind === 'edit' ? data.departments.map((record) => record.id === id ? next : record) : [...data.departments, next] })
    } else {
      const next = { id, name: values.name, status: values.status, departmentIds: values.departmentIds }
      onChange({ ...data, projects: action.kind === 'edit' ? data.projects.map((record) => record.id === id ? next : record) : [...data.projects, next] })
    }
    onSuccess(`${values.name} ${action.kind === 'edit' ? 'updated' : 'added'}.`)
    onClose()
  })

  function remove() {
    if (linked || !item) return
    if (section === 'Employees') onChange({ ...data, employees: data.employees.filter((record) => record.id !== item.id) })
    if (section === 'Departments') onChange({ ...data, departments: data.departments.filter((record) => record.id !== item.id) })
    if (section === 'Projects') onChange({ ...data, projects: data.projects.filter((record) => record.id !== item.id) })
    onSuccess(`${item.name} ${section === 'Employees' ? 'removed' : 'deleted'}.`)
    onClose()
  }

  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={headingId} onCancel={onClose} className="m-auto max-h-[calc(100svh-32px)] w-[min(520px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 backdrop:backdrop-blur-[4px]">
    <div className="flex items-center justify-between gap-4"><h2 id={headingId} className="m-0 font-sans! text-[24px] font-semibold! tracking-tight">{action.kind === 'create' ? 'Add' : action.kind === 'edit' ? 'Edit' : section === 'Employees' ? 'Remove' : 'Delete'} {noun}</h2><button className={iconButton} aria-label="Close management dialog" onClick={onClose}><X size={20} /></button></div>
    {action.kind === 'delete' ? <div className="mt-5 space-y-5">
      <p className="text-sm">{section === 'Employees' ? 'Remove' : 'Delete'} <strong>{item?.name}</strong> from this workspace?</p>
      {linked && <p role="alert" className="rounded-xl bg-[#f3f6ed] p-4 text-sm">This department has linked employees or projects. Reassign or remove those links first.</p>}
      <div className="flex justify-end gap-3"><button className={secondary} onClick={onClose}>Cancel</button><button disabled={Boolean(linked)} onClick={remove} className="rounded-xl bg-[#a43b32] px-4 py-3 text-sm text-white hover:bg-[#862e27] disabled:cursor-not-allowed disabled:opacity-40">{section === 'Employees' ? 'Remove employee' : `Delete ${noun}`}</button></div>
    </div> : <KeyboardForm validateField={trigger} onSubmit={save} noValidate className="mt-5 grid gap-5">
      <label className="grid gap-2 text-sm font-medium">{section === 'Employees' ? 'Full name' : `${section === 'Departments' ? 'Department' : 'Project'} name`}<Input maxLength={100} {...register('name')} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${fieldErrorId}-name` : undefined} placeholder={section === 'Employees' ? 'e.g. Anna Smith' : section === 'Departments' ? 'e.g. Development' : 'e.g. Website redesign'} /></label>{errors.name && <span id={`${fieldErrorId}-name`} role="alert" className="text-xs text-[#a43b32]">{errors.name.message}</span>}
      {section === 'Employees' && <>
        <label className="grid gap-2 text-sm font-medium">Email address<Input type="email" maxLength={254} {...register('email')} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${fieldErrorId}-email` : undefined} placeholder="name@company.com" /></label>{errors.email && <span id={`${fieldErrorId}-email`} role="alert" className="text-xs text-[#a43b32]">{errors.email.message}</span>}
        <label className="grid gap-2 text-sm font-medium">Department<select {...register('departmentId')} className={selectClass}><option value="">Unassigned</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <div className="rounded-xl bg-[#eaf0e5] p-4 text-sm"><strong>Employee access</strong><p className="mt-1 text-xs text-[#526259]">Employees can view finances and add expenses. {ownerName} remains the workspace owner.</p></div>
        <p className="text-xs text-[#627168]">This adds a session-only team entry. Account access and invitations require backend membership support.</p>
      </>}
      {section === 'Projects' && <>
        <label className="grid gap-2 text-sm font-medium">Status<select {...register('status')} className={selectClass}>{['Planned', 'Active', 'Completed'].map((status) => <option key={status}>{status}</option>)}</select></label>
        <fieldset className="rounded-xl border border-[#dce4d8] p-4"><legend className="px-1 text-sm font-medium">Departments</legend>{data.departments.length ? <div className="grid gap-3">{data.departments.map((department) => <label key={department.id} className="flex items-center gap-3 text-sm"><input type="checkbox" value={department.id} {...register('departmentIds')} className="size-4 accent-[#193f33]" />{department.name}</label>)}</div> : <p className="text-xs text-[#627168]">Add departments to link them here. A project can also stand on its own.</p>}</fieldset>
      </>}
      <div className="flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" className={secondary} onClick={onClose}>Cancel</button><button type="submit" className={primary}>{action.kind === 'edit' ? 'Save changes' : `Add ${noun}`}</button></div>
    </KeyboardForm>}
  </dialog>
}

export function TeamManager({ section, data, onChange, ownerName }: Props) {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')
  const noun = nouns[section]
  const records = section === 'Employees' ? data.employees : section === 'Departments' ? data.departments : data.projects
  const filtered = records.filter((record) => `${record.name} ${'email' in record ? record.email : ''}`.toLowerCase().includes(query.toLowerCase()))
  const Icon = section === 'Employees' ? Users : section === 'Departments' ? Building2 : FolderKanban
  const descriptions = { Employees: 'A little structure. A stronger team.', Departments: 'Give every part of your business its own place.', Projects: 'Bring your people and plans together.' }

  return <section aria-label={`${section} management`} className="rounded-[20px] bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#d5f579]"><Icon size={20} strokeWidth={1.7} /></span><div><h2 className="m-0 text-[22px] font-semibold!">Your {section.toLowerCase()}</h2><p className="mt-1 text-xs text-[#627168]">{descriptions[section]}</p></div></div><button onClick={() => setAction({ kind: 'create' })} className={primary}><Plus size={17} />Add {noun}</button></div>
    <div className="mt-6 grid grid-cols-3 gap-3 max-sm:grid-cols-1">{[{ name: 'Employees', value: data.employees.length }, { name: 'Departments', value: data.departments.length }, { name: 'Projects', value: data.projects.length }].map((item) => <div key={item.name} className={`flex items-center justify-between rounded-xl px-4 py-3 ${item.name === section ? 'bg-[#193f33] text-white' : 'bg-[#f3f6ed] text-[#526259]'}`}><span className="text-xs">{item.name}</span><strong className="text-xl font-medium">{item.value}</strong></div>)}</div>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-[#e1e5df] bg-[#fbfcf8] px-4 py-3 focus-within:border-[#98a56c]"><Search size={16} className="text-[#627168]" /><input aria-label={`Search ${section.toLowerCase()}`} placeholder={`Search ${section.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label><span className="rounded-full bg-[#eaf0e5] px-3 py-1 text-xs text-[#526259]">{ownerName} · Owner</span></div>
    <p className="mt-3 text-[11px] text-[#627168]">Session workspace · Changes update immediately and last for this session.</p>
    {notice && <p role="status" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#eaf0e5] px-4 py-3 text-sm">{notice}<button aria-label="Dismiss management notification" onClick={() => setNotice('')} className="p-1"><X size={16} /></button></p>}
    {filtered.length ? <ul className="mt-5 grid gap-3" aria-label={section}>{filtered.map((record) => {
      const employee = data.employees.find((item) => item.id === record.id)
      const project = data.projects.find((item) => item.id === record.id)
      const departmentNames = project?.departmentIds.map((id) => data.departments.find((department) => department.id === id)?.name).filter(Boolean)
      return <li key={record.id} className="group flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e5df] bg-white p-4 transition-[border-color,box-shadow,transform,translate] duration-200 hover:-translate-y-0.5 hover:border-[#b4c69d] hover:shadow-[0_6px_20px_#193f3308] motion-reduce:hover:translate-y-0 motion-reduce:transition-none">
        <div className="flex min-w-0 flex-1 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f0f3e9] text-sm text-[#193f33]">{employee ? employee.name.split(' ').map((name) => name[0]).slice(0, 2).join('').toUpperCase() : <Icon size={18} />}</span><div className="min-w-0"><strong className="block wrap-anywhere text-sm font-semibold">{record.name}</strong><p className="mt-1 wrap-anywhere text-xs text-[#627168]">{employee ? employee.email : project ? `${departmentNames?.join(' · ') || 'No department links'}` : `${data.employees.filter((item) => item.departmentId === record.id).length} employees · ${data.projects.filter((item) => item.departmentIds.includes(record.id)).length} projects`}</p></div></div>
        <div className="flex items-center gap-3"><span className={`max-w-[180px] truncate rounded-full px-3 py-1 text-[11px] ${project?.status === 'Active' ? 'bg-[#d5f579] text-[#193f33]' : 'bg-[#f3f6ed] text-[#526259]'}`}>{employee ? data.departments.find((department) => department.id === employee.departmentId)?.name ?? 'Unassigned' : project?.status ?? 'Department'}</span><div className="flex gap-1"><button aria-label={`Edit ${record.name}`} onClick={() => setAction({ kind: 'edit', id: record.id })} className={iconButton}><Pencil size={16} /></button><button aria-label={`${section === 'Employees' ? 'Remove' : 'Delete'} ${record.name}`} onClick={() => setAction({ kind: 'delete', id: record.id })} className={`${iconButton} hover:text-[#a43b32]`}><Trash2 size={16} /></button></div></div>
      </li>
    })}</ul> : <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-[#dce4d8] bg-[#fbfcf8] px-5 py-10 text-center"><Icon size={30} strokeWidth={1.3} className="text-[#98a56c]" /><h3 className="mt-4 font-medium">{records.length ? 'No matches found' : `No ${section.toLowerCase()} yet`}</h3><p className="mt-2 max-w-xs text-sm text-[#627168]">{records.length ? 'Try another name or email.' : `Add your first ${noun} to give your business a little more structure.`}</p>{!records.length && <button onClick={() => setAction({ kind: 'create' })} className="mt-4 inline-flex items-center gap-2 text-sm text-[#193f33]">Add {noun}<ArrowUpRight size={16} /></button>}</div>}
    {action && <TeamDialog section={section} data={data} onChange={onChange} ownerName={ownerName} action={action} onClose={() => setAction(null)} onSuccess={setNotice} />}
  </section>
}
