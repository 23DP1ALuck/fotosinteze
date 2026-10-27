import { cloneElement, type ReactElement } from 'react'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '@/features/auth/use-auth'
import HomePage from '@/pages/HomePage'
import { BusinessDashboard } from '@/features/dashboard/BusinessDashboard'
import type { WorkspaceFinance } from '@/features/transactions/use-workspace-finance'
import { Statistics } from '@/features/statistics/Statistics'

// Supply deterministic dimensions while exercising real chart shapes and events.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 720, height: 280 }) }
})
const transaction = { transaction_id: 1, workspace_id: 7, amount: '120.50', currency: 'EUR', description: 'Train tickets', source: 'MANUAL', account_id: 12, category_id: 4, department_id: null, project_id: null, expense_id: null, created_at: '2026-10-03T12:00:00', updated_at: '2026-10-03T12:00:00' }
beforeEach(() => {
  localStorage.clear()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Date.now()/1000+3600 }))}.s`)
  setWorkspace(1, 7)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const workspace_id = Number(new Headers(init?.headers).get('Workspace-ID'))
    const base = { workspace_id, currency: 'EUR', date_from: url.searchParams.get('date_from'), date_to: url.searchParams.get('date_to') }
    if (url.pathname.endsWith('/summary')) return Response.json({ ...base, income: '1500', expenses: '120.50' })
    if (url.pathname.endsWith('/categories')) return Response.json({ ...base, items: [{ id: 4, name: 'Travel', amount: '120.50' }] })
    if (url.pathname.endsWith('/timeseries')) return Response.json({ ...base, items: [{ date: base.date_from, amount: '120.50' }] })
    if (url.pathname.endsWith('/transactions')) return Response.json({ items: [{ ...transaction, workspace_id, category_id: Number(url.searchParams.get('category_id') ?? transaction.category_id), department_id: url.searchParams.has('department_id') ? Number(url.searchParams.get('department_id')) : null, project_id: url.searchParams.has('project_id') ? Number(url.searchParams.get('project_id')) : null, description: url.searchParams.get('type') === 'INCOME' ? 'Monthly salary' : transaction.description }], limit: 50, offset: Number(url.searchParams.get('offset')), has_more: false })
    return Response.json([])
  }))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
function requests() { return vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter(url => url.pathname.endsWith('/transactions')) }

it('opens income or expense transactions only when the actual comparison bar is clicked', async () => {
  render(<Statistics workspaceId={7} role="OWNER" />)
  const chart = screen.getByRole('region', { name: 'Income vs expenses' })
  await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2))
  fireEvent.click(chart.querySelector('.recharts-cartesian-grid')!)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const bars = chart.querySelectorAll('.recharts-bar-rectangle')
  fireEvent.mouseEnter(bars[0])
  expect(chart.querySelector('.recharts-tooltip-cursor')).not.toBeInTheDocument()
  fireEvent.click(bars[0])
  const income = within(await screen.findByRole('dialog', { name: 'Income details' }))
  expect(await income.findByText('Monthly salary')).toBeInTheDocument()
  expect(requests().at(-1)?.searchParams.get('type')).toBe('INCOME')
  expect(requests().at(-1)?.searchParams.get('date_from')).toMatch(/^\d{4}-\d{2}-01$/)
  await userEvent.click(income.getByRole('button', { name: 'Close income details' }))
  fireEvent.click(chart.querySelectorAll('.recharts-bar-rectangle')[1])
  const expenses = within(await screen.findByRole('dialog', { name: 'Expense details' }))
  expect(await expenses.findByText('Train tickets')).toBeInTheDocument()
  expect(requests().at(-1)?.searchParams.get('type')).toBe('EXPENSE')
})

it('opens the exact category when its pie slice is clicked', async () => {
  render(<Statistics workspaceId={7} role="OWNER" />)
  const chart = screen.getByRole('region', { name: 'Spending by category' })
  await waitFor(() => expect(chart.querySelector('.recharts-pie-sector')).toBeInTheDocument())
  fireEvent.click(chart.querySelector('.recharts-pie-sector')!)
  const details = within(await screen.findByRole('dialog', { name: 'Expense details' }))
  expect(await details.findByText('Train tickets')).toBeInTheDocument()
  expect(details.getByText('Travel')).toBeInTheDocument()
  expect(requests().at(-1)?.searchParams.get('category_id')).toBe('4')
})

it('opens expenses for the exact day when a daily chart point is clicked', async () => {
  render(<Statistics workspaceId={7} role="OWNER" />)
  const chart = screen.getByRole('region', { name: 'Spending over time' })
  await waitFor(() => expect(chart.querySelector('.recharts-line-dot')).toBeInTheDocument())
  fireEvent.click(chart.querySelector('.recharts-line-dot circle[role=button]')!)
  const details = within(await screen.findByRole('dialog', { name: 'Expense details' }))
  await details.findByText('Train tickets')
  const params = requests().at(-1)!.searchParams
  expect(params.get('type')).toBe('EXPENSE')
  expect(params.get('date_to')).toBe(params.get('date_from'))
})

it('offers the same chart details to keyboard users and clears them on workspace changes', async () => {
  const view = render(<Statistics workspaceId={7} role="OWNER" />)
  await userEvent.click(await screen.findByRole('button', { name: 'View income transactions' }))
  await screen.findByRole('dialog', { name: 'Income details' })
  setWorkspace(1, 42)
  view.rerender(<Statistics workspaceId={42} role="EMPLOYEE" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

function businessFinance(): WorkspaceFinance {
  const noop = () => {}
  return {
    rows: [], transactions: [], accounts: [], accountsReady: true,
    dashboard: { workspace_id: 7, currency: 'EUR', period_start: '2026-10-01', period_end: '2026-11-01', revenue: '1500', expenses: '120.50', profit: '1379.50',
      spending_by_category: [{ id: 4, name: 'Travel', amount: '120.50' }], spending_by_department: [{ id: 8, name: 'Engineering', amount: '120.50' }], spending_by_project: [{ id: 10, name: 'Launch', amount: '120.50' }] },
    dashboardLoading: false, dashboardRefreshing: false, dashboardError: '', transactionsLoading: false, transactionsRefreshing: false, transactionsError: '', metadataError: '',
    retryDashboard: noop, retryTransactions: noop, retryMetadata: noop, loading: false, error: '', refresh: noop, hasMore: false, loadingMore: false, loadMore: noop,
    options: { accounts: [], categories: [], loading: false, error: '', retry: noop },
  }
}
it.each([['category', 'category_id', '4'], ['department', 'department_id', '8'], ['project', 'project_id', '10']])('opens the selected business %s shape with its exact API filter', async (dimension, filter, id) => {
  render(<BusinessDashboard finance={businessFinance()} workspaceName="Studio" role="OWNER" onViewTransactions={() => {}} />)
  const chart = screen.getByRole('region', { name: `Spending by ${dimension}` })
  const selector = dimension === 'category' ? '.recharts-pie-sector' : '.recharts-bar-rectangle'
  await waitFor(() => expect(chart.querySelector(selector)).toBeInTheDocument())
  fireEvent.click(chart.querySelector(selector)!)
  const details = within(await screen.findByRole('dialog', { name: 'Expense details' }))
  expect(await details.findByText('Train tickets')).toBeInTheDocument()
  const params = requests().at(-1)!.searchParams
  expect(params.get(filter)).toBe(id)
  expect(params.get('date_from')).toBe('2026-10-01')
  expect(params.get('date_to')).toBe('2026-10-31')
})

it('opens revenue transactions from the business comparison chart', async () => {
  render(<BusinessDashboard finance={businessFinance()} workspaceName="Studio" role="OWNER" onViewTransactions={() => {}} />)
  const chart = screen.getByRole('region', { name: 'Revenue and expenses comparison' })
  await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2))
  fireEvent.click(chart.querySelector('.recharts-bar-rectangle')!)
  const details = within(await screen.findByRole('dialog', { name: 'Income details' }))
  expect(await details.findByText('Monthly salary')).toBeInTheDocument()
  expect(requests().at(-1)?.searchParams.get('type')).toBe('INCOME')
})

it('opens income details by clicking the personal dashboard bar from the screenshot', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path.endsWith('/workspaces')) return Response.json([{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }])
    if (path.endsWith('/accounts')) return Response.json([{ account_id: 12, workspace_id: 7, name: 'Cash', currency: 'EUR', balance: '3000', connection_id: null }])
    if (path.endsWith('/dashboard')) return Response.json({ workspace_id: 7, currency: 'EUR', period_start: '2026-10-01', period_end: '2026-11-01', income: '1500', expenses: '120.50', balance: '3000', savings: '1379.50', recent_transactions: [] })
    if (path === '/api/categories') return Response.json([{ category_id: 4, workspace_id: 7, name: 'Travel', type: 'EXPENSE' }])
    return fallback(input, init)
  })
  render(<AuthContext.Provider value={{ status: 'authenticated', user: { id: 1, email: 'ada@example.com', displayName: 'Ada' }, token: 'test', login: async () => {}, register: async () => {}, logout: async () => {} }}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
  const heading = await screen.findByRole('heading', { name: 'Money in. Money out.' })
  const chart = heading.closest('section')!
  await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2))
  fireEvent.click(chart.querySelector('.recharts-bar-rectangle')!)
  const details = within(await screen.findByRole('dialog', { name: 'Income details' }))
  expect(await details.findByText('Monthly salary')).toBeInTheDocument()
  const params = requests().at(-1)!.searchParams
  expect(params.get('type')).toBe('INCOME')
  expect(params.get('date_to')).toBe('2026-10-31')
})
