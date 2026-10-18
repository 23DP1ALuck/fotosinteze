import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { createFinanceTransport } from '@/test/finance-transport'
import { AuthContext } from '@/features/auth/use-auth'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import HomePage from '@/pages/HomePage'

const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
const studioSummary = {
  workspace_id: 42, currency: 'EUR', period_start: '2026-10-01', period_end: '2026-11-01', revenue: '12500.00', expenses: '3750.00', profit: '8750.00',
  spending_by_category: [{ id: 5, name: 'Brand campaigns', amount: '2500.00' }, { id: 7, name: 'Tools', amount: '1250.00' }],
  spending_by_department: [{ id: 8, name: 'Design team', amount: '3000.00' }, { id: null, name: 'Unassigned', amount: '750.00' }],
  spending_by_project: [{ id: 10, name: 'Autumn launch', amount: '2000.00' }, { id: null, name: 'Unassigned', amount: '1750.00' }],
}
const agencySummary = {
  ...studioSummary, workspace_id: 43, currency: 'USD', revenue: '400.00', expenses: '650.00', profit: '-250.00',
  spending_by_category: [{ id: 5, name: 'Agency costs', amount: '650.00' }], spending_by_department: [], spending_by_project: [],
}
function recentRow(id: number, workspaceId = 42) {
  return { transaction_id: id, workspace_id: workspaceId, amount: String(100 + id), description: `Invoice ${id}`, currency: workspaceId === 42 ? 'EUR' : 'USD', source: ['MANUAL'], account_id: 13, category_id: 6, department_id: 8, project_id: 10, expense_id: null, created_at: `2026-10-${String(24 - id).padStart(2, '0')}T12:00:00`, updated_at: '2026-10-17T12:00:00' }
}
let summary: Record<string, unknown>
let transactions: ReturnType<typeof recentRow>[]
let failSummary: boolean
let failTransactions: boolean
let failMetadata: boolean
let summaryForAgency: (() => Promise<Response>) | undefined
beforeEach(() => {
  localStorage.clear(); clearSession(); setAccessToken(token)
  localStorage.setItem('fotosinteze.workspace.1', '42')
  summary = { ...studioSummary }; transactions = [1, 2, 3, 4, 5, 6].map(id => recentRow(id))
  failSummary = false; failTransactions = false; failMetadata = false; summaryForAgency = undefined
  const finance = createFinanceTransport()
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = String(url)
    const workspaceId = Number(new Headers(init?.headers).get('X-Workspace-ID'))
    if (path.endsWith('/workspaces')) return Response.json([{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }, { id: 42, name: 'Studio', type: 'BUSINESS', role: 'OWNER' }, { id: 43, name: 'Agency', type: 'BUSINESS', role: 'EMPLOYEE' }])
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
    expect(new Headers(init?.headers).get('Workspace-ID')).toBe(String(workspaceId))
    if (path.endsWith('/dashboard')) {
      if (workspaceId === 43) return summaryForAgency ? summaryForAgency() : Response.json(agencySummary)
      return failSummary ? Response.json({ detail: 'Dashboard unavailable' }, { status: 503 }) : Response.json(summary)
    }
    if (path.includes('/transactions?')) return failTransactions ? Response.json({ detail: 'Transactions unavailable' }, { status: 503 }) : Response.json({ items: workspaceId === 42 ? transactions : [recentRow(9, 43)], limit: 50, offset: 0, has_more: false })
    if (path.endsWith('/categories') && failMetadata) return Response.json({ detail: 'Categories unavailable' }, { status: 503 })
    if (path.endsWith('/departments')) return Response.json([{ id: 8, workspace_id: workspaceId, name: 'Design team' }])
    if (path.endsWith('/projects')) return Response.json([{ id: 10, workspace_id: workspaceId, name: 'Autumn launch', department_ids: [8] }])
    return finance.respond(url, init) ?? Response.json([])
  }))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
function mount() {
  return render(<AuthContext.Provider value={{ status: 'authenticated', user: { id: 1, email: 'ada@example.com', displayName: 'Ada' }, token, login: async () => {}, register: async () => {}, logout: async () => {} }}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
}
async function switchTo(from: string, to: string) {
  await userEvent.click(screen.getByRole('button', { name: `Switch workspace, ${from}` }))
  await userEvent.click(screen.getByRole('button', { name: `Switch to ${to}` }))
}

it('uses API totals, shows all spending breakdowns, and displays the five most recent transactions', async () => {
  mount()
  const overview = within(await screen.findByRole('region', { name: 'Business monthly overview' }))
  expect(overview.getByRole('article', { name: 'Revenue' })).toHaveTextContent('€12,500.00')
  expect(overview.getByRole('article', { name: 'Expenses' })).toHaveTextContent('€3,750.00')
  expect(overview.getByRole('article', { name: 'Profit' })).toHaveTextContent('€8,750.00')
  expect(overview.getAllByRole('article')).toHaveLength(3)
  expect(screen.getByRole('heading', { name: 'Revenue & expenses' })).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Spending by category values' })).getByText('Brand campaigns')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Spending by department values' })).getByText('Unassigned')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Spending by project values' })).getByText('Autumn launch')).toBeInTheDocument()
  const recent = within(screen.getByRole('region', { name: 'Recent business transactions' }))
  expect(await recent.findByText('Invoice 1')).toBeInTheDocument()
  expect(recent.getByText('Invoice 5')).toBeInTheDocument()
  expect(recent.queryByText('Invoice 6')).not.toBeInTheDocument()
  await userEvent.click(recent.getByRole('button', { name: 'View all transactions' }))
  expect(await screen.findByRole('button', { name: 'Edit Invoice 6' })).toBeInTheDocument()
})

