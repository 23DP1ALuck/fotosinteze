import i18n from '@/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { API_URL } from '@/features/auth/api'
import { EnableBankingConnect } from './EnableBankingConnect'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function render(ui: Parameters<typeof rtlRender>[0]) { return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> }) }

const disconnected = { status: 'not_connected', expires_at: null, last_sync_at: null }
beforeEach(() => {
  queryClient.clear()
  const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`
  setAccessToken(token)
  setWorkspace(1, 7)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })

function stubTransport(postResponse: Response) {
  const transport = vi.fn((url: RequestInfo | URL) => Promise.resolve(
    String(url).endsWith('/enable-banking/connection') ? Response.json(disconnected) : postResponse))
  vi.stubGlobal('fetch', transport)
  return transport
}

it('starts consent with the selected workspace, bearer token and browser cookie, then redirects', async () => {
  const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`
  setAccessToken(token)
  const url = 'https://auth.enablebanking.com/authorize?request=signed'
  const fetchMock = stubTransport(Response.json({ authorization_url: url }))
  const assign = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { assign })
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect real Revolut' }))
  expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/enable-banking/authorize`, expect.objectContaining({ method: 'POST', credentials: 'include' }))
  const headers = new Headers(vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith('/enable-banking/authorize'))?.[1]?.headers)
  expect(headers.get('Workspace-ID')).toBe('7')
  expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
  expect(assign).toHaveBeenCalledWith(url)
})

it('shows a failed authorization and allows retry', async () => {
  stubTransport(Response.json({ detail: 'No access to this workspace' }, { status: 403 }))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect real Revolut' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No access to this workspace')
  expect(screen.getByRole('button', { name: 'Connect real Revolut' })).toBeEnabled()
})

it.each(['https://evil.example/steal', 'javascript:alert(1)', 'http://auth.enablebanking.com/x', 'https://auth.enablebanking.com.evil.example/x', 'https://user:password@auth.enablebanking.com/x', 'https://auth.enablebanking.com:444/x', null])('rejects an unexpected authorization URL: %s', async url => {
  const assign = vi.fn()
  vi.stubGlobal('location', { assign })
  stubTransport(Response.json({ authorization_url: url }))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect real Revolut' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected authorization URL')
  expect(assign).not.toHaveBeenCalled()
})

it('shows saved connection status with a reconnect action and refreshes it on return', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ status: 'connected', expires_at: '2030-01-01T00:00:00Z', last_sync_at: null }))
    .mockResolvedValueOnce(Response.json({ status: 'expired', expires_at: '2020-01-01T00:00:00Z', last_sync_at: null }))
  vi.stubGlobal('fetch', fetchMock)
  render(<EnableBankingConnect workspaceId={7} />)
  expect(await screen.findByText('Connected')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reconnect real Revolut' })).toBeEnabled()
  expect(screen.getByText(/Access expires/)).toBeInTheDocument()
  window.dispatchEvent(new Event('focus'))
  expect(await screen.findByText('Authorization expired. Reconnect to continue.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sync accounts and transactions' })).not.toBeInTheDocument()
  const headers = new Headers(fetchMock.mock.calls[0][1].headers)
  expect(headers.get('Workspace-ID')).toBe('7')
})

it.each([
  ['pending', 'Authorization pending. Complete it with your bank or reconnect.'],
  ['failed', 'Authorization failed. Reconnect to try again.'],
])('shows %s authorization state', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...disconnected, status })))
  render(<EnableBankingConnect workspaceId={7} />)
  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reconnect real Revolut' })).toBeEnabled()
})

it('shows status errors and recovers when checking again', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ detail: 'unavailable' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json(disconnected)))
  render(<EnableBankingConnect workspaceId={7} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check Enable Banking connection')
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('Not connected')).toBeInTheDocument()
})

it('does not accept malformed connection status data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'connected', expires_at: 'not-a-date' })))
  render(<EnableBankingConnect workspaceId={7} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check Enable Banking connection')
  expect(screen.queryByText('Connected')).not.toBeInTheDocument()
})


it('syncs transactions and invalidates only the selected workspace finance caches', async () => {
  const features = ['accounts', 'account-details', 'transactions', 'dashboard', 'statistics', 'categories', 'budgets']
  for (const feature of features) {
    queryClient.setQueryData([feature, 1, 7, 'detail'], [])
    queryClient.setQueryData([feature, 1, 8, 'detail'], [])
    queryClient.setQueryData([feature, 2, 7, 'detail'], [])
  }
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(Response.json(
    String(url).endsWith('/enable-banking/connection')
      ? { ...disconnected, status: 'connected' }
      : { accounts_count: 2, imported_count: 3, last_sync_at: '2026-10-25T20:00:00Z' }))))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  expect(await screen.findByText('Synced 2 accounts and imported 3 transactions.')).toBeInTheDocument()
  expect(screen.getByText(/Last sync:/)).toBeInTheDocument()
  for (const feature of features) {
    expect(queryClient.getQueryState([feature, 1, 7, 'detail'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState([feature, 1, 8, 'detail'])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState([feature, 2, 7, 'detail'])?.isInvalidated).toBe(false)
  }
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/enable-banking/sync'))
  expect(call?.[1]?.method).toBe('POST')
  expect(new Headers(call?.[1]?.headers).get('Workspace-ID')).toBe('7')
})

it('shows import errors and allows another attempt', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(String(url).endsWith('/enable-banking/connection')
    ? Response.json({ ...disconnected, status: 'connected' })
    : Response.json({ detail: 'Reconnect Revolut before loading accounts' }, { status: 409 }))))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Revolut before loading accounts')
  expect(screen.getByRole('button', { name: 'Sync accounts and transactions' })).toBeEnabled()
})


it('accepts the second Enable Banking consent origin', async () => {
  const assign = vi.fn()
  vi.stubGlobal('location', { assign })
  stubTransport(Response.json({ authorization_url: 'https://tilisy.enablebanking.com/authorize?id=1' }))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect real Revolut' }))
  expect(assign).toHaveBeenCalledWith('https://tilisy.enablebanking.com/authorize?id=1')
})

it('aborts authorization when the workspace changes and ignores its late redirect', async () => {
  let finish: (response: Response) => void = () => {}
  const assign = vi.fn()
  vi.stubGlobal('location', { assign })
  const transport = vi.fn((url: RequestInfo | URL) => String(url).endsWith('/connection')
    ? Promise.resolve(Response.json(disconnected))
    : new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', transport)
  const { rerender } = render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect real Revolut' }))
  const consent = transport.mock.calls.find(([url]) => String(url).endsWith('/authorize'))
  const signal = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/authorize'))?.[1]?.signal
  expect(consent).toBeDefined()
  rerender(<EnableBankingConnect workspaceId={8} />)
  expect(signal?.aborted).toBe(true)
  await act(async () => finish(Response.json({ authorization_url: 'https://auth.enablebanking.com/authorize' })))
  expect(assign).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Connect real Revolut' })).toBeEnabled()
})

it('ignores a sync response after the authenticated account changes', async () => {
  let finish: (response: Response) => void = () => {}
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL) => String(url).endsWith('/connection')
    ? Promise.resolve(Response.json({ ...disconnected, status: 'connected' }))
    : new Promise<Response>(resolve => { finish = resolve })))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  const signal = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/sync'))?.[1]?.signal
  act(() => setAccessToken(`h.${btoa(JSON.stringify({ sub: '2', exp: Date.now() / 1000 + 3600 }))}.s`))
  expect(signal?.aborted).toBe(true)
  await act(async () => finish(Response.json({ accounts_count: 1, imported_count: 5, last_sync_at: '2026-10-25T20:00:00Z' })))
  expect(screen.queryByText(/imported 5 transactions/)).not.toBeInTheDocument()
  expect(invalidate).not.toHaveBeenCalled()
  invalidate.mockRestore()
})

it('hides syncing when the connection is not active', async () => {
  stubTransport(Response.json({}))
  render(<EnableBankingConnect workspaceId={7} />)
  await screen.findByText('Not connected')
  expect(screen.queryByRole('button', { name: 'Sync accounts and transactions' })).not.toBeInTheDocument()
})


it('blocks duplicate syncs while pending and allows retry after malformed sync data', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL) => String(url).endsWith('/connection')
    ? Promise.resolve(Response.json({ ...disconnected, status: 'connected' }))
    : new Promise<Response>(resolve => { finish = resolve })))
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.dblClick(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reconnect real Revolut' })).toBeDisabled()
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sync'))).toHaveLength(1)
  await act(async () => finish(Response.json({ accounts_count: -1, imported_count: 3, last_sync_at: 'bad' })))
  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected sync data')
  expect(screen.getByRole('button', { name: 'Sync accounts and transactions' })).toBeEnabled()
  expect(screen.queryByText(/Last sync:/)).not.toBeInTheDocument()
})

it('retranslates sync results and controls without reloading the connection', async () => {
  const transport = vi.fn((url: RequestInfo | URL) => Promise.resolve(String(url).endsWith('/connection')
    ? Response.json({ ...disconnected, status: 'connected' })
    : Response.json({ accounts_count: 2, imported_count: 5, last_sync_at: '2026-10-26T10:00:00Z' })))
  vi.stubGlobal('fetch', transport)
  render(<EnableBankingConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  expect(await screen.findByText('Synced 2 accounts and imported 5 transactions.')).toBeInTheDocument()
  const calls = transport.mock.calls.length
  await act(async () => { await i18n.changeLanguage('lv') })
  expect(screen.getByText('Sinhronizēti 2 konti, importēti 5 darījumi.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sinhronizēt kontus un darījumus' })).toBeInTheDocument()
  await act(async () => { await i18n.changeLanguage('ru') })
  expect(screen.getByText('Синхронизация: 2 счёта; импорт: 5 операций.')).toBeInTheDocument()
  expect(transport).toHaveBeenCalledTimes(calls)
})
