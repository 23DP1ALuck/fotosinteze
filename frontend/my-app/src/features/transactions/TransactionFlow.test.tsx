import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
