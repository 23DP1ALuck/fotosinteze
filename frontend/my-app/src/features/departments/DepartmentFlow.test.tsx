import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { createFinanceTransport } from '@/test/finance-transport'
import { AuthContext } from '@/features/auth/use-auth'
import { clearSession, getAccessToken, setAccessToken } from '@/features/auth/storage'
import HomePage from '@/pages/HomePage'

const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
type Department = { id: number; workspace_id: number; name: string }
let departments: Map<number, Department[]>
let failList: boolean
let failSave: boolean
let failDelete: boolean
let deferredList: (() => Promise<Response>) | undefined
beforeEach(() => {
  localStorage.clear(); clearSession(); setAccessToken(token); localStorage.setItem('fotosinteze.workspace.1', '42')
  departments = new Map([[42, [{ id: 8, workspace_id: 42, name: 'Design' }]], [43, [{ id: 9, workspace_id: 43, name: 'Operations' }]]])
  failList = false; failSave = false; failDelete = false; deferredList = undefined
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  const finance = createFinanceTransport()
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api/, '')
    const workspaceId = Number(new Headers(init?.headers).get('X-Workspace-ID'))
    const method = init?.method ?? 'GET'
    if (path === '/workspaces') return Response.json([{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }, { id: 42, name: 'Studio', type: 'BUSINESS', role: 'OWNER' }, { id: 43, name: 'Agency', type: 'BUSINESS', role: 'EMPLOYEE' }])
    if (path.startsWith('/departments')) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
      expect(new Headers(init?.headers).get('Workspace-ID')).toBe(String(workspaceId))
      if (method === 'GET') {
        if (workspaceId === 43 && deferredList) return deferredList()
        return failList ? Response.json({ detail: 'Unavailable' }, { status: 503 }) : Response.json(departments.get(workspaceId) ?? [])
      }
      expect(workspaceId).toBe(42)
      expect(init?.body).toBeUndefined()
      const list = departments.get(workspaceId) ?? []
      const id = method === 'POST' ? 20 : Number(path.split('/').at(-1))
      if (method === 'DELETE') {
        if (failDelete) return Response.json({ detail: 'Reassign employees before deleting this department' }, { status: 409 })
        departments.set(workspaceId, list.filter(item => item.id !== id))
        return Response.json(null)
      }
      if (failSave) return Response.json({ detail: 'Department name is already taken in this workspace' }, { status: 409 })
      const row = { id, workspace_id: workspaceId, name: url.searchParams.get('name') ?? '' }
      departments.set(workspaceId, [...list.filter(item => item.id !== id), row])
      return Response.json(row, { status: method === 'POST' ? 201 : 200 })
    }
    if (path === '/projects') return Response.json((departments.get(workspaceId) ?? []).map(item => ({ id: item.id + 10, workspace_id: workspaceId, name: `${item.name} project`, department_ids: [item.id] })))
    if (path === '/business-budgets') return Response.json({ workspace_id: workspaceId, can_manage: workspaceId === 42, progress_scope: workspaceId === 42 ? 'WORKSPACE' : 'ASSIGNED_DEPARTMENT', budgets: [], targets: { DEPARTMENT: (departments.get(workspaceId) ?? []).map(item => ({ id: item.id, name: item.name })), CATEGORY: [], PROJECT: [] } })
    return finance.respond(input, init) ?? Response.json([])
  }))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
