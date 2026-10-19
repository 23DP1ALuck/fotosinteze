import { fireEvent, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { createFinanceTransport } from '@/test/finance-transport'
import { AuthContext } from '@/features/auth/use-auth'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import HomePage from '@/pages/HomePage'

const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
let finance: ReturnType<typeof createFinanceTransport>
beforeEach(() => {
  localStorage.clear(); clearSession(); setAccessToken(token)
  finance = createFinanceTransport()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/workspaces')) return Response.json([{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }, { id: 42, name: 'Studio', type: 'BUSINESS', role: 'OWNER' }])
    const response = finance.respond(url, init)
    if (response) return response
    if (String(url).endsWith('/departments')) return Response.json([{ id: 8, name: 'Design', workspace_id: 42 }])
    if (String(url).endsWith('/projects')) return Response.json([{ id: 10, name: 'Website', workspace_id: 42, department_ids: [8] }])
    return Response.json([])
  }))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
function mount() {
  return render(<AuthContext.Provider value={{ status: 'authenticated', user: { id: 1, email: 'ada@example.com', displayName: 'Ada' }, token, login: async () => {}, register: async () => {}, logout: async () => {} }}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
}
async function fillAndSave(type: 'income' | 'expense', description: string, amount: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: `Add ${type}` }))
  const modal = within(screen.getByRole('dialog', { name: `Add ${type}` }))
  await waitFor(() => expect(modal.getByLabelText('Account')).toBeEnabled())
  await user.selectOptions(modal.getByLabelText('Account'), type === 'income' && screen.queryByRole('button', { name: 'Switch workspace, Studio' }) ? '13' : '12')
  await user.selectOptions(modal.getByLabelText('Category'), type === 'income' ? '3' : '4')
  await user.type(modal.getByLabelText('Amount (EUR)'), amount)
  if (description) await user.type(modal.getByLabelText('Description'), description)
  await user.click(modal.getByRole('button', { name: `Save ${type}` }))
}

it('refreshes saved transactions, dashboard totals, and account balances after adding an expense', async () => {
  mount()
  await fillAndSave('expense', 'Weekly groceries', '50')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add expense' })).not.toBeInTheDocument())
  const overview = within(screen.getByRole('region', { name: 'Monthly overview' }))
  expect(await overview.findByText('€4,770.50')).toBeInTheDocument()
  expect(overview.getByText('€1,892.35')).toBeInTheDocument()
  expect(await screen.findByText('Weekly groceries')).toBeInTheDocument()
  const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
  expect(requests.filter(url => url.endsWith('/dashboard')).length).toBeGreaterThan(1)
  expect(requests.filter(url => url.endsWith('/accounts')).length).toBeGreaterThan(1)
  expect(requests.filter(url => url.includes('/transactions?')).length).toBeGreaterThan(1)
})

it('opens a prefilled edit from the list and refreshes the displayed transaction', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Rimi' }))
  const modal = within(screen.getByRole('dialog', { name: 'Edit transaction' }))
  expect(modal.getByLabelText('Description')).toHaveValue('Rimi')
  await userEvent.clear(modal.getByLabelText('Amount (EUR)'))
  await userEvent.type(modal.getByLabelText('Amount (EUR)'), '40.00')
  await userEvent.clear(modal.getByLabelText('Description'))
  await userEvent.type(modal.getByLabelText('Description'), 'Food shopping')
  await userEvent.click(modal.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit transaction' })).not.toBeInTheDocument())
  expect(await screen.findByRole('row', { name: /Food shopping.*40.00/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit Rimi' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/transactions/2') && init?.method === 'PUT')).toBe(true)
})

