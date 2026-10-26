import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { deleteTransaction, type ApiTransaction } from './api'

export function DeleteTransactionDialog({ workspaceId, transaction, onClose, onDeleted }: {
  workspaceId: number; transaction: ApiTransaction; onClose: () => void; onDeleted: () => void
}) {
  const client = useQueryClient()
  const ownerId = authAccountId()
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef(false)
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = transaction.source === 'BANK' || transaction.expense_id !== null
  useEffect(() => { dialog.current?.showModal() }, [])
  async function confirm() {
    if (pending.current || locked) return
    if (authAccountId() !== ownerId || activeWorkspaceId() !== workspaceId) {
      setError('Your workspace changed. Close this dialog and try again.')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await deleteTransaction(workspaceId, transaction.transaction_id)
      if (authAccountId() !== ownerId) return
      await Promise.all(['statistics', 'transactions', 'dashboard', 'accounts', 'budgets', 'business-budgets'].map(feature => client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })))
      if (activeWorkspaceId() === workspaceId) onDeleted()
    } catch (cause) {
      if (authAccountId() === ownerId && activeWorkspaceId() === workspaceId) setError(cause instanceof Error ? cause.message : 'Could not delete the transaction. Please try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={titleId} aria-describedby={`${titleId}-description`} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[min(460px,calc(100%_-_32px))] rounded-2xl border-0 bg-white p-6 text-[#193f33] backdrop:bg-[#102c23]/40">
    <h2 id={titleId} className="text-xl font-semibold!">Delete transaction?</h2>
    <p id={`${titleId}-description`} className="mt-4 text-sm wrap-anywhere">Delete “{transaction.description}”? This cannot be undone. Its effect on a manual account’s balance will be reversed.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-3 text-sm text-[#a43b32]">{error}</p>}
    <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm disabled:opacity-50">Cancel</button><button type="button" disabled={busy || locked} onClick={() => { void confirm() }} className="rounded-xl bg-[#a43b32] px-4 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete transaction'}</button></div>
  </dialog>
}
