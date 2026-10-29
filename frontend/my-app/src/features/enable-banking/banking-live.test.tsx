import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { EnableBankingConnect } from './EnableBankingConnect'
import { BankPendingTransactions } from './BankPendingTransactions'
import { BankAutoRefresh } from './BankAutoRefresh'
import { connectionSchema } from './banking'

const connected = { status: 'connected', expires_at: null, last_sync_at: null, auto_sync_interval_seconds: 15 as number | null, next_sync_at: null }
const synced = { accounts_count: 1, imported_count: 0, last_sync_at: '2026-10-29T12:00:00Z' }
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  localStorage.clear()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`)
  setWorkspace(1, 7)
})
afterEach(() => { cleanup(); client.clear(); clearSession(); vi.useRealTimers(); vi.unstubAllGlobals() })
function mount(children: React.ReactNode) { return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>) }
function transport(connection = connected) {
  const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === 'DELETE' ? new Response(null, { status: 204 }) : String(url).includes('/sync') ? Response.json(synced) : String(url).endsWith('/pending') ? Response.json({ items: [{ account_id: 1, amount: '12.50', currency: 'EUR', description: 'Unsettled coffee', direction: 'expense', date: null }] }) : Response.json(connection)))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
it('requires explicit deletion confirmation, defaults to cancel and purges only scoped caches', async () => {
  const fetcher = transport()
  for (const workspace of [7, 8]) {
    client.setQueryData(['account-details', 1, workspace, 3], { name: 'cached' })
    client.setQueryData(['bank-pending', 1, workspace], [])
    client.setQueryData(['transactions', 1, workspace], [])
  }
  mount(<EnableBankingConnect workspaceId={7} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete bank connection' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/including manually added entries/)).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete bank connection' }))
  await screen.findByText('Not connected')
  expect(client.getQueryData(['account-details', 1, 7, 3])).toBeUndefined()
  expect(client.getQueryData(['bank-pending', 1, 7])).toBeUndefined()
  expect(client.getQueryData(['account-details', 1, 8, 3])).toBeDefined()
  expect(client.getQueryState(['transactions', 1, 7])?.isInvalidated).toBe(true)
  expect(client.getQueryState(['transactions', 1, 8])?.isInvalidated).toBe(false)
})
it('shows pending transactions separately with their exclusion warning', async () => {
  transport()
  mount(<BankPendingTransactions workspaceId={7} />)
  expect(await screen.findByText('Unsettled coffee')).toBeInTheDocument()
  expect(screen.getByText(/excluded from balances and booked totals/)).toBeInTheDocument()
  expect(screen.getByText('−12.50 EUR')).toBeInTheDocument()
})
it('keeps automatic refresh disabled when unavailable for this connection', async () => {
  transport({ ...connected, auto_sync_interval_seconds: null })
  mount(<EnableBankingConnect workspaceId={7} />)
  expect(await screen.findByRole('checkbox', { name: 'Automatically refresh while I use this workspace' })).toBeDisabled()
  expect(screen.getByText(/unavailable for this connection/)).toBeInTheDocument()
})
it('honors Retry-After and prevents another manual sync before cooldown', async () => {
  const fetcher = transport()
  fetcher.mockImplementation((url) => Promise.resolve(String(url).includes('/sync') ? new Response(null, { status: 429, headers: { 'Retry-After': '120' } }) : Response.json(connected)))
  mount(<><BankAutoRefresh workspaceId={7} /><EnableBankingConnect workspaceId={7} /></>)
  fireEvent.click(await screen.findByRole('button', { name: 'Sync accounts and transactions' }))
  await screen.findByText(/Next refresh available:/)
  fireEvent.focus(window)
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/connection')).length).toBeGreaterThan(1))
  fireEvent.click(screen.getByRole('button', { name: 'Sync accounts and transactions' }))
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/sync'))).toHaveLength(1))
})
it('refreshes after opt-in and interaction then stops while idle', async () => {
  const fetcher = transport()
  vi.useFakeTimers()
  mount(<><BankAutoRefresh workspaceId={7} /><EnableBankingConnect workspaceId={7} /></>)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByText('Connected')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.pointerDown(window)
  await act(async () => { await vi.advanceTimersByTimeAsync(14_000) })
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('automatic=true'))).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  const before = fetcher.mock.calls.filter(([url]) => String(url).includes('/sync')).length
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/sync'))).toHaveLength(before)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  fireEvent.pointerDown(window)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/sync'))).toHaveLength(before)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

it.each(['expired', 'failed', 'pending'])('allows cancelling deletion of a %s connection without deleting data', async status => {
  const fetcher = transport({ ...connected, status })
  mount(<EnableBankingConnect workspaceId={7} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete bank connection' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
})

it('cancels a pending read on deletion and ignores its late response', async () => {
  let finish: (value: Response) => void = () => {}
  let pendingSignal: AbortSignal | null | undefined
  const fetcher = transport()
  fetcher.mockImplementation((url, init) => {
    if (String(url).endsWith('/pending')) {
      pendingSignal = init?.signal
      return new Promise<Response>(resolve => { finish = resolve })
    }
    return Promise.resolve(init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(connected))
  })
  mount(<><EnableBankingConnect workspaceId={7} /><BankPendingTransactions workspaceId={7} /></>)
  await screen.findByText('Loading pending transactions…')
  fireEvent.click(screen.getByRole('button', { name: 'Delete bank connection' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete bank connection' }))
  await screen.findByText('Not connected')
  expect(pendingSignal?.aborted).toBe(true)
  await act(async () => finish(Response.json({ items: [{ account_id: 1, amount: '1', currency: 'EUR', description: 'Stale pending', direction: 'expense', date: null }] })))
  expect(screen.queryByText('Stale pending')).not.toBeInTheDocument()
  expect(client.getQueryData(['bank-pending', 1, 7])).toBeUndefined()
})

it('keeps a rate-limited deletion open with an error, preserves cached data and permits retry', async () => {
  const fetcher = transport()
  let attempts = 0
  fetcher.mockImplementation((_url, init) => Promise.resolve(init?.method === 'DELETE'
    ? ++attempts === 1 ? Response.json({ detail: 'Provider rate limit' }, { status: 429, headers: { 'Retry-After': '120' } }) : new Response(null, { status: 204 })
    : Response.json(connected)))
  client.setQueryData(['account-details', 1, 7, 3], { name: 'Preserved account' })
  client.setQueryData(['bank-pending', 1, 7], [{ description: 'Preserved pending' }])
  mount(<EnableBankingConnect workspaceId={7} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete bank connection' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete bank connection' }))
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Could not complete this action. Please try again.')
  expect(screen.getByText('Connected')).toBeInTheDocument()
  expect(client.getQueryData(['account-details', 1, 7, 3])).toEqual({ name: 'Preserved account' })
  expect(client.getQueryData(['bank-pending', 1, 7])).toEqual([{ description: 'Preserved pending' }])
  expect(client.getQueryState(['account-details', 1, 7, 3])?.isInvalidated).toBe(false)
  const retry = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete bank connection' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  await screen.findByText('Not connected')
  expect(attempts).toBe(2)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(client.getQueryData(['account-details', 1, 7, 3])).toBeUndefined()
})

it('accepts a five-second interval when configured by the backend', () => {
  expect(connectionSchema.parse({ ...connected, auto_sync_interval_seconds: 5 }).auto_sync_interval_seconds).toBe(5)
})
