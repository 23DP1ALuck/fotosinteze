import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { DepartmentManager } from './DepartmentManager'

afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })

it('updates the original cache when deletion finishes after a workspace switch', async () => {
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`)
  setWorkspace(1, 42)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  const department = { id: 8, workspace_id: 42, name: 'Design' }
  client.setQueryData(['departments', 1, 42], [department])
  client.setQueryData(['projects', 1, 42], { projects: [] })
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const view = render(<QueryClientProvider client={client}><DepartmentManager workspaceId={42} workspaceName="Studio" canManage /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Delete Design' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete department' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  view.unmount()
  setWorkspace(1, 43)
  await act(async () => finish(Response.json(null)))
  await waitFor(() => expect(client.getQueryData(['departments', 1, 42])).toEqual([]))
  expect(client.getQueryState(['departments', 1, 42])?.isInvalidated).toBe(true)
  expect(client.getQueryState(['projects', 1, 42])?.isInvalidated).toBe(true)
  expect(client.getQueryData(['departments', 1, 43])).toBeUndefined()
  client.clear()
})
