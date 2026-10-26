import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { DeleteTransactionDialog } from './DeleteTransactionDialog'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('prevents deletion if a bank transaction reaches the confirmation dialog', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<DeleteTransactionDialog workspaceId={7} transaction={{
    transaction_id: 21, workspace_id: 7, amount: '25.50', currency: 'EUR', description: 'Bank purchase', source: 'BANK',
    account_id: 12, category_id: 4, department_id: null, project_id: null, expense_id: null,
    created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00',
  }} onClose={() => {}} onDeleted={() => {}} />)
  const remove = screen.getByRole('button', { name: 'Delete transaction' })
  expect(remove).toBeDisabled()
  fireEvent.click(remove)
  expect(fetcher).not.toHaveBeenCalled()
})