it('saves business income with the chosen workspace, department and project IDs', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Switch workspace, Personal' }))
  await userEvent.click(screen.getByRole('button', { name: 'Switch to Studio' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add income' }))
  const modal = within(screen.getByRole('dialog', { name: 'Add income' }))
  await waitFor(() => expect(modal.getByLabelText('Account')).toBeEnabled())
  await userEvent.selectOptions(modal.getByLabelText('Account'), '13')
  await userEvent.selectOptions(modal.getByLabelText('Category'), '6')
  await userEvent.selectOptions(modal.getByLabelText('Department'), '8')
  await userEvent.selectOptions(modal.getByLabelText('Project'), '10')
  await userEvent.type(modal.getByLabelText('Amount (EUR)'), '250')
  await userEvent.click(modal.getByRole('button', { name: 'Save income' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add income' })).not.toBeInTheDocument())
  const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/transactions') && init?.method === 'POST')!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ description: 'Income', amount: '250', category_id: 6, department_id: 8, project_id: 10 })
  expect(new Headers(call[1]?.headers).get('X-Workspace-ID')).toBe('42')
  expect(screen.getByRole('button', { name: 'Switch workspace, Studio' })).toBeInTheDocument()
})

it('shows empty account guidance and prevents a save without an account', async () => {
  finance.state.emptyAccounts = true
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Add income' }))
  const modal = within(screen.getByRole('dialog', { name: 'Add income' }))
  expect(await modal.findByText(/No accounts are available/)).toBeInTheDocument()
  expect(modal.getByRole('button', { name: 'Save income' })).toBeDisabled()
})

it('allows an uncategorised transaction to be classified and edited', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const response = await fallback(url, init)
    if (String(url).includes('/transactions?')) {
      const page = await response.json()
      page.items[1].category_id = null
      return Response.json(page)
    }
    return response
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Rimi' }))
  const modal = within(screen.getByRole('dialog', { name: 'Edit transaction' }))
  await userEvent.selectOptions(modal.getByLabelText('Transaction type'), 'income')
  await userEvent.selectOptions(modal.getByLabelText('Category'), '3')
  await userEvent.click(modal.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit transaction' })).not.toBeInTheDocument())
})

it('identifies incomplete budget spending and excludes other currencies', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const response = await fallback(url, init)
    if (String(url).includes('/transactions?')) {
      const page = await response.json()
      page.items.push({ ...page.items[1], transaction_id: 55, amount: '1000.00', currency: 'USD' })
      page.has_more = true
      return Response.json(page)
    }
    return response
  }))
  mount()
  expect(await screen.findByText(/Spending is based on loaded transactions/)).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Groceries budget used' })).toHaveAttribute('value', '28.54')
  expect(screen.queryByText('On track')).not.toBeInTheDocument()
  expect(screen.getAllByText('Partial data')).toHaveLength(2)
})


it('makes an owner-created project available in transaction and budget forms without reloading', async () => {
  let projects = [{ id: 10, workspace_id: 42, name: 'Website', status: null, start_date: null, end_date: null, department_ids: [8] }]
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/projects')) {
      if (init?.method === 'POST') {
        const created = { ...projects[0], ...JSON.parse(String(init.body)), id: 11 }
        projects = [...projects, created]
        return Response.json(created, { status: 201 })
      }
      return Response.json(projects)
    }
    if (String(url).endsWith('/business-budgets')) return Response.json({ workspace_id: 42, can_manage: true, progress_scope: 'WORKSPACE', budgets: [], targets: { CATEGORY: [], DEPARTMENT: [{ id: 8, name: 'Design' }], PROJECT: [{ id: 10, name: 'Website' }] } })
    return fallback(url, init)
  }))
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Switch workspace, Personal' }))
  await user.click(screen.getByRole('button', { name: 'Switch to Studio' }))
  await user.click(screen.getByRole('button', { name: 'Projects' }))
  await user.click(await screen.findByRole('button', { name: 'Add project' }))
  const projectDialog = within(screen.getByRole('dialog', { name: 'Add project' }))
  await user.type(projectDialog.getByLabelText('Project name'), 'Launch campaign')
  await user.click(projectDialog.getByRole('button', { name: 'Add project' }))
  await screen.findByRole('button', { name: 'Edit Launch campaign' })
  await user.click(screen.getByRole('button', { name: 'Add expense' }))
  const transactionDialog = within(screen.getByRole('dialog', { name: 'Add expense' }))
  expect(await transactionDialog.findByRole('option', { name: 'Launch campaign' })).toBeInTheDocument()
  await user.selectOptions(transactionDialog.getByLabelText('Project'), '11')
  await user.click(transactionDialog.getByRole('button', { name: 'Close transaction form' }))
  await user.click(screen.getByRole('button', { name: 'Budgets' }))
  await user.click(await screen.findByRole('button', { name: 'Create budget' }))
  const budgetForm = within(screen.getByRole('form', { name: 'Create business budget' }))
  await user.selectOptions(budgetForm.getByLabelText('Target type'), 'PROJECT')
  expect(budgetForm.getByRole('option', { name: 'Launch campaign' })).toBeInTheDocument()
  await user.selectOptions(budgetForm.getByLabelText('Project'), '11')
  expect(budgetForm.getByLabelText('Project')).toHaveValue('11')
})

