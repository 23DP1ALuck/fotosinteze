import { vi } from 'vitest'
// Auth tests use the real dashboard; provide its membership endpoint separately from auth responses.
export function stubAuthFetch(mock: unknown) {
  const transport = mock as typeof fetch
  vi.stubGlobal('fetch',vi.fn((url: RequestInfo | URL, init?: RequestInit) => String(url).endsWith('/workspaces')
    ? Promise.resolve(Response.json([{ id:7, name:'Personal', type:'PERSONAL', role:'OWNER' }])) : transport(url,init)))
}
