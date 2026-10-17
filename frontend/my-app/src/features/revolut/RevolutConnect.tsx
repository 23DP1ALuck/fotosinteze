import { useState } from 'react'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

export function RevolutConnect({ workspaceId }: { workspaceId: number }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

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
      <div><h2 className="text-base font-semibold">Revolut sandbox</h2><p className="mt-1 text-xs text-[#68796e]">Authorize a test account. Transaction imports are not available yet.</p></div>
      <button type="button" disabled={pending} onClick={connect} className="rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white disabled:opacity-50">
        {pending ? 'Opening Revolut…' : 'Connect Revolut sandbox'}
      </button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </section>
}
