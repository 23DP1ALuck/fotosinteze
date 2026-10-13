import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type Workspace = { id: string; name: string; kind: 'personal' | 'business'; role?: 'OWNER' | 'EMPLOYEE' }

export function WorkspaceSwitcher({ workspace, workspaces, onSwitch, onCreate }: {
  workspace: Workspace
  workspaces: Workspace[]
  onSwitch: (id: string) => void
  onCreate: () => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return <div ref={container} className="group relative mt-8 rounded-xl border border-transparent bg-[#ecf0e6] transition-[border-color,box-shadow] duration-200 hover:border-[#98a56c] hover:shadow-sm focus-within:border-[#98a56c] motion-reduce:transition-none">
    <button type="button" aria-label={`Switch workspace, ${workspace.name}`} aria-expanded={open} onClick={() => setOpen(!open)}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }} className="flex w-full items-center justify-between gap-2 px-[17px] py-[13px] text-left">
      <span className="grid min-w-0 gap-1"><strong className="wrap-anywhere text-[17px] font-semibold">{workspace.name}</strong><span className="text-xs text-[#7d877f]">{workspace.kind === 'personal' ? 'Your personal workspace' : `Business workspace · ${workspace.role === 'EMPLOYEE' ? 'Employee' : 'Owner'}`}</span></span>
      <ChevronDown size={15} className="shrink-0 text-[#7d877f] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none" />
    </button>
    <button type="button" aria-label="Create business workspace from workspace switcher" onClick={onCreate}
      className="group/plus absolute -bottom-3 right-3 z-10 grid size-7 translate-y-2 scale-90 place-items-center rounded-lg border border-[#98a56c] bg-[#d5f579] text-[#193f33] opacity-0 transition-[opacity,transform,translate,scale]! duration-300! ease-out! group-hover:scale-100 group-focus-within:scale-100 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 focus:scale-100 focus:translate-y-0 focus:opacity-100 motion-reduce:transition-none! [@media(hover:none)]:scale-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
      <Plus size={17} /><span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 w-max max-w-[230px] rounded-lg bg-[#193f33] px-3 py-2 text-xs text-white opacity-0 transition-opacity group-hover/plus:opacity-100 group-focus-visible/plus:opacity-100">Create business workspace</span>
    </button>
    {open && <div className="absolute top-[calc(100%+20px)] left-0 z-30 w-full rounded-xl border border-[#dce4d8] bg-white p-2 shadow-lg" aria-label="Available workspaces">
      {workspaces.map((item) => <button type="button" key={item.id} aria-label={`Switch to ${item.name}`} onClick={() => { onSwitch(item.id); setOpen(false) }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f3f6ed]">
        <span className="min-w-0 wrap-anywhere">{item.name}<span className="mt-1 block text-xs text-[#7d877f]">{item.kind === 'personal' ? 'Personal workspace' : `Business · ${item.role === 'EMPLOYEE' ? 'Employee' : 'Owner'}`}</span></span>{item.id === workspace.id && <Check size={16} className="shrink-0" aria-hidden />}
      </button>)}
    </div>}
  </div>
}

const schema = z.object({ name: z.string().trim().min(2, 'Use at least 2 characters').max(100, 'Use 100 characters or fewer') })

export function CreateBusinessDialog({ workspaces, onCreate, onClose }: {
  workspaces: Workspace[]
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { register, handleSubmit, setError, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: '' } })
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])
  const submit = handleSubmit(({ name }) => {
    if (workspaces.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError('name', { message: 'A workspace with this name already exists.' }, { shouldFocus: true })
      return
    }
    onCreate(name)
    onClose()
  })

  return <dialog ref={dialog} aria-labelledby="create-business-title" onCancel={onClose}
    className="relative m-auto max-h-[calc(100svh-32px)] w-[min(640px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-8 font-sans scheme-light [&_button]:cursor-pointer text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/40 max-sm:p-5">
    <button type="button" aria-label="Close business workspace dialog" onClick={onClose} className="absolute top-7 right-7 rounded-lg p-2 text-[#68796e] hover:bg-[#edf0e8]"><X size={18} /></button>
    <div className="grid size-12 place-items-center rounded-2xl bg-[#d5f579]"><Plus size={28} strokeWidth={1.5} /></div>
    <h2 id="create-business-title" className="mt-5 font-sans! text-[28px] leading-tight font-semibold! tracking-tight max-sm:text-[24px]">Make room for your business.</h2>
    <p className="mt-3 text-sm text-[#68796e]">A separate workspace for your team, budgets and projects.</p>
    <form onSubmit={submit} noValidate className="mt-7">
      <label className="grid gap-2 text-sm font-semibold">Workspace name
        <Input placeholder="e.g. Acme Studio" maxLength={100} {...register('name')} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'workspace-name-error' : 'workspace-name-hint'} className="h-12 bg-[#f7f8f2] font-normal" />
      </label>
      {errors.name ? <p role="alert" id="workspace-name-error" className="mt-2 text-xs text-[#a43b32]">{errors.name.message}</p> : <p id="workspace-name-hint" className="mt-2 text-xs text-[#68796e]">Give your business a name you recognise.</p>}
      <div className="mt-6 space-y-3 rounded-2xl bg-[#eaf0e5] p-5 text-sm text-[#68796e]">
        <h3 className="font-semibold text-[#193f33]">You’ll be the Owner</h3>
        <p>Manage members, budgets and workspace settings.</p><p>Your personal finances stay separate.</p><p>Add existing users as employees after setup.</p>
      </div>
      <p className="mt-5 text-xs text-[#68796e]">Revolut is available in your Personal Workspace only.</p>
      <p className="mt-2 text-xs text-[#7d877f]">This workspace is saved for this session. Backend creation is not available yet.</p>
      <div className="mt-5 flex justify-end gap-3 border-t border-[#e1e5df] pt-5 max-sm:flex-col-reverse">
        <button type="button" onClick={onClose} className="rounded-[10px] bg-[#eaf0e6] px-4 py-3 text-sm hover:bg-[#dce6d4]">Cancel</button>
        <button type="submit" className="rounded-[10px] bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947]">Create business workspace</button>
      </div>
    </form>
  </dialog>
}
