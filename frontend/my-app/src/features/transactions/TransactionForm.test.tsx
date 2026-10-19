import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { TransactionForm } from './TransactionForm'

const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
const accounts = [{ account_id: 12, name: 'Main account', currency: 'EUR', balance: '100.00', workspace_id: 7, connection_id: null }, { account_id: 13, name: 'Dollar account', currency: 'USD', balance: '30.00', workspace_id: 7, connection_id: null }]
const categories = [{ id: 3, name: 'Salary', type: 'income' as const, workspaceId: 7 }, { id: 4, name: 'Food', type: 'expense' as const, workspaceId: 7 }]
const transaction = { transaction_id: 21, amount: '25.50', currency: 'EUR', description: 'Lunch', account_id: 12, category_id: 4, department_id: null, project_id: null, expense_id: null, workspace_id: 7, source: 'MANUAL' as const, created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00' }
const options = { accounts, categories, loading: false, error: '', retry: vi.fn() }
beforeEach(() => {
  clearSession(); setAccessToken(token); setWorkspace(1, 7)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => Response.json({ ...transaction, ...JSON.parse(String(init.body)) })))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })

it.each(['income', 'expense'] as const)('saves %s with its matching category and optional description', async type => {
  const saved = vi.fn()
  render(<TransactionForm workspaceId={7} type={type} options={options} onClose={() => {}} onSaved={saved} />)
  const form = within(screen.getByRole('dialog'))
  const category = form.getByLabelText('Category')
  expect(within(category).getByRole('option', { name: type === 'income' ? 'Salary' : 'Food' })).toBeInTheDocument()
  expect(within(category).queryByRole('option', { name: type === 'income' ? 'Food' : 'Salary' })).not.toBeInTheDocument()
  expect(form.getByLabelText('Description')).not.toBeRequired()
  await userEvent.selectOptions(form.getByLabelText('Account'), '12')
  await userEvent.selectOptions(category, type === 'income' ? '3' : '4')
  await userEvent.type(form.getByLabelText('Amount (EUR)'), '19.95')
  await userEvent.click(form.getByRole('button', { name: `Save ${type}` }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  const [url, init] = vi.mocked(fetch).mock.calls[0]
  expect(url).toBe('/api/transactions')
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toEqual({ amount: '19.95', description: type === 'income' ? 'Income' : 'Expense', currency: 'EUR', account_id: 12, category_id: type === 'income' ? 3 : 4, department_id: null, project_id: null, expense_id: null })
  expect(new Headers(init?.headers).get('X-Workspace-ID')).toBe('7')
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
})

it.each(['0', '-1', '1.234', '100000000', 'abc'])('rejects invalid amount %s without making a request', async amount => {
  render(<TransactionForm workspaceId={7} type="expense" options={options} onClose={() => {}} onSaved={() => {}} />)
  await userEvent.selectOptions(screen.getByLabelText('Account'), '12')
  await userEvent.selectOptions(screen.getByLabelText('Category'), '4')
  await userEvent.type(screen.getByLabelText('Amount (EUR)'), amount)
  await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/amount/i)
  expect(fetch).not.toHaveBeenCalled()
})

it('validates missing account and category', async () => {
  render(<TransactionForm workspaceId={7} type="income" options={options} onClose={() => {}} onSaved={() => {}} />)
  await userEvent.type(screen.getByLabelText('Amount (EUR)'), '10')
  await userEvent.click(screen.getByRole('button', { name: 'Save income' }))
  expect(await screen.findAllByRole('alert')).toHaveLength(2)
  expect(fetch).not.toHaveBeenCalled()
})

it('prefills an edit and saves it through PUT with the selected account currency', async () => {
  render(<TransactionForm workspaceId={7} type="expense" transaction={transaction} options={options} onClose={() => {}} onSaved={() => {}} />)
  expect(screen.getByLabelText('Description')).toHaveValue('Lunch')
  expect(screen.getByLabelText('Amount (EUR)')).toHaveValue('25.50')
  expect(screen.getByLabelText('Category')).toHaveValue('4')
  await userEvent.selectOptions(screen.getByLabelText('Account'), '13')
  await userEvent.clear(screen.getByLabelText('Amount (USD)'))
  await userEvent.type(screen.getByLabelText('Amount (USD)'), '30.25')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const [url, init] = vi.mocked(fetch).mock.calls[0]
  expect(url).toBe('/api/transactions/21')
  expect(init?.method).toBe('PUT')
  expect(JSON.parse(String(init?.body))).toMatchObject({ amount: '30.25', description: 'Lunch', account_id: 13, category_id: 4, currency: 'USD' })
})

it('keeps input after a server error and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ detail: 'Account not found' }, { status: 404 })).mockResolvedValueOnce(Response.json(transaction)))
  const saved = vi.fn()
  render(<TransactionForm workspaceId={7} type="expense" transaction={transaction} options={options} onClose={() => {}} onSaved={saved} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Account not found')
  expect(screen.getByLabelText('Description')).toHaveValue('Lunch')
  expect(saved).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
})

it('blocks duplicate submissions and ignores late success after switching workspace', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const saved = vi.fn()
  render(<TransactionForm workspaceId={7} type="expense" transaction={transaction} options={options} onClose={() => {}} onSaved={saved} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  setWorkspace(1, 42)
  await act(async () => finish(Response.json(transaction)))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(saved).not.toHaveBeenCalled()
})

it('rejects a response belonging to another workspace', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...transaction, workspace_id: 42 })))
  render(<TransactionForm workspaceId={7} type="expense" transaction={transaction} options={options} onClose={() => {}} onSaved={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected transaction/i)
})