it('combines history filters before pagination and resets them when cleared', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  const base = { transaction_id: 1, workspace_id: 7, amount: '12.00', currency: 'EUR', description: 'Recent', source: 'MANUAL', account_id: 12, category_id: 4, department_id: null, project_id: null, expense_id: null, created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00' }
  const savedRows = Array.from({ length: 51 }, (_, i) => ({ ...base, transaction_id: i + 1, description: i === 50 ? 'Old train ticket' : `Recent ${i}`, category_id: i === 50 ? 7 : 4, source: i === 50 ? 'BANK' : 'MANUAL' }))
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/transactions?')) {
      const params = new URL(String(url), 'http://localhost').searchParams
      const offset = Number(params.get('offset'))
      const matches = savedRows.filter(row => row.description.toLowerCase().includes((params.get('search') ?? '').trim().toLowerCase()) &&
        (!params.has('date_from') || row.created_at.slice(0, 10) >= params.get('date_from')!) &&
        (!params.has('date_to') || row.created_at.slice(0, 10) <= params.get('date_to')!) &&
        (!params.has('category_id') || row.category_id === Number(params.get('category_id'))) &&
        (!params.has('source') || row.source === params.get('source')) &&
        (!params.has('type') || params.get('type') === 'EXPENSE'))
      return Response.json({ items: matches.slice(offset, offset + 50), limit: 50, offset, has_more: matches.length > offset + 50 })
    }
    return fallback(url, init)
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  await screen.findByRole('button', { name: 'Edit Recent 0' })
  await userEvent.selectOptions(screen.getByLabelText('Filter by source'), 'Revolut')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Old train ticket' })).toBeInTheDocument())
  await userEvent.selectOptions(screen.getByLabelText('Filter by category'), '7')
  await userEvent.click(screen.getByRole('button', { name: 'Expenses' }))
  await userEvent.type(screen.getByLabelText('Search personal transactions'), 'Old train ticket')
  await waitFor(() => {
    const request = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).reverse().find(url => url.pathname.endsWith('/transactions'))!
    expect(request.searchParams.get('search')).toBe('Old train ticket')
    expect(screen.getByRole('table', { name: 'Transaction history' })).toHaveAttribute('aria-busy', 'false')
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Old train ticket' })).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Load more transactions' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-18' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-17' } })
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-17' } })
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Old train ticket' })).toBeInTheDocument())
  await waitFor(() => {
    const filteredRequest = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).reverse().find(url => url.pathname.endsWith('/transactions'))!
    expect(Object.fromEntries(filteredRequest.searchParams)).toMatchObject({ offset: '0', search: 'Old train ticket', source: 'BANK', category_id: '7', type: 'EXPENSE', date_from: '2026-10-17', date_to: '2026-10-17' })
  })
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByLabelText('From date')).toHaveValue('')
  expect(screen.getByLabelText('Search personal transactions')).toHaveValue('')
  expect(await screen.findByRole('button', { name: 'Edit Recent 0' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Load more transactions' })).toBeInTheDocument()
})

it('refreshes dashboard totals when changing a category type', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  let changed = false
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/categories/4') && init?.method === 'PUT') {
      changed = true
      return Response.json({ category_id: 4, workspace_id: 7, name: 'Groceries', type: 'INCOME' })
    }
    const response = await fallback(url, init)
    if (String(url).endsWith('/categories') && changed) return Response.json((await response.json()).map((row: { category_id: number }) => row.category_id === 4 ? { ...row, type: 'INCOME' } : row))
    if (String(url).endsWith('/dashboard') && changed) return Response.json({ ...await response.json(), income: '3228.54', expenses: '1813.81', savings: '1414.73' })
    return response
  }))
  mount()
  await screen.findByRole('region', { name: 'Monthly overview' })
  await userEvent.click(screen.getByRole('button', { name: 'Categories' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Groceries' }))
  const modal = within(screen.getByRole('dialog', { name: 'Edit category' }))
  await userEvent.selectOptions(modal.getByLabelText('Type'), 'income')
  await userEvent.click(modal.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit category' })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
  expect(await within(screen.getByRole('region', { name: 'Monthly overview' })).findByText('€3,228.54')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Monthly overview' })).toHaveTextContent('€1,813.81')
  expect(screen.getByRole('row', { name: /Rimi.*28.54/ })).toHaveTextContent('+ €28.54')
})

it('lets an employee browse categories and save a transaction without showing category write controls', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => String(url).endsWith('/workspaces') ? Response.json([{ id: 42, name: 'Studio', type: 'BUSINESS', role: 'EMPLOYEE' }]) : fallback(url, init)))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Categories' }))
  await screen.findByText('Groceries')
  expect(screen.queryByRole('button', { name: 'Create category' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit Groceries' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
  const modal = within(screen.getByRole('dialog', { name: 'Add expense' }))
  await waitFor(() => expect(modal.getByLabelText('Account')).toBeEnabled())
  await userEvent.selectOptions(modal.getByLabelText('Account'), '13')
  await userEvent.selectOptions(modal.getByLabelText('Category'), '4')
  await userEvent.type(modal.getByLabelText('Amount (EUR)'), '12')
  await userEvent.click(modal.getByRole('button', { name: 'Save expense' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add expense' })).not.toBeInTheDocument())
  expect(screen.getByRole('status')).toHaveTextContent('Transaction saved.')
})

it('confirms deletion, refreshes history and balances, and allows cancelling first', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Transactions' }))
  await user.click(await screen.findByRole('button', { name: 'Delete Rimi' }))
  let modal = within(screen.getByRole('dialog', { name: 'Delete transaction?' }))
  await user.click(modal.getByRole('button', { name: 'Cancel' }))
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Delete Rimi' }))
  modal = within(screen.getByRole('dialog', { name: 'Delete transaction?' }))
  await user.click(modal.getByRole('button', { name: 'Delete transaction' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete transaction?' })).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Edit Rimi' })).not.toBeInTheDocument()
  const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/transactions/2') && init?.method === 'DELETE')!
  expect(new Headers(call[1]?.headers).get('X-Workspace-ID')).toBe('7')
  await user.click(screen.getByRole('button', { name: 'Dashboard' }))
  const overview = within(screen.getByRole('region', { name: 'Monthly overview' }))
  expect(await overview.findByText('€4,849.04')).toBeInTheDocument()
  expect(overview.getByText('€1,813.81')).toBeInTheDocument()
})

it('keeps a transaction when deletion is denied and lets the user retry', async () => {
  finance.state.failSave = true
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Rimi' }))
  const modal = within(screen.getByRole('dialog', { name: 'Delete transaction?' }))
  await userEvent.click(modal.getByRole('button', { name: 'Delete transaction' }))
  expect(await modal.findByRole('alert')).toHaveTextContent('No access to this transaction')
  expect(screen.getByRole('button', { name: 'Edit Rimi' })).toBeInTheDocument()
  finance.state.failSave = false
  await userEvent.click(modal.getByRole('button', { name: 'Delete transaction' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete transaction?' })).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Edit Rimi' })).not.toBeInTheDocument()
})

it('shows approved business expense transactions as read only while preserving their details', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/transactions?') && new Headers(init?.headers).get('X-Workspace-ID') === '42') {
      return Response.json({ items: [{ transaction_id: 200, workspace_id: 42, description: 'Approved travel', amount: '28.54', currency: 'EUR', source: 'EXPENSE', account_id: 13, category_id: 4, department_id: 8, project_id: 10, expense_id: 20, created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00' }], offset: 0, limit: 50, has_more: false })
    }
    return fallback(url, init)
  }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Switch workspace, Personal' }))
  await userEvent.click(screen.getByRole('button', { name: 'Switch to Studio' }))
  await userEvent.click(screen.getByRole('button', { name: 'Transactions' }))
  await screen.findByText('Approved expense · read only')
  expect(screen.queryByRole('button', { name: 'Edit Approved travel' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Approved travel' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by source' }), 'Expense')
  await userEvent.click(await screen.findByRole('button', { name: 'View Approved travel details' }))
  const modal = within(screen.getByRole('dialog', { name: 'Transaction details' }))
  expect(modal.getByText('Expense')).toBeInTheDocument()
  expect(modal.getByText('− €28.54')).toBeInTheDocument()
  expect(modal.getByText('17 Oct 2026')).toBeInTheDocument()
})

it('combines business filters and keeps search and filter state scoped to each workspace', async () => {
  const user = userEvent.setup()
  const fallback = vi.mocked(fetch).getMockImplementation()!
  const businessRows = [
    { transaction_id: 200, description: 'Website hosting', category_id: 7, department_id: 8, project_id: 10 },
    { transaction_id: 201, description: 'Other hosting', category_id: 4, department_id: 8, project_id: null },
  ].map(row => ({ ...row, workspace_id: 42, amount: '20.00', currency: 'EUR', account_id: 13, source: 'EXPENSE', expense_id: null, created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00' }))
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const request = new URL(String(url), 'http://localhost')
    if (request.pathname.endsWith('/transactions') && new Headers(init?.headers).get('X-Workspace-ID') === '42') {
      const params = request.searchParams
      const items = businessRows.filter(row =>
        row.description.toLowerCase().includes((params.get('search') ?? '').toLowerCase()) &&
        (!params.has('type') || params.get('type') === 'EXPENSE') &&
        (!params.has('source') || row.source === params.get('source')) &&
        (['category_id', 'department_id', 'project_id'] as const).every(key => !params.has(key) || row[key] === Number(params.get(key))),
      )
      return Response.json({ items, limit: 50, offset: 0, has_more: false })
    }
    return fallback(url, init)
  }))
  mount()
  await user.click(await screen.findByRole('button', { name: 'Transactions' }))
  expect(screen.queryByRole('combobox', { name: 'Filter by department' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Filter by project' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox'), 'Rimi')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Monthly salary' })).not.toBeInTheDocument())
  expect(await screen.findByRole('button', { name: 'Edit Rimi' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Switch workspace, Personal' }))
  await user.click(screen.getByRole('button', { name: 'Switch to Studio' }))
  await user.click(screen.getByRole('button', { name: 'Transactions' }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
  await screen.findByRole('button', { name: 'Edit Other hosting' })
  expect(screen.queryByRole('button', { name: 'Edit Rimi' })).not.toBeInTheDocument()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by department' }), '8')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by project' }), '10')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), '7')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by source' }), 'Expense')
  await user.click(screen.getByRole('button', { name: 'Expenses' }))
  await user.type(screen.getByRole('searchbox'), 'hosting')
  await waitFor(() => {
    const latest = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/transactions?')).at(-1)!
    expect(new Headers(latest[1]?.headers).get('X-Workspace-ID')).toBe('42')
    expect(Object.fromEntries(new URL(String(latest[0]), 'http://localhost').searchParams)).toMatchObject({ search: 'hosting', source: 'EXPENSE', category_id: '7', department_id: '8', project_id: '10', type: 'EXPENSE', offset: '0' })
  })
  expect(await screen.findByRole('button', { name: 'Edit Website hosting' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit Other hosting' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox'), ' missing')
  expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Switch workspace, Studio' }))
  await user.click(screen.getByRole('button', { name: 'Switch to Personal' }))
  expect(screen.getByRole('searchbox')).toHaveValue('Rimi')
  expect(screen.queryByRole('combobox', { name: 'Filter by department' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Filter by project' })).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Edit Rimi' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit Website hosting' })).not.toBeInTheDocument()
})
