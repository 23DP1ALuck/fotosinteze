import { useEffect } from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { AccountManager } from './AccountManager'

const manual = { account_id: 10, workspace_id: 42, name: 'Cash', currency: 'EUR', balance: '1234.56', connection_id: null, is_main: false }
const bank = { ...manual, account_id: 11, name: 'Revolut', currency: 'GBP', balance: '-25.50', connection_id: 7 }
function Harness({ id = 42 }: { id?: number }) {
  useEffect(() => { setWorkspace(1, id) }, [id])
  return <AccountManager workspaceId={id} workspaceName={`Workspace ${id}`} />
}
function transport(rows = [manual, bank]) {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('Workspace-ID')).toBe('42')
    expect(new Headers(init.headers).get('Authorization')).toMatch(/^Bearer /)
    const accountId = Number(url.split('/').at(-1))
    if (init.method === 'PUT') {
      const input = JSON.parse(String(init.body))
      rows = rows.map(row => row.account_id === accountId ? { ...row, ...input } : input.is_main ? { ...row, is_main: false } : row)
    }
    return Response.json(url === '/api/accounts' ? rows : rows.find(row => row.account_id === accountId))
  })
}
beforeEach(() => {
  localStorage.clear()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })

it('lists scoped accounts with formatted balances and loads protected account details', async () => {
  const fetcher = transport()
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  const list = within(await screen.findByRole('list', { name: 'Accounts' }))
  expect(list.getByText('€1,234.56')).toBeInTheDocument()
  expect(list.getByText('-£25.50')).toBeInTheDocument()
  expect(list.getByText('Manual / internal')).toBeInTheDocument()
  expect(list.getByText('Revolut-linked')).toBeInTheDocument()
  await user.click(list.getByRole('button', { name: 'View Revolut details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Revolut'))
  expect(fetcher).toHaveBeenCalledWith('/api/accounts/11', expect.anything())
  for (const label of ['Currency', 'Current balance (GBP)']) expect(dialog.getByLabelText(label)).toHaveAttribute('readonly')
  await user.clear(dialog.getByLabelText('Display name'))
  await user.type(dialog.getByLabelText('Display name'), 'Travel card')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('button', { name: 'View Travel card details' })
  const put = fetcher.mock.calls.find(([, init]) => init.method === 'PUT')!
  expect(JSON.parse(String(put[1].body))).toEqual({ name: 'Travel card' })
})

it('persists a manual name and balance edit when the screen is reopened', async () => {
  const fetcher = transport()
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  const first = render(<Harness />)
  await user.click(await screen.findByRole('button', { name: 'View Cash details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Cash'))
  await user.clear(dialog.getByLabelText('Display name')); await user.type(dialog.getByLabelText('Display name'), 'Petty cash')
  await user.clear(dialog.getByLabelText('Current balance (EUR)')); await user.type(dialog.getByLabelText('Current balance (EUR)'), '-45.67')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('button', { name: 'View Petty cash details' })
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init.method === 'PUT')![1].body))).toEqual({ name: 'Petty cash', balance: '-45.67' })
  first.unmount()
  render(<Harness />)
  await screen.findByRole('button', { name: 'View Petty cash details' })
  expect(screen.getByRole('list', { name: 'Accounts' })).toHaveTextContent('-€45.67')
})

it('clears the previous workspace and open dialog immediately and ignores late responses', async () => {
  let oldDetail: (response: Response) => void = () => {}
  let newList: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const id = new Headers(init.headers).get('Workspace-ID')
    if (id === '43') return new Promise<Response>(resolve => { newList = resolve })
    if (String(url).endsWith('/10')) return new Promise<Response>(resolve => { oldDetail = resolve })
    return Response.json([manual])
  }))
  const { rerender } = render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'View Cash details' }))
  rerender(<Harness id={43} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Cash')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading accounts')
  await act(async () => { oldDetail(Response.json(manual)); newList(Response.json([{ ...manual, workspace_id: 43, name: 'Other workspace cash' }])) })
  await screen.findByRole('button', { name: 'View Other workspace cash details' })
  expect(screen.queryByText('Cash')).not.toBeInTheDocument()
})

