import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { PersonalBudgetSummary } from './PersonalBudgetSummary'
const budget = { budget_id: 1, workspace_id: 7, category_id: 4, name: 'Groceries', limit_amount: '350', currency: 'EUR', current_spent: '150', period_start: '2026-10-01', period_length: 'MONTHLY', duration_days: null }
let rows = [budget]
beforeEach(() => {
  localStorage.clear()
  setAccessToken(`h.${btoa(JSON.stringify({ sub: '1', exp: Date.now()/1000+3600 }))}.s`)
  setWorkspace(1, 7)
  rows = [budget]
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  vi.stubGlobal('fetch', vi.fn(async input => Response.json(String(input).endsWith('/budgets') ? rows : [{ category_id: 4, workspace_id: 7, name: 'Food', type: 'EXPENSE' }])))
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })

it('keeps many budgets compact and puts overspent and near-limit plans first', async () => {
  rows = [budget,
    { ...budget, budget_id: 2, name: 'General', limit_amount: '1000', current_spent: '460' },
    { ...budget, budget_id: 3, name: 'Another plan', limit_amount: '1000', current_spent: '460' },
    { ...budget, budget_id: 4, name: 'Travel', limit_amount: '66', current_spent: '310' },
    { ...budget, budget_id: 5, name: 'Dining', limit_amount: '100', current_spent: '85' },
    { ...budget, budget_id: 6, name: 'Shopping', limit_amount: '100', current_spent: '70' },
  ]
  const manage = vi.fn()
  render(<PersonalBudgetSummary workspaceId={7} onManage={manage} />)
  await screen.findByText('2 plans need attention')
  const cards = screen.getAllByRole('article')
  expect(cards).toHaveLength(3)
  expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['Budget Travel', 'Budget Dining', 'Budget Shopping'])
  expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  expect(screen.getByText('3 of 6 plans · priority first')).toBeInTheDocument()
  const travel = within(cards[0])
  expect(travel.getByText('€244.00 over')).toBeInTheDocument()
  expect(travel.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '470% used. €310.00 spent of €66.00.')
  await userEvent.click(screen.getByRole('button', { name: 'Manage budgets' }))
  expect(manage).toHaveBeenCalledOnce()
})

it('keeps dates and full amounts in an on-demand drawer instead of every dashboard row', async () => {
  render(<PersonalBudgetSummary workspaceId={7} onManage={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: 'View Groceries budget details' }))
  const details = within(screen.getByRole('dialog', { name: 'Budget details' }))
  expect(details.getByText('€150.00')).toBeInTheDocument()
  expect(details.getByText('€350.00')).toBeInTheDocument()
  expect(details.getByText('1 Oct 2026 – 31 Oct 2026')).toBeInTheDocument()
  expect(details.getByText('Food')).toBeInTheDocument()
  await userEvent.click(details.getByRole('button', { name: 'Close budget details' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText(/2026/)).not.toBeInTheDocument()
  expect(screen.getByText('All plans on track')).toBeInTheDocument()
})

it('offers a useful empty state without showing fake progress', async () => {
  rows = []
  const manage = vi.fn()
  render(<PersonalBudgetSummary workspaceId={7} onManage={manage} />)
  await screen.findByText('Give your money a plan.')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Manage budgets' }))
  expect(manage).toHaveBeenCalledOnce()
})
