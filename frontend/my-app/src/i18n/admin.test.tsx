import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n, { setLanguage } from './index'
import { CreateBusinessDialog } from '@/features/workspaces/WorkspaceControls'
import { WorkspaceNavigation } from '@/features/workspaces/WorkspaceNavigation'
import { TransactionsView } from '@/features/workspaces/TransactionsView'
import { useAdminTranslation } from './use-admin-translation'

beforeEach(() => Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } }))

afterEach(async () => { cleanup(); await i18n.changeLanguage('en') })

it('translates an open workspace form and existing validation without clearing input', async () => {
  const user = userEvent.setup()
  render(<CreateBusinessDialog workspaces={[]} onCreate={vi.fn()} onClose={vi.fn()} />)
  await user.type(screen.getByLabelText('Workspace name'), 'Acme')
  await user.clear(screen.getByLabelText('Base currency'))
  await user.click(screen.getByRole('button', { name: 'Create business workspace' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a three-letter currency code')
  await act(() => setLanguage('lv'))
  expect(screen.getByLabelText('Darbvietas nosaukums')).toHaveValue('Acme')
  expect(screen.getByRole('alert')).toHaveTextContent('Ievadiet trīs burtu valūtas kodu')
  await act(() => setLanguage('ru'))
  expect(screen.getByLabelText('Название пространства')).toHaveValue('Acme')
  expect(screen.getByRole('alert')).toHaveTextContent('Введите трёхбуквенный код валюты')
})

it('keeps canonical navigation identifiers when translating labels', async () => {
  const select = vi.fn()
  render(<WorkspaceNavigation items={['Dashboard', 'Departments']} activeItem="Dashboard" onSelect={select} />)
  await act(() => setLanguage('ru'))
  expect(screen.getByRole('button', { name: 'Обзор' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(screen.getByRole('button', { name: 'Отделы' }))
  expect(select).toHaveBeenCalledWith('Departments')
})

it('translates transaction filters while preserving canonical API enum values and user data', async () => {
  const change = vi.fn()
  render(<TransactionsView transactions={[{ id: 1, name: 'Income', category: 'Travel', source: 'Manual', date: '2026-10-01', amount: 20, currency: 'EUR', type: 'income' }]} income={20} expenses={0} workspaceName="Acme" onFilterChange={change} />)
  await act(() => setLanguage('lv'))
  expect(screen.getByRole('table')).toHaveTextContent('Income')
  expect(screen.getByRole('table')).toHaveTextContent(new Intl.DateTimeFormat('lv-LV', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date('2026-10-01T12:00:00')))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtrēt pēc avota' }), 'Manual')
  expect(change).toHaveBeenLastCalledWith({ source: 'MANUAL' })
  await userEvent.click(screen.getByRole('button', { name: 'Ienākumi' }))
  expect(change).toHaveBeenLastCalledWith({ type: 'INCOME' })
  await act(() => setLanguage('ru'))
  expect(screen.getByRole('button', { name: 'Доход' })).toHaveAttribute('aria-pressed', 'true')
})

function Message({ message, count = 0 }: { message: string; count?: number }) {
  const { tr, trError } = useAdminTranslation()
  return <><p role="alert">{trError(message)}</p><p role="status">{tr('{{count}} transactions', { count })}</p></>
}
it('localizes known errors, hides unknown details and uses real count plural forms', async () => {
  const view = render(<Message message="Department name is already taken in this workspace" count={1} />)
  await act(() => setLanguage('lv'))
  expect(screen.getByRole('alert')).toHaveTextContent('Šāds nodaļas nosaukums')
  expect(screen.getByRole('status')).toHaveTextContent('1 darījums')
  view.rerender(<Message message="private SQL error" count={0} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Radās kļūda')
  expect(screen.getByRole('alert')).not.toHaveTextContent('SQL')
  expect(screen.getByRole('status')).toHaveTextContent('0 darījumu')
  await act(() => setLanguage('ru'))
  view.rerender(<Message message="The server returned an error (HTTP 500). Please check the backend logs." count={2} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Сервер вернул ошибку (HTTP 500)')
  expect(screen.getByRole('status')).toHaveTextContent('2 транзакции')
  view.rerender(<Message message="Try again" count={5} />)
  expect(screen.getByRole('status')).toHaveTextContent('5 транзакций')
})