it('preserves edits after an API failure and prevents duplicate submissions while saving', async () => {
  let finish: (response: Response) => void = () => {}
  const base = transport()
  const fetcher = vi.fn((url, init: RequestInit) => init.method === 'PUT' ? new Promise<Response>(resolve => { finish = resolve }) : base(url, init))
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(await screen.findByRole('button', { name: 'View Cash details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Cash'))
  await user.clear(dialog.getByLabelText('Display name')); await user.type(dialog.getByLabelText('Display name'), 'My draft')
  await user.dblClick(dialog.getByRole('button', { name: 'Save changes' }))
  expect(dialog.getByRole('button', { name: /Saving/ })).toBeDisabled()
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1)
  await act(async () => finish(Response.json({ detail: 'Account name is already taken in this workspace' }, { status: 409 })))
  expect(await dialog.findByRole('alert')).toHaveTextContent('Account name is already taken')
  expect(dialog.getByLabelText('Display name')).toHaveValue('My draft')
  expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled()
})

it('validates empty names and decimal precision before making a save request', async () => {
  const fetcher = transport()
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(await screen.findByRole('button', { name: 'View Cash details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Cash'))
  await user.clear(dialog.getByLabelText('Display name')); await user.type(dialog.getByLabelText('Display name'), '   ')
  await user.clear(dialog.getByLabelText('Current balance (EUR)')); await user.type(dialog.getByLabelText('Current balance (EUR)'), '1.234')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  expect(await dialog.findAllByRole('alert')).toHaveLength(2)
  expect(dialog.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true')
  expect(dialog.getByLabelText('Current balance (EUR)')).toHaveAttribute('aria-invalid', 'true')
  expect(fetcher.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false)
})

it.each([403, 500])('shows a clear list error and supports retry after HTTP %s', async status => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({ detail: 'No access to this workspace' }, { status }) : Response.json([manual])))
  render(<Harness />)
  expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? /permission|access/i : /server|error/i)
  expect(screen.queryByRole('list', { name: 'Accounts' })).not.toBeInTheDocument()
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('button', { name: 'View Cash details' })
})

it('shows an empty state and rejects accounts returned for another workspace', async () => {
  let rows: typeof manual[] = []
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(rows)))
  render(<Harness />)
  expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
  rows = [{ ...manual, workspace_id: 999 }]
  await userEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected account data/i)
  expect(screen.queryByText('Cash')).not.toBeInTheDocument()
})

it('closes details with Escape while details are loading', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/10') ? new Promise<Response>(() => {}) : Response.json([manual])))
  render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'View Cash details' }))
  act(() => { screen.getByRole('dialog').dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps a failed save draft when subsequent reads also fail', async () => {
  let offline = false
  const base = transport()
  vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
    if (init.method === 'PUT') offline = true
    return offline ? Response.json({ detail: 'Unavailable' }, { status: 503 }) : base(url, init)
  }))
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(await screen.findByRole('button', { name: 'View Cash details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Cash'))
  await user.clear(dialog.getByLabelText('Display name')); await user.type(dialog.getByLabelText('Display name'), 'Unsaved during outage')
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(dialog.getByLabelText('Display name')).toHaveValue('Unsaved during outage'))
  expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  expect(dialog.getAllByRole('alert').every(alert => alert.textContent?.includes('503'))).toBe(true)
})

