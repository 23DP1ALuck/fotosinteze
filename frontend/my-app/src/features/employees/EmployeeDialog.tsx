import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { Department } from '@/features/departments/api'
import { employeeInputSchema, type WorkspaceMember } from './api'

export type MemberAction = { kind: 'add' } | { kind: 'remove' | 'assign'; member: WorkspaceMember }
const primary = 'rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] disabled:opacity-50'

export function EmployeeDialog({ action, departments, onSave, onClose }: {
  action: MemberAction; departments: Department[]; onSave: (action: MemberAction, email?: string, departmentId?: number) => Promise<boolean>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useRef(false)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [departmentId, setDepartmentId] = useState(action.kind === 'assign' ? String(action.member.department_id ?? '') : '')
  const { register, trigger, handleSubmit, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(employeeInputSchema), defaultValues: { email: '' } })
  useEffect(() => { dialog.current?.showModal() }, [])
  async function submit(email?: string) {
    if (locked.current) return
    if (action.kind !== 'remove' && !departments.some(item => String(item.id) === departmentId)) { setError('Choose a department'); return }
    locked.current = true; setBusy(true); setError('')
    try { if (await onSave(action, email, Number(departmentId))) onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update employees. Please try again.') }
    finally { locked.current = false; setBusy(false) }
  }
  const title = action.kind === 'add' ? 'Add employee' : action.kind === 'assign' ? 'Assign department' : 'Remove employee'
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!locked.current) onClose() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(500px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 max-sm:p-5">
    <div className="flex items-center justify-between gap-4"><h2 id={`${id}-title`} className="text-2xl font-semibold!">{title}</h2><button type="button" disabled={busy} aria-label="Close employee dialog" onClick={onClose} className="rounded-lg p-2 hover:bg-[#eaf0e6] disabled:opacity-50"><X size={20} /></button></div>
    {error && <p role="alert" className="mt-5 rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{error}</p>}
    {action.kind === 'add' ? <KeyboardForm validateField={trigger} noValidate onSubmit={event => { void handleSubmit(values => submit(values.email))(event) }} className="mt-6">
      <p className="mb-5 text-sm text-[#526259]">Add someone who already has a Fotosinteze account. Enter the email they registered with.</p>
      <label htmlFor={`${id}-email`} className="text-sm font-medium">Email address</label>
      <Input id={`${id}-email`} type="email" autoFocus autoComplete="email" maxLength={100} disabled={busy} {...register('email')} aria-invalid={Boolean(errors.email)} aria-describedby={`${id}-hint`} placeholder="name@company.com" className="mt-2 h-12 bg-[#f7f8f2]" />
      <p id={`${id}-hint`} role={errors.email ? 'alert' : undefined} className={`mt-2 text-xs ${errors.email ? 'text-[#a43b32]' : 'text-[#526259]'}`}>{errors.email?.message ?? 'They will join as an employee. Owners keep member management access.'}</p>
      <label className="mt-5 grid gap-2 text-sm">Department<select required aria-label="Department" value={departmentId} onChange={event => setDepartmentId(event.target.value)} disabled={busy} className="h-12 rounded-lg border border-[#d8d8d0] bg-[#f7f8f2] px-3"><option value="">Choose a department</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!departments.length && <p className="mt-3 text-xs text-[#526259]">Create a department before adding employees.</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancel</button><button type="submit" disabled={busy} className={`${primary} inline-flex items-center gap-2`}>{busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />}{busy ? 'Adding…' : 'Add employee'}</button></div>
    </KeyboardForm> : action.kind === 'assign' ? <KeyboardForm className="mt-6" onSubmit={event => { event.preventDefault(); void submit() }}><p className="mb-5 text-sm">Choose a department for {action.member.display_name || action.member.email}. Their project access will follow the projects linked to the new department.</p><label className="grid gap-2 text-sm">Department<select required aria-label="Department" value={departmentId} onChange={event => setDepartmentId(event.target.value)} disabled={busy} className="h-12 rounded-lg border border-[#d8d8d0] px-3"><option value="">Choose a department</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancel</button><button disabled={busy} className={primary}>{busy ? 'Saving…' : 'Save department'}</button></div></KeyboardForm> : <div className="mt-6"><p className="text-sm">Remove <strong>{action.member.display_name || action.member.email}</strong> from this workspace?</p><p className="mt-3 wrap-anywhere text-sm text-[#526259]">{action.member.email}</p><p className="mt-4 text-xs text-[#526259]">Their workspace access will be revoked. Their account and financial history will be kept.</p><div className="mt-6 flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancel</button><button type="button" disabled={busy} onClick={() => void submit()} className="rounded-xl bg-[#a43b32] px-5 py-3 text-sm text-white hover:bg-[#862e27] disabled:opacity-50">{busy ? 'Removing…' : 'Remove employee'}</button></div></div>}
  </dialog>
}
