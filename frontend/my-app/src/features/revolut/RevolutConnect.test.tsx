import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { API_URL } from '@/features/auth/api'
import { RevolutConnect } from './RevolutConnect'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function render(ui: Parameters<typeof rtlRender>[0]) { return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) }

const disconnected = { status: 'not_connected', expires_at: null, last_sync_at: null }
beforeEach(() => {
  queryClient.clear()
  const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`
  setAccessToken(token)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })

function stubTransport(postResponse: Response) {
  const transport = vi.fn((url: RequestInfo | URL) => Promise.resolve(
    String(url).endsWith('/revolut/connection') ? Response.json(disconnected) : postResponse))
  vi.stubGlobal('fetch', transport)
  return transport
}

it('starts consent with the selected workspace, bearer token and browser cookie, then redirects', async () => {
  const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`
  setAccessToken(token)
  const url = 'https://sandbox-oba.revolut.com/ui/index.html?request=signed'
  const fetchMock = stubTransport(Response.json({ authorization_url: url }))
  const assign = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { assign })
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/revolut/authorize`, expect.objectContaining({ method: 'POST', credentials: 'include' }))
  const headers = new Headers(vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith('/revolut/authorize'))?.[1]?.headers)
  expect(headers.get('Workspace-ID')).toBe('7')
  expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
  expect(assign).toHaveBeenCalledWith(url)
})

it('shows a failed authorization and allows retry', async () => {
  stubTransport(Response.json({ detail: 'No access to this workspace' }, { status: 403 }))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No access to this workspace')
  expect(screen.getByRole('button', { name: 'Connect Revolut sandbox' })).toBeEnabled()
})

it.each(['https://evil.example/steal', 'javascript:alert(1)', null])('rejects an unexpected authorization URL: %s', async url => {
  const assign = vi.fn()
  vi.stubGlobal('location', { assign })
  stubTransport(Response.json({ authorization_url: url }))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected authorization URL')
  expect(assign).not.toHaveBeenCalled()
})

it('shows saved connection status with a reconnect action and refreshes it on return', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ status: 'connected', expires_at: '2030-01-01T00:00:00Z', last_sync_at: null }))
    .mockResolvedValueOnce(Response.json({ status: 'expired', expires_at: '2020-01-01T00:00:00Z', last_sync_at: null }))
  vi.stubGlobal('fetch', fetchMock)
  render(<RevolutConnect workspaceId={7} />)
  expect(await screen.findByText('Connected')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reconnect Revolut sandbox' })).toBeEnabled()
  expect(screen.getByText(/Access expires/)).toBeInTheDocument()
  window.dispatchEvent(new Event('focus'))
  expect(await screen.findByText('Authorization expired. Reconnect to continue.')).toBeInTheDocument()
  const headers = new Headers(fetchMock.mock.calls[0][1].headers)
  expect(headers.get('Workspace-ID')).toBe('7')
})

it.each([
  ['pending', 'Authorization pending. Complete it in Revolut or reconnect.'],
  ['failed', 'Authorization failed. Reconnect to try again.'],
])('shows %s authorization state', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...disconnected, status })))
  render(<RevolutConnect workspaceId={7} />)
  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reconnect Revolut sandbox' })).toBeEnabled()
})

it('shows status errors and recovers when checking again', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ detail: 'unavailable' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json(disconnected)))
  render(<RevolutConnect workspaceId={7} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check Revolut connection')
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('Not connected')).toBeInTheDocument()
})

it('does not accept malformed connection status data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'connected', expires_at: 'not-a-date' })))
  render(<RevolutConnect workspaceId={7} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check Revolut connection')
  expect(screen.queryByText('Connected')).not.toBeInTheDocument()
})


it('loads accounts and refreshes workspace account queries after success', async () => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(Response.json(
    String(url).endsWith('/revolut/connection')
      ? { ...disconnected, status: 'connected' }
      : { imported_count: 3, last_sync_at: '2026-10-25T20:00:00Z' }))))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Load accounts' }))
  expect(await screen.findByText('Loaded 3 Revolut accounts.')).toBeInTheDocument()
  expect(screen.getByText(/Last account sync:/)).toBeInTheDocument()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 1, 7] })
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/revolut/accounts/import'))
  expect(call?.[1]?.method).toBe('POST')
  expect(new Headers(call?.[1]?.headers).get('Workspace-ID')).toBe('7')
  invalidate.mockRestore()
})

it('shows import errors and allows another attempt', async () => {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(String(url).endsWith('/revolut/connection')
    ? Response.json({ ...disconnected, status: 'connected' })
    : Response.json({ detail: 'Reconnect Revolut before loading accounts' }, { status: 409 }))))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Load accounts' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Revolut before loading accounts')
  expect(screen.getByRole('button', { name: 'Load accounts' })).toBeEnabled()
})
