import { render } from '@/test/render'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { BusinessBudgets } from './BusinessBudgets'
import { setAccessToken, clearSession } from '@/features/auth/storage'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })

it('persists personal budget creation, edits and deletion across remounts and scopes every request', async () => {
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`)
  type Row = Record<string, unknown>
  const rows = new Map<number, Row[]>()
  const transport = vi.fn(async (url, init) => {
    const workspace = Number(new Headers(init?.headers).get('X-Workspace-ID'))
    const path = new URL(String(url), 'http://localhost').pathname
    const list = rows.get(workspace) ?? []
    if (path.endsWith('/categories')) return Response.json([{ category_id: 4, workspace_id: workspace, name: 'Groceries', type: 'EXPENSE' }])
    if (init?.method === 'DELETE') { rows.set(workspace, []); return new Response(null, { status: 204 }) }
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const row = { ...JSON.parse(String(init.body)), budget_id: 1, workspace_id: workspace, current_spent: '28.54' }
      rows.set(workspace, [row]); return Response.json(row)
    }
    return Response.json(list)
  })
  vi.stubGlobal('fetch', transport)
  const user = userEvent.setup()
  const mount = (id = 7) => render(<BusinessBudgets personal workspaceId={id} onConnect={() => {}} />)
  let view = mount()
  await user.click(await screen.findByRole('button', { name: 'Create budget' }))
  let form = within(screen.getByRole('form', { name: 'Create personal budget' }))
  expect(form.queryByLabelText('Target type')).not.toBeInTheDocument()
  await user.type(form.getByLabelText('Budget name'), 'QA Ceļojums')
  await user.type(form.getByLabelText('Limit'), '400')
  await user.selectOptions(form.getByLabelText('Category'), '4')
  await user.selectOptions(form.getByLabelText('Period'), 'CUSTOM')
  await user.clear(form.getByLabelText('Duration (days)'))
  await user.type(form.getByLabelText('Duration (days)'), '10')
  await user.click(form.getByRole('button', { name: 'Save budget' }))
  expect(await screen.findByRole('article', { name: 'Budget QA Ceļojums' })).toHaveTextContent('€400.00')
  expect(rows.get(7)?.[0]).toMatchObject({ category_id: 4, duration_days: 10, period_length: 'CUSTOM', currency: 'EUR' })
  view.unmount()
  clearSession()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + 7200 }))}.s`)
  view = mount()
  await user.click(await screen.findByRole('button', { name: 'Edit QA Ceļojums' }))
  form = within(screen.getByRole('form', { name: 'Edit personal budget' }))
  expect(form.getByLabelText('Duration (days)')).toHaveValue(10)
  await user.clear(form.getByLabelText('Limit')); await user.type(form.getByLabelText('Limit'), '450')
  await user.selectOptions(form.getByLabelText('Period'), 'WEEKLY')
  await user.click(form.getByRole('button', { name: 'Save budget' }))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  view.unmount(); view = mount(8)
  await screen.findByText('No budgets available for this workspace.')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  view.unmount(); view = mount()
  expect(await screen.findByRole('article', { name: 'Budget QA Ceļojums' })).toHaveTextContent('€450.00')
  expect(screen.getByRole('article')).toHaveTextContent('Weekly')
  await user.click(screen.getByRole('button', { name: 'Delete QA Ceļojums' }))
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  await screen.findByText('No budgets available for this workspace.')
  view.unmount(); mount()
  await screen.findByText('No budgets available for this workspace.')
  expect(transport.mock.calls.every(([, init]) => new Headers(init?.headers).has('Authorization'))).toBe(true)
})
