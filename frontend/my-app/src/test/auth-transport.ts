import { vi } from 'vitest'
// Auth tests use the real dashboard; keep its membership and Revolut status reads separate from auth responses.
export function stubAuthFetch(mock: unknown) {
  const transport = mock as typeof fetch
  vi.stubGlobal('fetch',vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/workspaces')) return Promise.resolve(Response.json([{ id:7, name:'Personal', type:'PERSONAL', role:'OWNER' }]))
    if (String(url).endsWith('/revolut/connection')) return Promise.resolve(Response.json({ status:'not_connected', expires_at:null, last_sync_at:null }))
    return transport(url,init)
  }))
}
