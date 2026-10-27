import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { LoaderCircle, Trash2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { activeWorkspaceId, authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { formatAccountBalance, getAccount, updateAccount, type ApiAccount, type AccountUpdate } from './api'

const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm hover:bg-[#dce6d4] disabled:opacity-40'

export function AccountDetails({ workspaceId, accountId, canDelete, onDelete, onClose, onSaved }: { workspaceId: number; accountId: number; canDelete: boolean; onDelete: (account: ApiAccount) => void; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const detail = useQuery({ queryKey: [...workspaceQueryKey('account-details', workspaceId), accountId], queryFn: ({ signal }) => getAccount(workspaceId, accountId, signal), staleTime: 0, gcTime: 0 })
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  // Fetch fresh details before exposing editable fields, including the balance source.
  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(540px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 backdrop:backdrop-blur-[4px]">
    <h2 id={titleId} className="text-2xl font-semibold!">Account details</h2>
    {detail.isPending && <p role="status" className="mt-5">Loading account details…</p>}
    {detail.isError && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{detail.error.message}</p><button onClick={() => void detail.refetch()} className={`${secondary} mt-3`}>Retry</button></div>}
    {detail.data && <AccountEditForm canDelete={canDelete} onDelete={onDelete} account={detail.data} busy={busy} onBusyChange={setBusy} onClose={onClose} onSaved={onSaved} />}
    {!detail.data && (detail.isPending || detail.isError) && <button autoFocus onClick={onClose} className={`${secondary} mt-5`}>Close</button>}
  </dialog>
}

function AccountEditForm({ account, canDelete, onDelete, busy, onBusyChange, onClose, onSaved }: { account: ApiAccount; canDelete: boolean; onDelete: (account: ApiAccount) => void; busy: boolean; onBusyChange: (busy: boolean) => void; onClose: () => void; onSaved: () => void }) {
  const client = useQueryClient()
  const ownerId = authAccountId()
  const prefix = useId()
  const saving = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const [error, setError] = useState('')
  const linked = account.connection_id !== null || account.banking_connection_id !== null
  const { register, trigger, handleSubmit, formState: { errors } } = useForm<{ name: string; balance: string }>({ defaultValues: { name: account.name, balance: account.balance } })
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  async function save(values: { name: string; balance: string }) {
    if (saving.current) return
    if (authAccountId() !== ownerId || activeWorkspaceId() !== account.workspace_id) { setError('Your workspace or session changed. Close these details and try again.'); return }
    const input: AccountUpdate = {}
    if (values.name.trim() !== account.name) input.name = values.name.trim()
    if (!linked && values.balance.trim() !== account.balance) input.balance = values.balance.trim()
    if (!Object.keys(input).length) { onClose(); return }
    saving.current = true; onBusyChange(true); setError('')
    controller.current = new AbortController()
    try {
      const result = await updateAccount(account.workspace_id, account.account_id, input, controller.current.signal)
      if (authAccountId() !== ownerId) return
      client.setQueryData<ApiAccount[]>(['accounts', ownerId, account.workspace_id], previous => previous?.map(row => row.account_id === result.account_id ? result : row))
      if (mounted.current && activeWorkspaceId() === account.workspace_id) onSaved()
    } catch (failure) {
      if (mounted.current && !controller.current.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not save this account. Please try again.')
    } finally {
      // A cancelled HTTP request can still commit on the server; refresh on return, too.
      if (authAccountId() === ownerId) for (const feature of ['accounts', 'account-details', 'dashboard', 'statistics']) void client.invalidateQueries({ queryKey: [feature, ownerId, account.workspace_id] })
      saving.current = false
      if (mounted.current) onBusyChange(false)
    }
  }
  return <KeyboardForm validateField={trigger} onSubmit={event => { void handleSubmit(save)(event) }} noValidate aria-busy={busy} className="mt-5 space-y-5">
    <p className="text-sm text-[#526259]">{account.banking_connection_id !== null ? 'Revolut · Enable Banking' : linked ? 'Revolut-linked' : 'Manual / internal'} · {formatAccountBalance(account)}</p>
    <p id={`${prefix}-source`} className="rounded-xl bg-[#f7f8f2] p-4 text-sm text-[#526259]">{linked ? 'The bank manages this balance, even when the connection expires. You can change the display name.' : 'This balance is managed internally. You can update it here; local transactions also adjust it.'}</p>
    {error && <p role="alert" className="rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{error}</p>}
    <fieldset disabled={busy} className="grid gap-5">
      <label className="grid gap-2 text-sm">Display name<Input aria-label="Display name" autoFocus maxLength={120} {...register('name', { validate: value => value.trim().length > 0 || 'Display name is required.', maxLength: { value: 120, message: 'Use 120 characters or fewer.' } })} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${prefix}-name-error` : undefined} />{errors.name && <span id={`${prefix}-name-error`} role="alert" className="text-xs text-[#a43b32]">{errors.name.message}</span>}</label>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <label className="grid gap-2 text-sm">Currency<Input readOnly value={account.currency} className="bg-[#f7f8f2]" /></label>
        <label className="grid gap-2 text-sm">Current balance ({account.currency})<Input aria-label={`Current balance (${account.currency})`} readOnly={linked} inputMode="decimal" {...register('balance', { validate: value => linked || (/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim()) && Math.abs(Number(value)) <= 99999999.99) || 'Enter a balance between -99,999,999.99 and 99,999,999.99 with up to two decimal places.' })} aria-invalid={Boolean(errors.balance)} aria-describedby={`${prefix}-source${errors.balance ? ` ${prefix}-balance-error` : ''}`} className={linked ? 'bg-[#f7f8f2]' : ''} />{errors.balance && <span id={`${prefix}-balance-error`} role="alert" className="text-xs text-[#a43b32]">{errors.balance.message}</span>}</label>
      </div>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Close</button><button disabled={busy} type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-40">{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? 'Saving…' : 'Save changes'}</button></div>
    {canDelete && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e5df] pt-5"><div><p className="text-sm font-medium">Remove this account</p><p className="mt-1 text-xs text-[#526259]">Deleting this account also permanently deletes its transactions and linked expense requests.</p></div><button type="button" disabled={busy} onClick={() => onDelete(account)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#e8c6bf] px-4 py-3 text-sm text-[#a43b32] hover:bg-[#fcf0ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a43b32] disabled:opacity-40"><Trash2 size={16} aria-hidden="true" />Delete account</button></div>}
    <button type="button" disabled={busy} onClick={onClose} aria-label="Close account details" className="absolute top-6 right-6 rounded-lg p-2 hover:bg-[#eaf0e6] disabled:opacity-40"><X size={20} /></button>
  </KeyboardForm>
}
