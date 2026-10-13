import { render } from '@/test/render'
import { cleanup, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CategoryManager } from './CategoryManager'
import { setAccessToken, clearSession } from '@/features/auth/storage'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  setAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })

it.each(['personal', 'business'] as const)('loads, creates, edits and deletes API categories in %s', async workspaceKind => {
  let rows = [{ category_id: 9, workspace_id: 42, name: 'Food', type: 'EXPENSE' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('Workspace-ID')).toBe('42')
    expect(new Headers(init.headers).get('Authorization')).toMatch(/^Bearer /)
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      expect(body).toEqual({ name: 'Salary', type: 'INCOME' })
      rows = [...rows, { category_id: 10, workspace_id: 42, ...body }]
      return Response.json(rows[1], { status: 201 })
    }
    if (init.method === 'PUT') {
      expect(url).toBe('/api/categories/10')
      const body = JSON.parse(String(init.body))
      expect(body).toEqual({ name: 'Monthly salary', type: 'INCOME' })
      rows = rows.map(row => row.category_id === 10 ? { ...row, ...body } : row)
      return Response.json(rows[1])
    }
    if (init.method === 'DELETE') {
      expect(url).toBe('/api/categories/10')
      rows = rows.filter(row => row.category_id !== 10)
      return new Response(null, { status: 204 })
    }
    expect(url).toBe('/api/categories')
    return Response.json(rows)
  }))
  const user = userEvent.setup()
  render(<CategoryManager workspaceKind={workspaceKind} workspaceId={42} onConnect={() => {}} />)
  expect(await screen.findByText('Food')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /subcategory/i })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Create category' }))
  let dialog = within(screen.getByRole('dialog'))
  await user.type(dialog.getByLabelText('Name'), 'Salary')
  await user.selectOptions(dialog.getByLabelText('Type'), 'income')
  await user.click(dialog.getByRole('button', { name: 'Create category' }))
  expect(await screen.findByText('Salary')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
  dialog = within(screen.getByRole('dialog'))
  await user.clear(dialog.getByLabelText('Name'))
  await user.type(dialog.getByLabelText('Name'), 'Monthly salary')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Monthly salary')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete Monthly salary' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete category' }))
  await waitFor(() => expect(screen.queryByText('Monthly salary')).not.toBeInTheDocument())
  expect(screen.getByText('Food')).toBeInTheDocument()
})

it.each([409, 500])('keeps a category when deletion fails with HTTP %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init.method === 'DELETE'
    ? Response.json({ detail: 'Category is used by transactions or budgets' }, { status })
    : Response.json([{ category_id: 9, workspace_id: 42, name: 'Food', type: 'EXPENSE' }])))
  const user = userEvent.setup()
  render(<CategoryManager workspaceKind="business" workspaceId={42} onConnect={() => {}} />)
  await screen.findByText('Food')
  await user.click(screen.getByRole('button', { name: 'Delete Food' }))
  const dialog = within(screen.getByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: 'Delete category' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(status === 500 ? 'HTTP 500' : 'used by transactions or budgets')
  expect(screen.getByRole('list', { name: 'Business categories' })).toHaveTextContent('Food')
})

it('discards responses from a previously selected workspace', async () => {
  let resolveOld: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (new Headers(init.headers).get('Workspace-ID') === '1') return new Promise<Response>(resolve => { resolveOld = resolve })
    return Response.json([{ category_id: 2, workspace_id: 2, name: 'Business food', type: 'EXPENSE' }])
  }))
  const { rerender } = render(<CategoryManager workspaceKind="personal" workspaceId={1} onConnect={() => {}} />)
  rerender(<CategoryManager workspaceKind="business" workspaceId={2} onConnect={() => {}} />)
  expect(await screen.findByText('Business food')).toBeInTheDocument()
  resolveOld(Response.json([{ category_id: 1, workspace_id: 1, name: 'Private food', type: 'EXPENSE' }]))
  await waitFor(() => expect(screen.queryByText('Private food')).not.toBeInTheDocument())
})

it('connects the account’s Personal workspace automatically with its server ID', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/workspaces')
    ? [{ id: 7, name: 'My Personal', type: 'PERSONAL', role: 'OWNER' }, { id: 42, name: 'Acme', type: 'BUSINESS', role: 'OWNER' }] : [])))
  const onConnect = vi.fn()
  render(<CategoryManager workspaceKind="personal" onConnect={onConnect} />)
  await waitFor(() => expect(onConnect).toHaveBeenCalledWith(7))
  expect(screen.queryByLabelText('Workspace ID')).not.toBeInTheDocument()
})

it('refuses an inaccessible workspace before saving the connection', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/workspaces')
    ? Response.json([{ id: 42, name: 'Acme', type: 'BUSINESS', role: 'OWNER' }])
    : Response.json({ detail: 'No access to this workspace' }, { status: 403 })))
  const onConnect = vi.fn()
  const user = userEvent.setup()
  render(<CategoryManager workspaceKind="business" onConnect={onConnect} />)
  await screen.findByRole('option', { name: 'Acme' })
  await user.selectOptions(screen.getByLabelText('Workspace'), '42')
  await user.click(screen.getByRole('button', { name: 'Load categories' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Your account cannot access workspace 42')
  expect(onConnect).not.toHaveBeenCalled()
})

it('preserves entered category details after a rejected create request', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init.method === 'POST'
    ? Response.json({ detail: 'Workspace owner required' }, { status: 403 }) : Response.json([])))
  const user = userEvent.setup()
  render(<CategoryManager workspaceKind="business" workspaceId={42} onConnect={() => {}} />)
  await screen.findByText('No categories yet')
  await user.click(screen.getByRole('button', { name: 'Create category' }))
  const dialog = within(screen.getByRole('dialog'))
  await user.type(dialog.getByLabelText('Name'), 'Travel')
  await user.click(dialog.getByRole('button', { name: 'Create category' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('Workspace owner required')
  expect(dialog.getByLabelText('Name')).toHaveValue('Travel')
  expect(screen.getByText('No categories yet')).toBeInTheDocument()
})

it('does not offer Personal workspaces in the Business workspace picker', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ id: 7, name: 'My Personal', type: 'PERSONAL', role: 'OWNER' }])))
  const onConnect = vi.fn()
  render(<CategoryManager workspaceKind="business" onConnect={onConnect} />)
  await screen.findByText('No accessible Business workspaces')
  expect(screen.queryByRole('option', { name: 'My Personal' })).not.toBeInTheDocument()
  expect(onConnect).not.toHaveBeenCalled()
})
