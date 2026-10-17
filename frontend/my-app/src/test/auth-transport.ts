import { vi } from 'vitest'
import { createFinanceTransport } from './finance-transport'
// Auth tests render the real dashboard; keep its API responses separate from auth responses.
export function stubAuthFetch(mock: unknown) {
  const transport = mock as typeof fetch
  const finance = createFinanceTransport()
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/workspaces')) return Promise.resolve(Response.json([{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }]))
    const response = finance.respond(url, init)
    return response ? Promise.resolve(response) : transport(url, init)
  }))
}
