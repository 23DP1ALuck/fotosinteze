import { vi } from 'vitest'
import { createFinanceTransport } from './finance-transport'
// Auth tests use the real dashboard; keep its data requests separate from auth responses.
export function stubAuthFetch(mock: unknown) {
  const transport = mock as typeof fetch
  const finance = createFinanceTransport()
  vi.stubGlobal('fetch',vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/workspaces')) return Promise.resolve(Response.json([{ id:7, name:'Personal', type:'PERSONAL', role:'OWNER' }]))
    if (String(url).endsWith('/enable-banking/connection')) return Promise.resolve(Response.json({ status:'not_connected', expires_at:null, last_sync_at:null }))
    return finance.respond(url,init) ?? transport(url,init)
  }))
}
