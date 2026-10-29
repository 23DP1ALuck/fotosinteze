import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { useBanking } from './banking'

export function DeleteBankConnectionDialog({ workspaceId, onClose }: { workspaceId: number; onClose: () => void }) {
  const { t } = useTranslation('finance')
  const bank = useBanking(workspaceId)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus() }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={`${titleId}-description`} aria-busy={bank.busy} onCancel={event => { event.preventDefault(); if (!bank.busy) onClose() }} className="m-auto w-[min(480px,calc(100%_-_32px))] rounded-2xl border-0 bg-white p-6 text-[#193f33] backdrop:bg-[#102c23]/40">
    <h2 id={titleId} className="text-xl font-semibold">{t('bankDeleteTitle')}</h2>
    <p id={`${titleId}-description`} className="mt-4 text-sm">{t('bankDeleteWarning')}</p>
    {bank.mutation.error && <p role="alert" className="mt-4 text-sm text-red-800">{f(bank.mutation.error.message, true)}</p>}
    <div className="mt-6 flex justify-end gap-3">
      <button ref={cancel} type="button" disabled={bank.busy} onClick={onClose} className="rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm">{f('Cancel')}</button>
      <button type="button" disabled={bank.busy} className="rounded-xl bg-[#a43b32] px-4 py-3 text-sm text-white disabled:opacity-50" onClick={() => {
        if (bank.busy || authAccountId() !== bank.ownerId || activeWorkspaceId() !== workspaceId) return
        bank.mutation.mutate('delete', { onSuccess: () => { if (authAccountId() === bank.ownerId && activeWorkspaceId() === workspaceId) onClose() } })
      }}>{bank.busy ? f('Deleting…') : t('bankDeleteAction')}</button>
    </div>
  </dialog>
}
