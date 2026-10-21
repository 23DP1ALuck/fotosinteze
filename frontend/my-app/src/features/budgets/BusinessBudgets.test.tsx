import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { BusinessBudgets } from './BusinessBudgets'

const budget = { id: 1, workspace_id: 42, name: 'Travel plan', target_type: 'CATEGORY', target_id: 9, target_name: 'Travel', limit_amount: '100.00', currency: 'EUR', period_start: '2026-10-01', period_end: '2026-11-01', period_length: 'MONTHLY', duration_days: null, spent: '85.00', remaining: '15.00', status: 'WARNING' }
const targets = { CATEGORY: [{ id: 9, name: 'Travel' }], DEPARTMENT: [{ id: 7, name: 'Design' }], PROJECT: [{ id: 10, name: 'Launch' }] }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })
function setup(owner = true) {
  setAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now()/1000+3600 }))}.signature`)
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/workspaces')) return Response.json([{ id: 42, name: 'Acme', type: 'BUSINESS', role: 'OWNER' }])
    expect(new Headers(init?.headers).get('Workspace-ID')).toBe('42')
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      return Response.json({ ...budget, ...body, id: init.method === 'POST' ? 2 : 1, target_name: targets[body.target_type as keyof typeof targets][0].name })
    }
    return Response.json({ workspace_id: 42, can_manage: owner, progress_scope: owner ? 'WORKSPACE' : 'ASSIGNED_DEPARTMENT', targets: owner ? targets : {}, budgets: [budget] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
it('saves a project target, edits a budget and deletes only after confirmation', async () => {
  const fetchMock = setup()
  const user = userEvent.setup()
  render(<BusinessBudgets workspaceId={42} onConnect={vi.fn()} />)
  expect(await screen.findByText('Almost there')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Create budget' }))
  let form = within(screen.getByRole('form', { name: 'Create business budget' }))
  await user.type(form.getByLabelText('Budget name'), 'Launch budget')
  await user.type(form.getByLabelText('Limit'), '250')
  fireEvent.input(form.getByLabelText('Period start'), { target: { value: '2026-10-01' } })
  await user.selectOptions(form.getByLabelText('Category'), '9')
  await user.selectOptions(form.getByLabelText('Target type'), 'PROJECT')
  expect(form.getByLabelText('Project')).toHaveValue('')
  await user.selectOptions(form.getByLabelText('Project'), '10')
  await user.selectOptions(form.getByLabelText('Period'), 'CUSTOM')
  await user.clear(form.getByLabelText('Duration (days)'))
  await user.type(form.getByLabelText('Duration (days)'), '14')
  await user.click(form.getByRole('button', { name: 'Save budget' }))
  expect(await screen.findByText('Budget created.')).toBeInTheDocument()
  const call = fetchMock.mock.calls.find(([,init]) => init?.method === 'POST')
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ target_type: 'PROJECT', target_id: 10, limit_amount: '250', period_start: '2026-10-01', period_length: 'CUSTOM', duration_days: 14 })
  await user.click(screen.getByRole('button', { name: 'Edit Travel plan' }))
  form = within(screen.getByRole('form', { name: 'Edit business budget' }))
  await user.selectOptions(form.getByLabelText('Target type'), 'DEPARTMENT')
  await user.selectOptions(form.getByLabelText('Department'), '7')
  await user.click(form.getByRole('button', { name: 'Save budget' }))
  expect(await screen.findByText('Budget updated.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete Travel plan' }))
  expect(fetchMock.mock.calls.some(([,init]) => init?.method === 'DELETE')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(await screen.findByText('Budget deleted.')).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Budget Travel plan' })).not.toBeInTheDocument()
})
it('shows employees progress without management controls', async () => {
  setup(false)
  render(<BusinessBudgets workspaceId={42} onConnect={vi.fn()} />)
  expect(await screen.findByText('Almost there')).toBeInTheDocument()
  expect(screen.getByText(/Read-only progress/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create budget' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit Travel plan' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Travel plan' })).not.toBeInTheDocument()
})
it('retains a failed save and its input without claiming success', async () => {
  const fetchMock = setup()
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => init?.method === 'PUT' ? Response.json({ detail: 'Workspace owner required' }, { status: 403 }) : original(url, init))
  render(<BusinessBudgets workspaceId={42} onConnect={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Travel plan' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace owner required')
  expect(screen.getByLabelText('Budget name')).toHaveValue('Travel plan')
  expect(screen.queryByText('Budget updated.')).not.toBeInTheDocument()
})
it('offers accessible business workspaces when no workspace is connected', async () => {
  setup()
  const onConnect = vi.fn()
  render(<BusinessBudgets onConnect={onConnect} />)
  await screen.findByRole('option', { name: 'Acme' })
  await userEvent.selectOptions(screen.getByLabelText('Business workspace'), '42')
  expect(onConnect).toHaveBeenCalledWith(42)
})


it('filters budget projects by department while keeping workspace-wide projects available', async () => {
  setup()
  const catalog = { workspaceId: 42, projects: [
    { id: 10, workspace_id: 42, name: 'Launch', department_ids: [7], status: null, start_date: null, end_date: null },
    { id: 11, workspace_id: 42, name: 'Sales plan', department_ids: [8], status: null, start_date: null, end_date: null },
    { id: 12, workspace_id: 42, name: 'Workspace plan', department_ids: [], status: null, start_date: null, end_date: null },
  ], departments: [{ id: 7, workspace_id: 42, name: 'Design' }, { id: 8, workspace_id: 42, name: 'Sales' }], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }
  const { rerender } = render(<BusinessBudgets workspaceId={42} catalog={catalog} onConnect={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Create budget' }))
  const form = within(screen.getByRole('form', { name: 'Create business budget' }))
  await userEvent.selectOptions(form.getByLabelText('Target type'), 'PROJECT')
  await userEvent.selectOptions(form.getByLabelText('Project'), '11')
  await userEvent.selectOptions(form.getByLabelText('Filter projects by department'), '7')
  expect(form.getByLabelText('Project')).toHaveValue('')
  expect(form.queryByRole('option', { name: 'Sales plan' })).not.toBeInTheDocument()
  expect(form.getByRole('option', { name: 'Workspace plan' })).toBeInTheDocument()
  await userEvent.selectOptions(form.getByLabelText('Project'), '12')
  await userEvent.selectOptions(form.getByLabelText('Filter projects by department'), '8')
  expect(form.getByLabelText('Project')).toHaveValue('12')
  await userEvent.selectOptions(form.getByLabelText('Filter projects by department'), '7')
  rerender(<BusinessBudgets workspaceId={42} catalog={{ ...catalog, departments: catalog.departments.filter(item => item.id !== 7) }} onConnect={() => {}} />)
  expect(form.getByLabelText('Filter projects by department')).toHaveValue('')
  expect(form.getByRole('option', { name: 'Sales plan' })).toBeInTheDocument()
})
