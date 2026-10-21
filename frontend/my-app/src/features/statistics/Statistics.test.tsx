import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { Statistics } from './Statistics'

const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
let empty = false
let fail = ''
let wrongScope = false
let deferred: ((url: URL) => Promise<Response>) | undefined
function response(url: URL) {
  const base = { workspace_id: wrongScope ? 99 : Number(url.searchParams.get('test_workspace')), currency: 'EUR', date_from: url.searchParams.get('date_from'), date_to: url.searchParams.get('date_to') }
  const kind = url.pathname.split('/').at(-1)
  return Response.json({ ...base, ...(kind === 'summary' ? { income: empty ? '0.00' : '1500.00', expenses: empty ? '0.00' : '120.50' } : { items: kind === 'categories' ? empty ? [] : [{ id: 4, name: 'Travel', amount: '120.50' }] : [{ date: base.date_from, amount: empty ? '0.00' : '120.50' }] }) })
}
beforeEach(() => {
  clearSession(); setAccessToken(token); setWorkspace(1, 7)
  empty = false; fail = ''; wrongScope = false; deferred = undefined
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
    expect(new Headers(init?.headers).get('Workspace-ID')).toBe(new Headers(init?.headers).get('X-Workspace-ID'))
    url.searchParams.set('test_workspace', new Headers(init?.headers).get('Workspace-ID')!)
    if (url.pathname.endsWith(fail) && fail) return Response.json({ detail: 'Statistics temporarily unavailable' }, { status: 503 })
    return deferred ? deferred(url) : response(url)
  }))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
function mount(id = 7) { return render(<Statistics workspaceId={id} role="OWNER" />) }
async function changeRange() {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
}

it('loads all three workspace-scoped charts and exposes readable chart values', async () => {
  mount()
  await waitFor(() => expect(screen.getByRole('region', { name: 'Income vs expenses' })).toHaveTextContent('€1,500.00'))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Spending by category' })).toHaveTextContent('Travel'))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Spending over time' })).toHaveTextContent('€120.50'))
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(vi.mocked(fetch).mock.calls.every(([url]) => /\/statistics\/(summary|categories|timeseries)\?date_from=\d{4}-\d{2}-01&date_to=\d{4}-\d{2}-\d{2}$/.test(String(url)))).toBe(true)
})

it('handles empty totals, categories and zero-filled daily spending', async () => {
  empty = true; mount()
  expect(await screen.findByText('No income or expenses in this period.')).toBeInTheDocument()
  expect(await screen.findByText('No category spending in this period.')).toBeInTheDocument()
  expect(await screen.findByText('No spending in this period.')).toBeInTheDocument()
})

it('replaces charts while a new date range loads, ignoring an older late response', async () => {
  const pending: { url: URL; resolve: (response: Response) => void }[] = []
  deferred = url => new Promise(resolve => pending.push({ url, resolve }))
  mount()
  await waitFor(() => expect(pending).toHaveLength(3))
  await changeRange()
  await waitFor(() => expect(pending).toHaveLength(6))
  await act(async () => { pending.slice(3).forEach(row => row.resolve(response(row.url))) })
  expect(await screen.findByText('Travel')).toBeInTheDocument()
  await act(async () => { pending.slice(0, 3).forEach(row => row.resolve(Response.json({ bad: true }))) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('From')).toHaveValue('2026-09-01')
})

it('clears old chart values on workspace changes and uses the new workspace header', async () => {
  const view = mount()
  await screen.findByText('Travel')
  const pending: { url: URL; resolve: (response: Response) => void }[] = []
  deferred = url => new Promise(resolve => pending.push({ url, resolve }))
  setWorkspace(1, 42)
  view.rerender(<Statistics workspaceId={42} role="EMPLOYEE" />)
  expect(screen.queryByText('Travel')).not.toBeInTheDocument()
  expect(screen.getByText('Figures reflect your assigned department.')).toBeInTheDocument()
  await waitFor(() => expect(pending).toHaveLength(3))
  expect(pending.every(row => row.url.searchParams.get('test_workspace') === '42')).toBe(true)
  await act(async () => pending.forEach(row => row.resolve(response(row.url))))
  expect(await screen.findByText('Travel')).toBeInTheDocument()
})

it('retries a failed chart independently without hiding successful charts', async () => {
  fail = 'categories'; mount()
  const category = within(screen.getByRole('region', { name: 'Spending by category' }))
  expect(await category.findByRole('alert')).toHaveTextContent('HTTP 503')
  expect(screen.getByRole('region', { name: 'Income vs expenses' })).toHaveTextContent('€1,500.00')
  fail = ''
  await userEvent.click(category.getByRole('button', { name: 'Retry spending by category' }))
  expect(await category.findByText('Travel')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('rejects a response belonging to a different workspace', async () => {
  wrongScope = true; mount()
  expect(await screen.findAllByRole('alert')).toHaveLength(3)
  expect(screen.queryByText('Travel')).not.toBeInTheDocument()
})

it('validates reversed and overly long date ranges without requesting them', async () => {
  mount(); await screen.findByText('Travel')
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-31' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Start date must be on or before end date')
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2000-01-01' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a range of 3660 days or fewer')
  expect(fetch).toHaveBeenCalledTimes(3)
})
