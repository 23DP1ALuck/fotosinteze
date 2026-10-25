import { useEffect, useState } from 'react'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const connectionSchema = z.object({
  status: z.enum(['not_connected', 'connected', 'pending', 'expired', 'failed']),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  last_sync_at: z.string().datetime({ offset: true }).nullable(),
})
const statusLabels = {
  not_connected: 'Not connected',
  connected: 'Connected',
  pending: 'Authorization pending. Complete it in Revolut or reconnect.',
  expired: 'Authorization expired. Reconnect to continue.',
  failed: 'Authorization failed. Reconnect to try again.',
}

export function RevolutConnect({ workspaceId }: { workspaceId: number }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<z.infer<typeof connectionSchema> | null>(null)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    let controller: AbortController
    async function load() {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const response = await authenticatedFetch('/revolut/connection', { signal: request.signal }, { workspaceId })
        if (!response.ok) throw new Error()
        const data = connectionSchema.parse(await response.json())
        if (request.signal.aborted) return
        setConnection(data)
        setStatusError('')
      } catch {
        if (request.signal.aborted) return
        setConnection(null)
        setStatusError('Could not check Revolut connection. Return to this tab to retry.')
      }
    }
    void load()
    window.addEventListener('focus', load)
    return () => { controller?.abort(); window.removeEventListener('focus', load) }
  }, [workspaceId])

  async function connect() {
    setPending(true)
    setError('')
    try {
      const response = await authenticatedFetch('/revolut/authorize', {
        method: 'POST', credentials: 'include',
      }, { workspaceId })
      if (!response.ok) throw new Error(await readApiErrorMessage(response))
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !('authorization_url' in data) || typeof data.authorization_url !== 'string') {
        throw new Error('The server returned an unexpected authorization URL. Please retry.')
      }
      const url = new URL(data.authorization_url)
      if (url.origin !== 'https://sandbox-oba.revolut.com' || url.pathname !== '/ui/index.html' || url.username || url.password) {
        throw new Error('The server returned an unexpected authorization URL. Please retry.')
      }
      location.assign(url.href)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to Revolut. Please retry.')
      setPending(false)
    }
  }

  return <section className="mt-6 rounded-2xl bg-[#eaf0e5] p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-base font-semibold">Revolut sandbox</h2>
        <p role="status" className="mt-1 text-sm">{connection ? statusLabels[connection.status] : statusError ? 'Connection status unavailable' : 'Checking connection…'}</p>
        {connection?.expires_at && <p className="mt-1 text-xs text-[#526259]">Access expires: {new Date(connection.expires_at).toLocaleString()}</p>}
        <p className="mt-1 text-xs text-[#526259]">Authorize a test account. Transaction imports are not available yet.</p></div>
      <button type="button" disabled={pending} onClick={connect} className="rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white disabled:opacity-50">
        {pending ? 'Opening Revolut…' : connection && connection.status !== 'not_connected' ? 'Reconnect Revolut sandbox' : 'Connect Revolut sandbox'}
      </button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {statusError && <p role="alert" className="mt-3 text-sm text-red-800">{statusError}</p>}
  </section>
}