it('clears the old dashboard during a workspace switch and displays the new currency and negative profit', async () => {
  let finish: (response: Response) => void = () => {}
  summaryForAgency = () => new Promise(resolve => { finish = resolve })
  mount()
  await screen.findByRole('region', { name: 'Business monthly overview' })
  await switchTo('Studio', 'Agency')
  expect(screen.getByRole('status', { name: 'Loading business dashboard' })).toBeInTheDocument()
  expect(screen.queryByText('€12,500.00')).not.toBeInTheDocument()
  expect(screen.queryByText('Brand campaigns')).not.toBeInTheDocument()
  await act(async () => finish(Response.json(agencySummary)))
  const overview = within(await screen.findByRole('region', { name: 'Business monthly overview' }))
  expect(overview.getByRole('article', { name: 'Revenue' })).toHaveTextContent('$400.00')
  expect(overview.getByRole('article', { name: 'Profit' })).toHaveTextContent('-US$250.00')
  expect(screen.getByText('Figures reflect your assigned department.')).toBeInTheDocument()
  expect(screen.queryByText('Brand campaigns')).not.toBeInTheDocument()
  await switchTo('Agency', 'Studio')
  expect(await screen.findByText('€12,500.00')).toBeInTheDocument()
  expect(screen.queryByText('Agency costs')).not.toBeInTheDocument()
})

it('shows zero totals and useful empty states without inventing chart data', async () => {
  summary = { ...studioSummary, revenue: '0.00', expenses: '0.00', profit: '0.00', spending_by_category: [], spending_by_department: [], spending_by_project: [] }
  transactions = []
  mount()
  expect(await screen.findByText('No financial activity this month')).toBeInTheDocument()
  const overview = within(screen.getByRole('region', { name: 'Business monthly overview' }))
  expect(overview.getAllByText('€0.00')).toHaveLength(3)
  expect(screen.getByText('No category spending this period.')).toBeInTheDocument()
  expect(screen.getByText('No department spending this period.')).toBeInTheDocument()
  expect(screen.getByText('No project spending this period.')).toBeInTheDocument()
  expect(await screen.findByText('No transactions yet.')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('lets a failed dashboard retry while recent transactions remain available', async () => {
  failSummary = true
  mount()
  expect(await screen.findByRole('button', { name: 'Retry dashboard' })).toBeInTheDocument()
  const recent = within(screen.getByRole('region', { name: 'Recent business transactions' }))
  expect(await recent.findByText('Invoice 1')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Business monthly overview' })).not.toBeInTheDocument()
  failSummary = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry dashboard' }))
  expect(await screen.findByRole('region', { name: 'Business monthly overview' })).toHaveTextContent('€12,500.00')
})

it('retains working totals and charts if recent transactions fail, and supports retry', async () => {
  failTransactions = true
  mount()
  expect(await screen.findByRole('region', { name: 'Business monthly overview' })).toHaveTextContent('€12,500.00')
  expect(await screen.findByRole('button', { name: 'Retry transactions' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Spending by category' })).toBeInTheDocument()
  failTransactions = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry transactions' }))
  expect(await screen.findByText('Invoice 1')).toBeInTheDocument()
})

it('shows aggregate charts even if category labels cannot be loaded', async () => {
  failMetadata = true
  mount()
  expect(await screen.findByRole('region', { name: 'Business monthly overview' })).toHaveTextContent('€12,500.00')
  expect(screen.getByRole('list', { name: 'Spending by category values' })).toHaveTextContent('Brand campaigns')
  expect(await screen.findByText('Invoice 1')).toBeInTheDocument()
  expect(screen.getByText('Some transaction labels are unavailable.')).toBeInTheDocument()
})

it.each(['wrong workspace', 'malformed breakdown'])('rejects %s dashboard responses', async failure => {
  summary = failure === 'wrong workspace' ? { ...studioSummary, workspace_id: 99 } : { ...studioSummary, spending_by_category: [{ id: 1, name: 'Bad data', amount: 'not-money' }] }
  mount()
  expect(await screen.findByRole('button', { name: 'Retry dashboard' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(/unexpected dashboard data/)
  expect(screen.queryByRole('region', { name: 'Business monthly overview' })).not.toBeInTheDocument()
})


it('includes every spending group when the chart combines smaller categories', async () => {
  summary = { ...studioSummary, expenses: '2800.00', profit: '9700.00', spending_by_category: [
    { id: 1, name: 'One', amount: '100.00' }, { id: 2, name: 'Two', amount: '200.00' },
    { id: 3, name: 'Three', amount: '300.00' }, { id: 4, name: 'Four', amount: '400.00' },
    { id: 5, name: 'Five', amount: '500.00' }, { id: 6, name: 'Six', amount: '600.00' }, { id: 7, name: 'Seven', amount: '700.00' },
  ] }
  mount()
  const values = within(await screen.findByRole('list', { name: 'Spending by category values' }))
  expect(values.getAllByRole('listitem')).toHaveLength(6)
  expect(values.getByText('All other categories').closest('li')).toHaveTextContent('€300.00')
  await userEvent.click(screen.getByText('View all 7 categories'))
  const table = within(screen.getByRole('table', { name: 'All category spending' }))
  expect(table.getAllByRole('row')).toHaveLength(8)
  expect(table.getByRole('row', { name: /One.*100.00/ })).toBeInTheDocument()
})