it('does not submit a form belonging to a workspace that is no longer active', async () => {
  render(<TransactionForm workspaceId={7} type="expense" transaction={transaction} options={options} onClose={() => {}} onSaved={() => {}} />)
  setWorkspace(1, 42)
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(fetch).not.toHaveBeenCalled()
})


it('offers workspace-wide projects only without a department and clears incompatible selections', async () => {
  const catalog = { workspaceId: 7, projects: [
    { id: 10, workspace_id: 7, name: 'Workspace plan', department_ids: [], status: null, start_date: null, end_date: null },
    { id: 11, workspace_id: 7, name: 'Design plan', department_ids: [8], status: null, start_date: null, end_date: null },
  ], departments: [{ id: 8, workspace_id: 7, name: 'Design' }, { id: 9, workspace_id: 7, name: 'Sales' }], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }
  render(<TransactionForm workspaceId={7} type="expense" options={options} catalog={catalog} onClose={() => {}} onSaved={() => {}} />)
  await userEvent.selectOptions(screen.getByLabelText('Project'), '10')
  await userEvent.selectOptions(screen.getByLabelText('Department'), '8')
  expect(screen.getByLabelText('Project')).toHaveValue('')
  expect(screen.queryByRole('option', { name: 'Workspace plan' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Project'), '11')
  await userEvent.selectOptions(screen.getByLabelText('Department'), '9')
  expect(screen.getByLabelText('Project')).toHaveValue('')
  expect(screen.queryByRole('option', { name: 'Design plan' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Department'), '')
  expect(screen.getByRole('option', { name: 'Workspace plan' })).toBeInTheDocument()
})


it('clears a project removed from the catalog before submitting the transaction', async () => {
  const catalog = { workspaceId: 7, projects: [{ id: 10, workspace_id: 7, name: 'Workspace plan', department_ids: [], status: null, start_date: null, end_date: null }], departments: [], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }
  const saved = vi.fn()
  const { rerender } = render(<TransactionForm workspaceId={7} type="expense" options={options} catalog={catalog} onClose={() => {}} onSaved={saved} />)
  await userEvent.selectOptions(screen.getByLabelText('Account'), '12')
  await userEvent.selectOptions(screen.getByLabelText('Category'), '4')
  await userEvent.type(screen.getByLabelText('Amount (EUR)'), '25')
  await userEvent.selectOptions(screen.getByLabelText('Project'), '10')
  rerender(<TransactionForm workspaceId={7} type="expense" options={options} catalog={{ ...catalog, projects: [] }} onClose={() => {}} onSaved={saved} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
  expect(body.project_id).toBeNull()
})


it('prevents an employee without an assigned department from saving', async () => {
  const catalog = { workspaceId: 7, projects: [], departments: [], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }
  render(<TransactionForm workspaceId={7} type="expense" role="EMPLOYEE" options={options} catalog={catalog} onClose={() => {}} onSaved={() => {}} />)
  expect(screen.getByText(/Ask your workspace owner to assign you/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: 'No department' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('clears a removed department and project before an owner saves an edit', async () => {
  const catalog = { workspaceId: 7, projects: [], departments: [], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }
  render(<TransactionForm workspaceId={7} type="expense" transaction={{ ...transaction, department_id: 8, project_id: 11 }} options={options} catalog={catalog} onClose={() => {}} onSaved={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('Department')).toHaveValue(''))
  expect(screen.getByLabelText('Project')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ department_id: null, project_id: null })
})
