import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Info, Landmark, LoaderCircle, ShieldCheck, Trash2, Wallet, X } from 'lucide-react'
import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { AccountRequestError, deleteAccount, formatAccountBalance, type ApiAccount } from './api'

export function DeleteAccountDialog({ workspaceId, account, onClose, onDeleted }: {
  workspaceId: number; account: ApiAccount; onClose: () => void; onDeleted: () => void
}) {
  const client = useQueryClient()
  const ownerId = authAccountId()
  const dialog = useRef<HTMLDialogElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const pending = useRef(false)
  const mounted = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [protectedAccount, setProtectedAccount] = useState(false)
  const linked = account.connection_id !== null || account.banking_connection_id !== null

  useEffect(() => {
    mounted.current = true
    const element = dialog.current
    element?.showModal()
    keepButton.current?.focus()
    return () => { mounted.current = false; controller.current?.abort(); element?.close() }
  }, [])

  async function remove() {
    if (pending.current || linked || protectedAccount) return
    if (authAccountId() !== ownerId || activeWorkspaceId() !== workspaceId || account.workspace_id !== workspaceId) {
      setError('Your workspace or session changed. Close this dialog and try again.')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    controller.current = new AbortController()
    try {
      await deleteAccount(workspaceId, account.account_id, controller.current.signal)
      if (authAccountId() !== ownerId) return
      client.setQueryData<ApiAccount[]>(['accounts', ownerId, workspaceId], previous => previous?.filter(row => row.account_id !== account.account_id))
      client.removeQueries({ queryKey: ['account-details', ownerId, workspaceId, account.account_id] })
      if (mounted.current && activeWorkspaceId() === workspaceId) onDeleted()
    } catch (cause) {
      if (!mounted.current || controller.current.signal.aborted || authAccountId() !== ownerId) return
      if (cause instanceof AccountRequestError && cause.status === 409) {
        setProtectedAccount(true)
        setError('This account has transaction history or a bank connection and cannot be deleted. Your account and transaction history are unchanged.')
      } else if (cause instanceof AccountRequestError && cause.status >= 500) {
        setError('We couldn’t delete this account right now. Please try again in a moment.')
      } else {
        setError(cause instanceof Error ? cause.message : 'We couldn’t delete this account. Please try again.')
      }
    } finally {
      // A cancelled request can still finish on the server. Refresh this workspace on return.
      if (authAccountId() === ownerId) for (const feature of ['accounts', 'dashboard', 'statistics', 'transactions', 'budgets', 'business-budgets']) {
        void client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })
      }
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={`${titleId}-description`} aria-busy={busy}
    onClick={dismissDialogOnBackdropClick} onCancel={event => { event.preventDefault(); if (!pending.current) onClose() }}
    className="m-auto max-h-[calc(100svh-32px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 backdrop:backdrop-blur-[4px] max-sm:p-5">
    <div className={`mb-5 grid size-12 place-items-center rounded-2xl ${linked ? 'bg-[#eaf0e6] text-[#526259]' : 'bg-[#fcf0ed] text-[#a43b32]'}`} aria-hidden="true">{linked ? <ShieldCheck size={23} /> : <Trash2 size={23} />}</div>
    <h2 id={titleId} className="pr-7 text-2xl font-semibold! tracking-tight">Delete account?</h2>
    <p id={`${titleId}-description`} className="mt-3 text-sm leading-relaxed text-[#526259]">{linked
      ? 'Connected bank accounts are protected and can’t be deleted here. Your bank connection and transaction history will stay unchanged.'
      : 'This account and its displayed balance will be removed from your workspace. This cannot be undone.'}</p>
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#e1e5df] bg-[#f7f8f2] p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#526259]" aria-hidden="true">{linked ? <Landmark size={19} /> : <Wallet size={19} />}</span>
      <div className="min-w-0 flex-1"><p className="wrap-anywhere text-sm font-semibold">{account.name}</p><p className="mt-1 text-xs text-[#526259]">{linked ? 'Bank-connected account' : 'Manual account'} · {account.currency}</p><p className="mt-3 wrap-anywhere text-xl font-semibold tabular-nums">{formatAccountBalance(account)}</p></div>
    </div>
    {!linked && account.is_main && <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#f3f5ee] p-3 text-xs leading-relaxed text-[#526259]"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><p>This is your main account. After deleting it, choose another main account for new transactions.</p></div>}
    {!linked && !error && <p className="mt-4 text-xs leading-relaxed text-[#627168]">Accounts with transaction history are protected. We’ll check before deleting.</p>}
    {error && <div role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-4 text-sm leading-relaxed text-[#a43b32]"><p className="font-medium">{protectedAccount ? 'This account is protected' : 'Account wasn’t deleted'}</p><p className="mt-1">{error}</p></div>}
    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[#e1e5df] pt-5 max-sm:flex-col-reverse">
      <button ref={keepButton} autoFocus type="button" disabled={busy} onClick={onClose} className="rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm font-medium hover:bg-[#dce6d4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#193f33] disabled:opacity-40">{linked ? 'Got it' : 'Keep account'}</button>
      {!linked && <button type="button" disabled={busy || protectedAccount} onClick={() => { void remove() }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#a43b32] px-5 py-3 text-sm font-medium text-white hover:bg-[#8e3029] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a43b32] disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}{busy ? 'Deleting…' : error && !protectedAccount ? 'Try again' : 'Delete account'}</button>}
    </div>
    <button type="button" disabled={busy} onClick={onClose} aria-label="Close delete account dialog" className="absolute top-5 right-5 rounded-lg p-2 text-[#526259] hover:bg-[#eaf0e6] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"><X size={19} aria-hidden="true" /></button>
  </dialog>
}
