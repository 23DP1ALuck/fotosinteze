import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranslation } from 'react-i18next'
import { afterEach, beforeEach, expect, it } from 'vitest'
import i18n from './index'
import { financeMessage } from './finance-message'
import { adminKeys } from './admin'
import { TransactionsView } from '@/features/workspaces/TransactionsView'

beforeEach(() => Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } }))
afterEach(cleanup)
function GeneratedTransactions() {
  useTranslation('finance')
  return <TransactionsView transactions={[{ id: 1, name: financeMessage('Income'), category: 'My category', source: 'Manual', date: '2026-10-01', amount: 20, type: 'income', currency: 'EUR' }]} income={20} expenses={0} workspaceName="Acme" workspaceKind="personal" />
}
it('updates generated display values inside an open transaction detail dialog when switching languages', async () => {
  await i18n.changeLanguage('lv')
  render(<GeneratedTransactions />)
  const name = financeMessage('Income')
  await userEvent.click(screen.getByRole('button', { name: i18n.t(adminKeys['View {{name}} details'], { ns: 'admin', name }) }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(financeMessage('Manual'))).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Русский' }))
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(within(dialog).getByText(financeMessage('Manual'))).toBeInTheDocument()
  expect(within(dialog).queryByText('Ienākumi')).not.toBeInTheDocument()
})
