import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'
import { subscribeAccessToken } from '@/features/auth/storage'
import { authAccountId } from '@/features/workspaces/workspace-state'

const connectionSchema = z.object({
  status: z.enum(['not_connected', 'connected', 'pending', 'expired', 'failed']),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  last_sync_at: z.string().datetime({ offset: true }).nullable(),
})
const syncSchema = z.object({
  accounts_count: z.number().int().nonnegative(),
  imported_count: z.number().int().nonnegative(),
  last_sync_at: z.string().datetime({ offset: true }),
})
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
  const client = useQueryClient()
  const operation = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState<'authorize' | 'sync' | null>(null)
  const [connection, setConnection] = useState<z.infer<typeof connectionSchema> | null>(null)
  const [statusError, setStatusError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let controller: AbortController | undefined
    async function load() {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const response = await authenticatedFetch('/enable-banking/connection', { signal: request.signal }, { workspaceId })
        if (!response.ok) throw new Error()
        const data = connectionSchema.parse(await response.json())
        if (request.signal.aborted || authAccountId() !== ownerId) return
        setConnection(data)
        setStatusError('')
      } catch {
        if (request.signal.aborted || authAccountId() !== ownerId) return
        setConnection(null)
        setStatusError('Could not check Enable Banking connection. Return to this tab to retry.')
      }
    }
    void load()
    window.addEventListener('focus', load)
    return () => {
      controller?.abort()
      operation.current?.abort()
      window.removeEventListener('focus', load)
    }
  }, [workspaceId, ownerId])

  async function perform(action: 'authorize' | 'sync') {
    if (operation.current && !operation.current.signal.aborted) return
    const request = new AbortController()
    operation.current = request
    setBusy(action)
    setError('')
    setNotice('')
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
      } else {
        const result = syncSchema.safeParse(data)
        if (!result.success) throw new Error('The server returned unexpected sync data. Please retry.')
        setConnection(current => current && { ...current, last_sync_at: result.data.last_sync_at })
        setNotice(`Synced ${result.data.accounts_count} accounts and imported ${result.data.imported_count} transactions.`)
        await Promise.all(['accounts', 'account-details', 'transactions', 'dashboard', 'statistics', 'categories', 'budgets']
          .map(feature => client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })))
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

  return <section aria-label="Real Revolut connection" className="mt-6 rounded-2xl bg-[#eaf0e5] p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-base font-semibold">Real Revolut · Enable Banking</h2>
        <p role="status" className="mt-1 text-sm">{connection ? statusLabels[connection.status] : statusError ? 'Connection status unavailable' : 'Checking connection…'}</p>
        <p className="mt-1 text-xs text-[#68796e]">Connect your real Personal Revolut account to sync balances and booked transactions.</p>
        {connection?.expires_at && <p className="mt-1 text-xs text-[#68796e]">Access expires: {new Date(connection.expires_at).toLocaleString()}</p>}
        {connection?.last_sync_at && <p className="mt-1 text-xs text-[#68796e]">Last sync: {new Date(connection.last_sync_at).toLocaleString()}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        {connection?.status === 'connected' && <button type="button" disabled={busy !== null || ownerId === null} onClick={() => void perform('sync')} className="rounded-xl bg-white px-4 py-3 text-sm disabled:opacity-50">{busy === 'sync' ? 'Syncing…' : 'Sync accounts and transactions'}</button>}
        <button type="button" disabled={busy !== null || ownerId === null} onClick={() => void perform('authorize')} className="rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white disabled:opacity-50">{busy === 'authorize' ? 'Opening bank…' : connection && connection.status !== 'not_connected' ? 'Reconnect real Revolut' : 'Connect real Revolut'}</button>
      </div>
    </div>
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {statusError && <p role="alert" className="mt-3 text-sm text-red-800">{statusError}</p>}
  </section>
}
