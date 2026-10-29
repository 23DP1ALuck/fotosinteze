import { useTranslation } from 'react-i18next'
import { getLocale } from '@/i18n'
import { financeMessage as f } from '@/i18n/finance-message'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'
import { subscribeAccessToken } from '@/features/auth/storage'
import { authAccountId } from '@/features/workspaces/workspace-state'
import { useBanking, useBankAutoPreference } from './banking'

const statusLabels = {
  not_connected: 'Not connected',
  connected: 'Connected',
  pending: 'Authorization pending. Complete it with your bank or reconnect.',
  expired: 'Authorization expired. Reconnect to continue.',
  failed: 'Authorization failed. Reconnect to try again.',
}

export function EnableBankingConnect({ workspaceId }: { workspaceId: number }) {
  const ownerId = useSyncExternalStore(subscribeAccessToken, authAccountId)
  return <Connection key={`${ownerId}-${workspaceId}`} workspaceId={workspaceId} ownerId={ownerId} />
}

function Connection({ workspaceId, ownerId }: { workspaceId: number; ownerId: number | null }) {
  const { t } = useTranslation('finance')
  const bank = useBanking(workspaceId)
  const preference = useBankAutoPreference(ownerId, workspaceId)
  const operation = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState<'authorize' | null>(null)
  const connection = bank.data
  const statusError = bank.isError ? 'Could not check Enable Banking connection. Return to this tab to retry.' : ''
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ accounts: number; transactions: number } | null>(null)

  useEffect(() => () => { operation.current?.abort() }, [])

  async function perform(action: 'authorize' | 'sync') {
    if (bank.busy || operation.current && !operation.current.signal.aborted) return
    if (action === 'sync') {
      setNotice(null)
      bank.mutation.mutate('sync', { onSuccess: result => { if (result) setNotice({ accounts: result.accounts_count, transactions: result.imported_count }) } })
      return
    }
    const request = new AbortController()
    operation.current = request
    setBusy(action)
    setError('')
    setNotice(null)
    try {
      const response = await authenticatedFetch(`/enable-banking/${action}`, {
        method: 'POST', credentials: 'include', signal: request.signal,
      }, { workspaceId })
      if (!response.ok) throw new Error(await readApiErrorMessage(response))
      const data: unknown = await response.json()
      if (request.signal.aborted || authAccountId() !== ownerId) return
      if (action === 'authorize') {
        const result = z.object({ authorization_url: z.string().url() }).safeParse(data)
        if (!result.success) throw new Error('The server returned an unexpected authorization URL. Please retry.')
        const url = new URL(result.data.authorization_url)
        if (!['https://auth.enablebanking.com', 'https://tilisy.enablebanking.com'].includes(url.origin) || url.username || url.password) {
          throw new Error('The server returned an unexpected authorization URL. Please retry.')
        }
        location.assign(url.href)
      }
    } catch (cause) {
      if (!request.signal.aborted && authAccountId() === ownerId) {
        setError(cause instanceof Error ? cause.message : 'Could not connect to your bank. Please retry.')
      }
    } finally {
      if (!request.signal.aborted && authAccountId() === ownerId) setBusy(null)
      if (operation.current === request) operation.current = null
    }
  }

  return <section aria-label={t('realRevolutConnection')} className="mt-6 rounded-2xl bg-[#eaf0e5] p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-base font-semibold">{t('realRevolutHeading')}</h2>
        <p role="status" className="mt-1 text-sm">{connection ? f(statusLabels[connection.status]) : statusError ? t('bankStatusUnavailable') : t('bankChecking')}</p>
        <p className="mt-1 text-xs text-[#68796e]">{t('realRevolutDescription')}</p>
        {connection?.expires_at && <p className="mt-1 text-xs text-[#68796e]">{f('Access expires:')} {new Date(connection.expires_at).toLocaleString(getLocale())}</p>}
        {connection?.last_sync_at && <p className="mt-1 text-xs text-[#68796e]">{t('bankLastSync')} {new Date(connection.last_sync_at).toLocaleString(getLocale())}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        {connection?.status === 'connected' && <button type="button" disabled={busy !== null || bank.busy || ownerId === null} onClick={() => void perform('sync')} className="rounded-xl bg-white px-4 py-3 text-sm disabled:opacity-50">{bank.busy ? f('Syncing…') : t('bankSyncAction')}</button>}
        <button type="button" disabled={busy !== null || bank.busy || ownerId === null} onClick={() => void perform('authorize')} className="rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white disabled:opacity-50">{busy === 'authorize' ? t('bankOpening') : connection && connection.status !== 'not_connected' ? t('bankReconnect') : t('bankConnect')}</button>
      </div>
    </div>
    {connection?.status === 'connected' && <div className="mt-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={preference.enabled} disabled={!connection.auto_sync_interval_seconds} onChange={event => preference.setEnabled(event.target.checked)} />{t('bankAutoRefresh')}</label>{!connection.auto_sync_interval_seconds && <p className="mt-1 text-xs">{t('bankProviderConfirmation')}</p>}<button type="button" disabled={bank.busy || busy !== null} onClick={() => bank.mutation.mutate('full')} className="mt-3 underline disabled:opacity-50">{t('bankFullSync')}</button></div>}
    {connection?.next_sync_at && <p role="status" className="mt-3 text-sm">{t('bankNextSync', { time: new Date(connection.next_sync_at).toLocaleString(getLocale()) })}</p>}
    {bank.mutation.error && <p role="alert" className="mt-3 text-sm text-red-800">{f(bank.mutation.error.message, true)}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{t('bankSyncSummary', { accounts: t('bankAccounts', { count: notice.accounts }), transactions: t('bankTransactions', { count: notice.transactions }) })}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{f(error, true)}</p>}
    {statusError && <p role="alert" className="mt-3 text-sm text-red-800">{f(statusError, true)}</p>}
  </section>
}
