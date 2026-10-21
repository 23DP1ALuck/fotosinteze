import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import type { ProjectCatalog } from '@/features/projects/use-project-catalog'
import { ExpenseRequests } from './ExpenseRequests'

const catalog = { workspaceId: 42, departments: [], projects: [], loading: false, error: '', refresh() {}, upsert() {}, remove() {} } as ProjectCatalog
const row = { id: 11, workspace_id: 42, submitted_by: 2, reviewed_by: null, amount: 25, currency: 'EUR', description: 'Taxi to client', receipt_url: null, status: 'PENDING', category_id: 9, department_id: 7, project_id: null, created_at: '2026-10-12T10:00:00', updated_at: '2026-10-12T10:00:00', reviewed_at: null }
const account = { account_id: 5, name: 'Business cash', currency: 'EUR', balance: 1200, workspace_id: 42, connection_id: null }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })
function setupFetch(role: 'OWNER' | 'EMPLOYEE') {
  setAccessToken(`header.${btoa(JSON.stringify({ sub: role === 'EMPLOYEE' ? '2' : '1', exp: Date.now() / 1000 + 3600 }))}.signature`)
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).endsWith('/workspaces')) expect(new Headers(init?.headers).get('Workspace-ID')).toBe('42')
    if (String(url).endsWith('/categories')) return Response.json([{ category_id: 9, workspace_id: 42, name: 'Travel', type: 'EXPENSE' }])
    if (String(url).endsWith('/accounts')) return Response.json([account])
    if (String(url).endsWith('/workspaces')) return Response.json([{ id: 42, name: 'Business', type: 'BUSINESS', role }])
    if (String(url).endsWith('/api/expenses') && init?.method === 'POST') return Response.json({ ...row, id: 12, description: 'Team dinner' }, { status: 201 })
    if (String(url).endsWith('/expenses/11') && init?.method === 'PUT') return Response.json({ ...row, ...JSON.parse(String(init.body)) })
    if (String(url).endsWith('/expenses/11') && init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (String(url).endsWith('/expenses')) return Response.json([row])
    if (String(url).endsWith('/expenses/11/review')) {
      const decision = JSON.parse(String(init?.body)) as { approve: boolean; account_id?: number }
      return Response.json({ ...row, status: decision.approve ? 'APPROVED' : 'REJECTED', reviewed_by: 1, reviewed_at: '2026-10-12T11:00:00' })
    }
    if (String(url).endsWith('/departments')) return Response.json([])
    if (String(url).endsWith('/projects')) return Response.json([])
    throw new Error(`Unexpected request: ${String(url)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('submits an expense request and displays its pending status', async () => {
  const fetchMock = setupFetch('EMPLOYEE')
  const user = userEvent.setup()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={vi.fn()} />)
  expect(await screen.findByText('Taxi to client')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve Taxi to client' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Submit expense' }))
  const form = within(screen.getByRole('form', { name: 'Submit expense request' }))
  await user.type(form.getByLabelText('Amount (€)'), '42.50')
  await user.selectOptions(form.getByLabelText('Category'), '9')
  await user.type(form.getByLabelText('Description'), 'Team dinner')
  await user.click(form.getByRole('button', { name: 'Submit request' }))
  expect(await screen.findByText('Team dinner')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Expense request submitted.')
  const submission = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/expenses') && init?.method === 'POST')
  expect(JSON.parse(String(submission?.[1]?.body))).toMatchObject({ amount: 42.5, currency: 'EUR', category_id: 9, description: 'Team dinner' })
})

it('lets owners approve pending requests and refreshes transactions after confirmation', async () => {
  const fetchMock = setupFetch('OWNER')
  const onApproved = vi.fn()
  const user = userEvent.setup()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={onApproved} />)
  expect(await screen.findByRole('button', { name: 'Approve Taxi to client' })).toBeInTheDocument()
  await user.selectOptions(await screen.findByLabelText('Account for approvals'), '5')
  await user.click(screen.getByRole('button', { name: 'Approve Taxi to client' }))
  expect(await screen.findByText('approved')).toBeInTheDocument()
  expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 11, status: 'APPROVED' }), { categoryName: 'Travel', departmentName: 'No department', projectName: 'No project' })
  expect(fetchMock).toHaveBeenCalledWith('/api/expenses/11/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ approve: true, account_id: 5 }), headers: expect.any(Headers) }))
})

it('lets owners reject without an approval account or transaction refresh', async () => {
  const fetchMock = setupFetch('OWNER')
  const onApproved = vi.fn()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={onApproved} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Reject Taxi to client' }))
  expect(await screen.findByText('rejected')).toBeInTheDocument()
  expect(onApproved).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledWith('/api/expenses/11/review', expect.objectContaining({ body: JSON.stringify({ approve: false }) }))
})

it('keeps a failed approval pending and does not refresh transactions', async () => {
  const fetchMock = setupFetch('OWNER')
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/review')
    ? Response.json({ detail: 'Expense and account currencies must match' }, { status: 400 })
    : original(url, init))
  const onApproved = vi.fn()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={onApproved} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Approve Taxi to client' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Expense and account currencies must match')
  expect(screen.getByText('pending')).toBeInTheDocument()
  expect(onApproved).not.toHaveBeenCalled()
})

it('edits an own pending request with validation and preserves fields on a failed save', async () => {
  const transport = setupFetch('EMPLOYEE')
  const original = transport.getMockImplementation()!
  let fail = true
  transport.mockImplementation(async (url, init) => String(url).endsWith('/expenses/11') && init?.method === 'PUT' && fail
    ? Response.json({ detail: 'Only pending expenses can be changed or reviewed' }, { status: 409 }) : original(url, init))
  const onApproved = vi.fn()
  const user = userEvent.setup()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={onApproved} />)
  await user.click(await screen.findByRole('button', { name: 'Edit Taxi to client' }))
  const form = within(screen.getByRole('form', { name: 'Edit expense request' }))
  expect(form.getByLabelText('Amount (€)')).toHaveValue(25)
  expect(form.getByLabelText('Category')).toHaveValue('9')
  expect(form.getByLabelText('Description')).toHaveValue('Taxi to client')
  await user.clear(form.getByLabelText('Amount (€)'))
  await user.type(form.getByLabelText('Amount (€)'), '0')
  await user.click(form.getByRole('button', { name: 'Save changes' }))
  expect(transport.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  await user.clear(form.getByLabelText('Amount (€)'))
  await user.type(form.getByLabelText('Amount (€)'), '11')
  await user.click(form.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Only pending expenses')
  expect(form.getByLabelText('Amount (€)')).toHaveValue(11)
  expect(screen.getByRole('list')).toHaveTextContent('€25.00')
  fail = false
  await user.click(form.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  expect(screen.getByRole('list')).toHaveTextContent('€11.00')
  expect(screen.getByText('pending')).toBeInTheDocument()
  expect(onApproved).not.toHaveBeenCalled()
  expect(transport.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]).toMatchObject({ body: expect.stringContaining('"amount":11') })
})

it('confirms withdrawal, permits cancellation, and retains a request on deletion failure', async () => {
  const transport = setupFetch('EMPLOYEE')
  const original = transport.getMockImplementation()!
  let fail = true
  transport.mockImplementation(async (url, init) => init?.method === 'DELETE' && fail
    ? Response.json({ detail: 'Expense was already reviewed' }, { status: 409 }) : original(url, init))
  const onApproved = vi.fn()
  const user = userEvent.setup()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={onApproved} />)
  await user.click(await screen.findByRole('button', { name: 'Withdraw Taxi to client' }))
  expect(transport.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Cancel withdrawal' }))
  expect(screen.queryByRole('group', { name: 'Confirm withdrawal' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Withdraw Taxi to client' }))
  await user.click(within(screen.getByRole('group', { name: 'Confirm withdrawal' })).getByRole('button', { name: 'Withdraw request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Expense was already reviewed')
  expect(screen.getByRole('list')).toHaveTextContent('Taxi to client')
  fail = false
  await user.click(within(screen.getByRole('group', { name: 'Confirm withdrawal' })).getByRole('button', { name: 'Withdraw request' }))
  expect(await screen.findByText('No expense requests yet.')).toBeInTheDocument()
  expect(onApproved).not.toHaveBeenCalled()
})

it('does not offer edits or withdrawal for reviewed or other users’ requests', async () => {
  const transport = setupFetch('EMPLOYEE')
  const original = transport.getMockImplementation()!
  transport.mockImplementation(async (url, init) => String(url).endsWith('/expenses')
    ? Response.json([{ ...row, status: 'APPROVED' }, { ...row, id: 12, status: 'REJECTED' }, { ...row, id: 13, submitted_by: 3 }])
    : original(url, init))
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={catalog} onApproved={vi.fn()} />)
  await screen.findByText('approved')
  expect(screen.queryByRole('button', { name: 'Edit Taxi to client' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Withdraw Taxi to client' })).not.toBeInTheDocument()
})

it('preserves currency, department, project and receipt when editing a pending request', async () => {
  const transport = setupFetch('EMPLOYEE')
  const original = transport.getMockImplementation()!
  const existing = { ...row, currency: 'USD', project_id: 8, receipt_url: 'https://example.com/receipt' }
  transport.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/expenses')) return Response.json([existing])
    if (String(url).endsWith('/expenses/11') && init?.method === 'PUT') return Response.json({ ...existing, ...JSON.parse(String(init.body)) })
    return original(url, init)
  })
  const linkedCatalog = { ...catalog, departments: [{ id: 7, workspace_id: 42, name: 'Design' }], projects: [{ id: 8, workspace_id: 42, name: 'Client', status: 'Active', department_ids: [7], start_date: null, end_date: null }] }
  const user = userEvent.setup()
  render(<ExpenseRequests workspaceId={42} onConnect={vi.fn()} catalog={linkedCatalog} onApproved={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'Edit Taxi to client' }))
  const form = within(screen.getByRole('form', { name: 'Edit expense request' }))
  expect(form.getByLabelText('Amount (USD)')).toHaveValue(25)
  expect(form.getByLabelText('Department')).toHaveValue('7')
  expect(form.getByLabelText('Project')).toHaveValue('8')
  await user.click(form.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  const update = transport.mock.calls.find(([, init]) => init?.method === 'PUT')!
  expect(JSON.parse(String(update[1]?.body))).toMatchObject({ amount: 25, currency: 'USD', category_id: 9, department_id: 7, project_id: 8, receipt_url: existing.receipt_url })
})
