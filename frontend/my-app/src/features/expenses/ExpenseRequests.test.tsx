import { cleanup, render, screen, within } from '@testing-library/react'
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
  setAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`)
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).endsWith('/workspaces')) expect(new Headers(init?.headers).get('Workspace-ID')).toBe('42')
    if (String(url).endsWith('/categories')) return Response.json([{ category_id: 9, workspace_id: 42, name: 'Travel', type: 'EXPENSE' }])
    if (String(url).endsWith('/accounts')) return Response.json([account])
    if (String(url).endsWith('/workspaces')) return Response.json([{ id: 42, name: 'Business', type: 'BUSINESS', role }])
    if (String(url).endsWith('/api/expenses') && init?.method === 'POST') return Response.json({ ...row, id: 12, description: 'Team dinner' }, { status: 201 })
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
