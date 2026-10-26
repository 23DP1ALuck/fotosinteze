import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { ChartTransactionsDialog } from './ChartTransactionsDialog'
import { dashboardChartRange, type ChartSelection } from './chart-details'
const base = { transaction_id: 1, workspace_id: 7, amount: '25.50', currency: 'EUR', description: 'Travel card', source: 'BANK', account_id: 12, category_id: 1, department_id: 8, project_id: null, expense_id: null, created_at: '2026-10-03T12:00:00', updated_at: '2026-10-03T12:00:00' }
const selection: ChartSelection = { type: 'EXPENSE', range: { from: '2026-10-01', to: '2026-10-31' }, currency: 'EUR', amount: 120 }
beforeEach(() => {
  localStorage.clear()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Date.now()/1000+3600 }))}.s`)
  setWorkspace(1, 7)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })

it('keeps combined-category drill-downs scoped while paging and excludes other currencies', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const offset = Number(url.searchParams.get('offset'))
    expect(url.searchParams.get('category_id')).toBeNull()
    expect(url.searchParams.get('type')).toBe('EXPENSE')
    expect(url.searchParams.get('date_to')).toBe('2026-10-31')
    expect(new Headers(init?.headers).get('Workspace-ID')).toBe('7')
    return Response.json({ items: offset === 0 ? [base] : [{ ...base, transaction_id: 2, category_id: 2 }, { ...base, transaction_id: 3, category_id: 3, description: 'Museum tickets' }, { ...base, transaction_id: 4, category_id: 2, currency: 'GBP', description: 'Foreign currency expense' }], limit: 50, offset, has_more: offset === 0 })
  }))
  render(<ChartTransactionsDialog workspaceId={7} selection={{ ...selection, group: { dimension: 'category', ids: [2, 3], name: 'Other categories' } }} onClose={() => {}} />)
  expect(await screen.findByText('No matching transactions on this page.')).toBeInTheDocument()
  expect(screen.queryByText('Travel card')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load more transactions' }))
  expect(await screen.findByText('Travel card')).toBeInTheDocument()
  expect(screen.getByText('Museum tickets')).toBeInTheDocument()
  expect(screen.getAllByText('−€25.50')).toHaveLength(2)
  expect(screen.queryByText('Foreign currency expense')).not.toBeInTheDocument()
  expect(screen.getByText('€120.00')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Travel card/ }))
  expect(screen.getByText('#12')).toBeInTheDocument()
})

it('shows only unassigned department expenses without inventing a null API filter', async () => {
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = new URL(String(input), 'http://localhost')
    expect(url.searchParams.get('department_id')).toBeNull()
    return Response.json({ items: [base, { ...base, transaction_id: 2, description: 'Unassigned supplies', department_id: null }], limit: 50, offset: 0, has_more: false })
  }))
  render(<ChartTransactionsDialog workspaceId={7} selection={{ ...selection, group: { dimension: 'department', ids: [null], name: 'Unassigned' } }} onClose={() => {}} />)
  expect(await screen.findByText('Unassigned supplies')).toBeInTheDocument()
  expect(screen.queryByText('Travel card')).not.toBeInTheDocument()
})

it('retries a failed page without losing already loaded transactions', async () => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async input => {
    const offset = Number(new URL(String(input), 'http://localhost').searchParams.get('offset'))
    if (offset && fail) return Response.json({ detail: 'Unavailable' }, { status: 503 })
    return Response.json({ items: [{ ...base, transaction_id: offset ? 2 : 1, description: offset ? 'Second transaction' : 'First transaction' }], limit: 50, offset, has_more: offset === 0 })
  }))
  render(<ChartTransactionsDialog workspaceId={7} selection={selection} onClose={() => {}} />)
  await screen.findByText('First transaction')
  await userEvent.click(screen.getByRole('button', { name: 'Load more transactions' }))
  const alert = await screen.findByRole('alert')
  expect(screen.getByText('First transaction')).toBeInTheDocument()
  fail = false
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry transactions' }))
  expect(await screen.findByText('Second transaction')).toBeInTheDocument()
  expect(screen.getByText('First transaction')).toBeInTheDocument()
})

it('converts dashboard exclusive end dates to inclusive dates across month boundaries', () => {
  expect(dashboardChartRange('2024-02-01', '2024-03-01')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
})
