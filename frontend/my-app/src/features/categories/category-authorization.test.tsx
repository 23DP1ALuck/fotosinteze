import { useState } from 'react'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth/auth-context'
import { useAuth } from '@/features/auth/use-auth'
import { clearSession } from '@/features/auth/storage'
import { CategoryManager } from './CategoryManager'

function LoginCategories() {
  const auth = useAuth()
  const [workspaceId, setWorkspaceId] = useState<number>()
  if (auth.status === 'loading') return <p>Restoring session</p>
  if (auth.status !== 'authenticated') return <button onClick={() => void auth.login('category-test@example.test', 'TestPassword123!')}>Sign in</button>
  return <CategoryManager workspaceKind="personal" workspaceId={workspaceId} onConnect={setWorkspaceId} />
}
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
it('sends the exact access token returned by login on every category GET, POST, PUT and DELETE', async () => {
  clearSession()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  const token = `header.${btoa(JSON.stringify({ sub: '3', email: 'category-test@example.test', display_name: 'Category test', exp: Math.floor(Date.now()/1000)+3600 }))}.signature`
  let rows: { category_id: number; workspace_id: number; name: string; type: string }[] = []
  const methods = new Set<string>()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/auth/refresh') return Response.json({ detail: 'Not authenticated' }, { status: 401 })
    if (url === '/api/auth/login') return Response.json({ access_token: token })
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
    if (url === '/api/workspaces') return Response.json([{ id: 7, name: 'My Personal workspace', type: 'PERSONAL', role: 'OWNER' }])
    expect(headers.get('Workspace-ID')).toBe('7')
    methods.add(init.method || 'GET')
    if (init.method === 'POST') {
      expect(headers.get('Content-Type')).toBe('application/json')
      rows = [{ category_id: 11, workspace_id: 7, ...JSON.parse(String(init.body)) }]
      return Response.json(rows[0], { status: 201 })
    }
    if (init.method === 'PUT') {
      rows = [{ ...rows[0], ...JSON.parse(String(init.body)) }]
      return Response.json(rows[0])
    }
    if (init.method === 'DELETE') { rows = []; return new Response(null, { status: 204 }) }
    return Response.json(rows)
  }))
  const user = userEvent.setup()
  render(<AuthProvider><LoginCategories /></AuthProvider>)
  await user.click(await screen.findByRole('button', { name: 'Sign in' }))
  await screen.findByText('No categories yet')
  await user.click(screen.getByRole('button', { name: 'Create category' }))
  let dialog = within(screen.getByRole('dialog'))
  await user.type(dialog.getByLabelText('Name'), 'Food')
  await user.click(dialog.getByRole('button', { name: 'Create category' }))
  await screen.findByRole('button', { name: 'Edit Food' })
  await user.click(screen.getByRole('button', { name: 'Edit Food' }))
  dialog = within(screen.getByRole('dialog'))
  await user.clear(dialog.getByLabelText('Name'))
  await user.type(dialog.getByLabelText('Name'), 'Groceries')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('button', { name: 'Delete Groceries' })
  await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete category' }))
  await waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument())
  expect(methods).toEqual(new Set(['GET', 'POST', 'PUT', 'DELETE']))
})
