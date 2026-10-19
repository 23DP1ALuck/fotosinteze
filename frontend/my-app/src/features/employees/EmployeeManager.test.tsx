import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { EmployeeManager } from './EmployeeManager'

const owner = { user_id: 1, workspace_id: 42, display_name: 'Ada', email: 'ada@example.com', role: 'OWNER', department_id: null as number | null, joined_at: '2026-10-01T12:00:00' }
const anna = { ...owner, user_id: 8, display_name: 'Anna', email: 'anna@example.com', role: 'EMPLOYEE' }
let client: QueryClient
beforeEach(() => {
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`)
  setWorkspace(1, 42)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
})
afterEach(() => { cleanup(); client.clear(); clearSession(); vi.unstubAllGlobals() })
function mount(canManage = true) {
  return render(<QueryClientProvider client={client}><EmployeeManager workspaceId={42} workspaceName="Studio" canManage={canManage} /></QueryClientProvider>)
}
function transport(mutate: (path: string, init?: RequestInit) => Promise<Response>, initial = [owner, anna]) {
  let members = initial
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = new URL(String(url), 'http://test').pathname.replace(/^\/api/, '')
    return path === '/departments' ? Response.json([{ id: 7, workspace_id: 42, name: 'Development' }, { id: 8, workspace_id: 42, name: 'Marketing' }]) : path.endsWith('/members') ? Response.json(members) : mutate(path, init)
  }))
  return (next: typeof initial) => { members = next }
}
async function openAdd() {
  await screen.findByRole('list', { name: 'Workspace members' })
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }))
  const form = within(screen.getByRole('dialog', { name: 'Add employee' }))
  await userEvent.selectOptions(form.getByLabelText('Department'), '7')
  return form
}

it('hides member management without making a request for employees', () => {
  vi.stubGlobal('fetch', vi.fn())
  mount(false)
  expect(screen.queryByRole('region', { name: 'Employees management' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('validates email locally and trims it before sending an atomic department assignment', async () => {
  let submitted = ''
  transport(async (path, init) => {
    expect(path).toBe('/workspaces/42/employees')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'new@example.com', department_id: 7 })
    submitted = 'new@example.com'
    return Response.json({ ...anna, user_id: 9, email: submitted }, { status: 201 })
  })
  mount()
  const form = await openAdd()
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  expect(form.getByRole('alert')).toBeInTheDocument()
  expect(submitted).toBe('')
  await userEvent.type(form.getByLabelText('Email address'), '  new@example.com  ')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(submitted).toBe('new@example.com')
})

it.each([
  [404, { detail: 'User not found' }, /No registered user/],
  [409, { detail: 'User is already a workspace member' }, /already a workspace member/],
  [422, { detail: [{ msg: 'Email address is invalid' }] }, /Email address is invalid/],
  [403, { detail: 'Workspace owner required' }, /Only workspace owners/],
  [500, { detail: 'private error' }, /server returned an error/],
])('keeps the email form open on HTTP %s so the owner can correct or retry it', async (status, body, message) => {
  let fail = true
  transport(async () => fail ? Response.json(body, { status }) : Response.json({ ...anna, user_id: 9, email: 'new@example.com' }, { status: 201 }))
  mount()
  const form = await openAdd()
  await userEvent.type(form.getByLabelText('Email address'), 'new@example.com')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  expect(await form.findByRole('alert')).toHaveTextContent(message)
  expect(form.getByLabelText('Email address')).toHaveValue('new@example.com')
  fail = false
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('confirms removal, disables repeat submission, and removes only the employee after a 204', async () => {
  let finish: (response: Response) => void = () => {}
  const updateMembers = transport(async (path, init) => {
    expect(path).toBe('/workspaces/42/employees/8')
    expect(init?.method).toBe('DELETE')
    return new Promise<Response>(resolve => { finish = resolve })
  })
  mount()
  await screen.findByText('anna@example.com')
  expect(screen.queryByRole('button', { name: 'Remove Ada' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Anna' }))
  let form = within(screen.getByRole('dialog'))
  await userEvent.click(form.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('anna@example.com')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Anna' }))
  form = within(screen.getByRole('dialog'))
  await userEvent.click(form.getByRole('button', { name: 'Remove employee' }))
  expect(form.getByRole('button', { name: 'Removing…' })).toBeDisabled()
  updateMembers([owner])
  await act(async () => finish(new Response(null, { status: 204 })))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument()
  expect(screen.getByText('ada@example.com')).toBeInTheDocument()
})

it('preserves the member and removal dialog after a network failure', async () => {
  transport(async () => { throw new TypeError('network unavailable') })
  mount()
  await screen.findByText('anna@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Remove Anna' }))
  const form = within(screen.getByRole('dialog'))
  await userEvent.click(form.getByRole('button', { name: 'Remove employee' }))
  expect(await form.findByRole('alert')).toHaveTextContent('Cannot reach the server')
  expect(screen.getByRole('list', { name: 'Workspace members' })).toHaveTextContent('anna@example.com')
})

it('shows a retryable list error and rejects member data from another workspace', async () => {
  let invalid = true
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/departments') ? [] : invalid ? [{ ...anna, workspace_id: 43 }] : [owner, anna])))
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected member data')
  expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled()
  invalid = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry members' }))
  expect(await screen.findByText('anna@example.com')).toBeInTheDocument()
})

it('keeps an in-flight mutation scoped to its original workspace', async () => {
  let finish: (response: Response) => void = () => {}
  transport(async () => new Promise<Response>(resolve => { finish = resolve }))
  const view = mount()
  const form = await openAdd()
  await userEvent.type(form.getByLabelText('Email address'), 'new@example.com')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  view.unmount(); setWorkspace(1, 43)
  await act(async () => finish(Response.json({ ...anna, user_id: 9, email: 'new@example.com' }, { status: 201 })))
  await waitFor(() => expect(client.getQueryData(['members', 1, 42])).toEqual([owner, anna, { ...anna, user_id: 9, email: 'new@example.com' }]))
  expect(client.getQueryData(['members', 1, 43])).toBeUndefined()
})

it('does not recreate member caches when a request completes after logout', async () => {
  let finish: (response: Response) => void = () => {}
  transport(async () => new Promise<Response>(resolve => { finish = resolve }))
  const view = mount()
  const form = await openAdd()
  await userEvent.type(form.getByLabelText('Email address'), 'new@example.com')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  view.unmount(); clearSession(); client.clear()
  await act(async () => finish(Response.json({ ...anna, user_id: 9, email: 'new@example.com' }, { status: 201 })))
  expect(client.getQueryData(['members', 1, 42])).toBeUndefined()
})

it('allows existing users with Unicode email addresses supported by the backend', async () => {
  transport(async (_path, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'JĀNIS@example.com', department_id: 7 })
    return Response.json({ ...anna, user_id: 9, email: 'JĀNIS@example.com' }, { status: 201 })
  })
  mount()
  const form = await openAdd()
  await userEvent.type(form.getByLabelText('Email address'), 'JĀNIS@example.com')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('requires a department before adding an employee', async () => {
  const mutate = vi.fn(async () => Response.json(anna))
  transport(mutate); mount()
  const form = await openAdd()
  await userEvent.selectOptions(form.getByLabelText('Department'), '')
  await userEvent.type(form.getByLabelText('Email address'), 'new@example.com')
  await userEvent.click(form.getByRole('button', { name: 'Add employee' }))
  expect(await form.findByRole('alert')).toHaveTextContent('Choose a department')
  expect(mutate).not.toHaveBeenCalled()
})

it('keeps a failed department reassignment selected for retry', async () => {
  let fail = true
  const update = transport(async (path, init) => {
    expect(path).toBe('/departments/8/employees/8')
    expect(init?.method).toBe('PUT')
    expect(new Headers(init?.headers).get('Workspace-ID')).toBe('42')
    return fail ? Response.json({ detail: 'Try again' }, { status: 400 }) : Response.json({ user_id: 8, workspace_id: 42, department_id: 8 })
  }, [owner, { ...anna, department_id: 7 }])
  mount()
  await screen.findByText('Development')
  await userEvent.click(screen.getByRole('button', { name: 'Assign department for Anna' }))
  const form = within(screen.getByRole('dialog'))
  await userEvent.selectOptions(form.getByLabelText('Department'), '8')
  await userEvent.click(form.getByRole('button', { name: 'Save department' }))
  expect(await form.findByRole('alert')).toHaveTextContent('Try again')
  expect(form.getByLabelText('Department')).toHaveValue('8')
  fail = false; update([owner, { ...anna, department_id: 8 }])
  await userEvent.click(form.getByRole('button', { name: 'Save department' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('Marketing')).toBeInTheDocument()
})

it('guides owners to create a department before adding employees', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/departments') ? [] : [owner, anna])))
  mount()
  expect(await screen.findByText(/Create a department in Departments first/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add employee' })).toBeDisabled()
})