it('adds Swedbank and Citadele as separate accounts and reloads them from the API', async () => {
  let rows: typeof manual[] = []
  const fetcher = vi.fn(async (url, init: RequestInit) => {
    expect(new Headers(init.headers).get('Workspace-ID')).toBe('42')
    expect(new Headers(init.headers).get('Authorization')).toMatch(/^Bearer /)
    if (init.method === 'POST') {
      expect(url).toBe('/api/accounts')
      const input = JSON.parse(String(init.body))
      expect(Object.keys(input).sort()).toEqual(['balance', 'currency', 'name'])
      const row = { ...manual, ...input, account_id: 20 + rows.length }
      rows = [...rows, row]
      return Response.json(row, { status: 201 })
    }
    return Response.json(rows)
  })
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  const first = render(<Harness />)
  await screen.findByText(/No accounts yet/)
  for (const [name, balance] of [['Swedbank', '1250.75'], ['Citadele', '80.00']]) {
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add account' }))
    await user.type(dialog.getByLabelText('Account name'), name)
    expect(dialog.getByLabelText('Currency')).toHaveValue('EUR')
    await user.keyboard('{Enter}')
    expect(dialog.getByLabelText('Currency')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(dialog.getByLabelText('Starting balance')).toHaveFocus()
    expect(dialog.getByLabelText('Starting balance')).toHaveValue('')
    await user.keyboard(balance)
    await user.click(dialog.getByRole('button', { name: 'Add account' }))
    await screen.findByRole('button', { name: `View ${name} details` })
  }
  first.unmount(); render(<Harness />)
  const list = within(await screen.findByRole('list', { name: 'Accounts' }))
  expect(list.getByText('Swedbank')).toBeInTheDocument()
  expect(list.getByText('Citadele')).toBeInTheDocument()
  expect(list.getByText('€1,250.75')).toBeInTheDocument()
  expect(list.getByText('€80.00')).toBeInTheDocument()
})

it('preserves a new account draft after failure and blocks duplicate creates', async () => {
  let finish: (response: Response) => void = () => {}
  const fetcher = vi.fn(async (_url, init: RequestInit) => init.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve }) : Response.json([]))
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  await screen.findByText(/No accounts yet/)
  await user.click(screen.getByRole('button', { name: 'Add account' }))
  const dialog = within(screen.getByRole('dialog'))
  await user.type(dialog.getByLabelText('Account name'), 'Swedbank')
  await user.type(dialog.getByLabelText('Starting balance'), '0.00')
  await user.dblClick(dialog.getByRole('button', { name: 'Add account' }))
  expect(dialog.getByRole('button', { name: /Adding/ })).toBeDisabled()
  expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  await act(async () => finish(Response.json({ detail: 'Account name is already taken in this workspace' }, { status: 409 })))
  expect(await dialog.findByRole('alert')).toHaveTextContent('already taken')
  expect(dialog.getByLabelText('Account name')).toHaveValue('Swedbank')
  expect(dialog.getByRole('button', { name: 'Add account' })).toBeEnabled()
})

it('validates new account name, currency and starting balance without submitting', async () => {
  const fetcher = vi.fn(async () => Response.json([]))
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  await screen.findByText(/No accounts yet/)
  await user.click(screen.getByRole('button', { name: 'Add account' }))
  const dialog = within(screen.getByRole('dialog'))
  await user.clear(dialog.getByLabelText('Currency')); await user.type(dialog.getByLabelText('Currency'), 'EU')
  await user.clear(dialog.getByLabelText('Starting balance')); await user.type(dialog.getByLabelText('Starting balance'), '1.234')
  await user.click(dialog.getByRole('button', { name: 'Add account' }))
  expect(await dialog.findAllByRole('alert')).toHaveLength(3)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('hides account creation when the workspace membership cannot create accounts', async () => {
  vi.stubGlobal('fetch', transport())
  render(<AccountManager workspaceId={42} canCreate={false} />)
  await screen.findByRole('list', { name: 'Accounts' })
  expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Make .* main account/ })).not.toBeInTheDocument()
})

it('lets the user set one main account and remembers it on reopening Accounts', async () => {
  vi.stubGlobal('fetch', transport())
  const { unmount } = render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'Make Cash main account' }))
  expect(within(screen.getByRole('list', { name: 'Accounts' })).getByText('Main account')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Make Revolut main account' }))
  expect(screen.getByRole('button', { name: 'Make Cash main account' })).toBeInTheDocument()
  unmount()
  render(<Harness />)
  const list = within(await screen.findByRole('list', { name: 'Accounts' }))
  const mainCard = list.getByText('Main account').closest('li')!
  expect(within(mainCard).getByRole('heading', { name: 'Revolut' })).toBeInTheDocument()
})


it('protects real bank balances and distinguishes Enable Banking from the sandbox', async () => {
  const realBank = { ...manual, banking_connection_id: 8, name: 'Personal Revolut' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/accounts') ? [realBank] : realBank)))
  render(<Harness />)
  expect(await screen.findByText('Revolut · Enable Banking')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'View Personal Revolut details' }))
  const dialog = within(screen.getByRole('dialog'))
  await waitFor(() => expect(dialog.getByLabelText('Current balance (EUR)')).toHaveAttribute('readonly'))
  expect(dialog.getByText(/bank manages this balance/i)).toBeInTheDocument()
  await userEvent.clear(dialog.getByLabelText('Display name'))
  await userEvent.type(dialog.getByLabelText('Display name'), 'My real bank')
  await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
  const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')!
  expect(JSON.parse(String(put[1]?.body))).toEqual({ name: 'My real bank' })
})
