import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Settings, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { businessWorkspaceInputSchema, getBusinessWorkspaceSettings, type BusinessWorkspaceInput } from './api'
import { workspaceQueryKey } from './workspace-state'

type Props = { workspaceId: number; onSave: (input: BusinessWorkspaceInput) => Promise<void>; onClose: () => void }

export function WorkspaceSettingsDialog({ workspaceId, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: workspaceQueryKey('workspace-settings', workspaceId), queryFn: ({ signal }) => getBusinessWorkspaceSettings(workspaceId, signal), staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-busy={busy || query.isFetching} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(520px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/40 max-sm:p-5">
    <div className="mb-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#ecf0e6]"><Settings aria-hidden size={22} /></span><h2 id={titleId} className="text-[23px] font-semibold!">Business workspace settings</h2></div>
    {query.isFetching && <p role="status" className="text-sm">Loading workspace settings…</p>}
    {query.isError && <div className="rounded-xl bg-[#fcf0ed] p-4 text-sm"><p role="alert">{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className="mt-3 underline">Retry</button></div>}
    {query.data && !query.isError && !query.isFetching ? <SettingsForm initial={query.data} onSave={onSave} onClose={onClose} onBusy={setBusy} /> : <button type="button" onClick={onClose} className="mt-5 rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm">Close</button>}
  </dialog>
}

function SettingsForm({ initial, onSave, onClose, onBusy }: { initial: BusinessWorkspaceInput; onSave: Props['onSave']; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const { register, trigger, handleSubmit, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<BusinessWorkspaceInput>({ resolver: zodResolver(businessWorkspaceInputSchema), defaultValues: { name: initial.name, base_currency: initial.base_currency } })
  const submit = handleSubmit(async input => {
    clearErrors('root')
    onBusy(true)
    try { await onSave(input); onClose() }
    catch (error) { setError('root', { message: error instanceof Error ? error.message : 'Could not save workspace settings. Please retry.' }) }
    finally { onBusy(false) }
  })
  return <KeyboardForm validateField={trigger} onSubmit={submit} noValidate aria-busy={isSubmitting}>
    <button type="button" disabled={isSubmitting} onClick={onClose} aria-label="Close workspace settings" className="absolute top-3 right-3 rounded-lg p-2 hover:bg-[#eaf0e6] disabled:opacity-50"><X size={18} /></button>
    <fieldset disabled={isSubmitting} className="grid min-w-0 gap-5 border-0 p-0 disabled:opacity-60">
      <p className="text-sm text-[#526259]">Update your business name and base currency. Existing accounts and transactions keep their currencies.</p>
      <label className="grid gap-2 text-sm font-medium">Workspace name<Input {...register('name')} maxLength={100} aria-invalid={Boolean(errors.name)} className="h-12 bg-[#f7f8f2]" />{errors.name && <span role="alert" className="text-xs text-[#a43b32]">{errors.name.message}</span>}</label>
      <label className="grid gap-2 text-sm font-medium">Base currency<Input {...register('base_currency')} maxLength={3} aria-invalid={Boolean(errors.base_currency)} className="h-12 bg-[#f7f8f2] uppercase" />{errors.base_currency && <span role="alert" className="text-xs text-[#a43b32]">{errors.base_currency.message}</span>}</label>
      {errors.root && <p role="alert" className="rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{errors.root.message}</p>}
      <div className="flex justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" onClick={onClose} className="rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm">Cancel</button><button type="submit" className="rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947]">{isSubmitting ? 'Saving…' : 'Save changes'}</button></div>
    </fieldset>
  </KeyboardForm>
}