function mount() {
  render(<AuthContext.Provider value={{ status: 'authenticated', user: { id: 1, email: 'ada@example.com', displayName: 'Ada' }, token, login: async () => {}, register: async () => {}, logout: async () => {} }}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
}
async function openDepartments() {
  await userEvent.click(await screen.findByRole('button', { name: 'Departments' }))
  return within(await screen.findByRole('region', { name: 'Departments management' }))
}
async function createDepartment(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Add department' }))
  const modal = within(screen.getByRole('dialog', { name: 'Create department' }))
  await userEvent.type(modal.getByLabelText('Department name'), name)
  await userEvent.click(modal.getByRole('button', { name: 'Create department' }))
}

it('creates, renames and deletes departments using query parameters, refreshing both form selectors', async () => {
  mount()
  await openDepartments()
  await createDepartment('Research & Development')
  await screen.findByRole('button', { name: 'Rename Research & Development' })
  const creation = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes('/departments?') && init?.method === 'POST')!
  expect(new URL(String(creation[0]), 'http://localhost').searchParams.get('name')).toBe('Research & Development')
  await userEvent.click(screen.getByRole('button', { name: 'Add expense' }))
  let modal = within(screen.getByRole('dialog', { name: 'Add expense' }))
  expect(await modal.findByRole('option', { name: 'Research & Development' })).toBeInTheDocument()
  await userEvent.click(modal.getByRole('button', { name: 'Close transaction form' }))
  await userEvent.click(screen.getByRole('button', { name: 'Budgets' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Create budget' }))
  const budgetForm = within(screen.getByRole('form', { name: 'Create business budget' }))
  await userEvent.selectOptions(budgetForm.getByLabelText('Target type'), 'DEPARTMENT')
  expect(budgetForm.getByRole('option', { name: 'Research & Development' })).toBeInTheDocument()
  await openDepartments()
  await userEvent.click(screen.getByRole('button', { name: 'Rename Research & Development' }))
  modal = within(screen.getByRole('dialog', { name: 'Rename department' }))
  await userEvent.clear(modal.getByLabelText('Department name'))
  await userEvent.type(modal.getByLabelText('Department name'), 'Product research')
  await userEvent.click(modal.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('button', { name: 'Rename Product research' })
  await userEvent.click(screen.getByRole('button', { name: 'Delete Product research' }))
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete department' })).getByRole('button', { name: 'Delete department' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename Product research' })).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Add income' }))
  modal = within(screen.getByRole('dialog', { name: 'Add income' }))
  await waitFor(() => expect(modal.getByLabelText('Department')).toBeEnabled())
  expect(modal.queryByRole('option', { name: 'Product research' })).not.toBeInTheDocument()
})

it('validates names and retains input after a duplicate-name response', async () => {
  mount(); await openDepartments()
  await userEvent.click(await screen.findByRole('button', { name: 'Add department' }))
  const modal = within(screen.getByRole('dialog', { name: 'Create department' }))
  await userEvent.type(modal.getByLabelText('Department name'), '   ')
  await userEvent.click(modal.getByRole('button', { name: 'Create department' }))
  expect(await modal.findByRole('alert')).toHaveTextContent(/name/i)
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  await userEvent.clear(modal.getByLabelText('Department name'))
  await userEvent.type(modal.getByLabelText('Department name'), 'Design')
  failSave = true
  await userEvent.click(modal.getByRole('button', { name: 'Create department' }))
  expect(await modal.findByRole('alert')).toHaveTextContent('Department name is already taken')
  expect(modal.getByLabelText('Department name')).toHaveValue('Design')
  failSave = false
  await userEvent.click(modal.getByRole('button', { name: 'Create department' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create department' })).not.toBeInTheDocument())
})

it('keeps a department when deletion is blocked by assigned employees', async () => {
  failDelete = true
  mount(); await openDepartments()
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Design' }))
  const modal = within(screen.getByRole('dialog', { name: 'Delete department' }))
  await userEvent.click(modal.getByRole('button', { name: 'Delete department' }))
  expect(await modal.findByRole('alert')).toHaveTextContent('Reassign employees')
  expect(screen.getByRole('list', { name: 'Departments' })).toHaveTextContent('Design')
  expect(modal.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})

it('lets employees filter by their assigned department without department management or direct transactions', async () => {
  localStorage.setItem('fotosinteze.workspace.1', '43')
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  expect(screen.queryByRole('button', { name: 'Departments' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add income' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
  const department = screen.getByRole('combobox', { name: 'Filter by department' })
  expect(await within(department).findByRole('option', { name: 'Operations' })).toBeInTheDocument()
  expect(within(department).queryByRole('option', { name: 'Design' })).not.toBeInTheDocument()
  await userEvent.selectOptions(department, 'Operations')
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = new URL(String(input), 'http://localhost')
    return url.pathname.endsWith('/transactions') && url.searchParams.get('department_id') === '9'
  })).toBe(true))
  await userEvent.click(screen.getByRole('button', { name: 'Budgets' }))
  expect(await screen.findByText(/Read-only progress/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create budget' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('/departments') && init?.method && init.method !== 'GET')).toBe(false)
})

it('handles a failed department list with retry', async () => {
  failList = true
  mount(); await openDepartments()
  expect(await screen.findByRole('button', { name: 'Retry departments' })).toBeInTheDocument()
  failList = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry departments' }))
  expect(await screen.findByRole('button', { name: 'Rename Design' })).toBeInTheDocument()
})

it('clears old departments while switching workspaces and preserves the JWT', async () => {
  let finish: (response: Response) => void = () => {}
  deferredList = () => new Promise(resolve => { finish = resolve })
  mount(); await openDepartments()
  await screen.findByRole('button', { name: 'Rename Design' })
  await userEvent.click(screen.getByRole('button', { name: 'Switch workspace, Studio' }))
  await userEvent.click(screen.getByRole('button', { name: 'Switch to Agency' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Transactions' }))
  expect(screen.queryByRole('region', { name: 'Departments management' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Departments' })).not.toBeInTheDocument()
  const department = screen.getByRole('combobox', { name: 'Filter by department' })
  expect(within(department).queryByRole('option', { name: 'Design' })).not.toBeInTheDocument()
  expect(within(department).queryByRole('option', { name: 'Operations' })).not.toBeInTheDocument()
  await act(async () => finish(Response.json(departments.get(43))))
  expect(await within(department).findByRole('option', { name: 'Operations' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add department' })).not.toBeInTheDocument()
  expect(getAccessToken()).toBe(token)
})
