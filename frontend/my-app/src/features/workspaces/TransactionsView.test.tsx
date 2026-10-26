import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { TransactionsView } from './TransactionsView'

const transactions = [
  { id: 1, name: 'First', category: 'Travel', source: 'Manual', date: '2026-10-16', amount: -10 },
  { id: 2, name: 'Boundary', category: 'Travel', source: 'Revolut', date: '2026-10-17', amount: -20 },
  { id: 3, name: 'Last', category: 'Travel', source: 'Manual', date: '2026-10-18', amount: -30 },
]
afterEach(cleanup)

it('filters dates inclusively, supports open ranges, and clears the selection', async () => {
  const user = userEvent.setup()
  render(<TransactionsView transactions={transactions} income={0} expenses={60} workspaceName="Personal" workspaceKind="personal" />)
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-17' } })
  await user.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(screen.queryByText('First')).not.toBeInTheDocument()
  expect(screen.getByText('Last')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-17' } })
  await user.click(screen.getByRole('button', { name: 'Apply dates' }))
  expect(screen.getByText('Boundary')).toBeInTheDocument()
  expect(screen.queryByText('Last')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getAllByRole('row')).toHaveLength(4)
  expect(screen.getByLabelText('From date')).toHaveValue('')
})

it('prevents an inverted date range from being sent to the server', async () => {
  const onFilterChange = vi.fn()
  render(<TransactionsView transactions={[]} income={0} expenses={0} workspaceName="Business" onFilterChange={onFilterChange} />)
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-18' } })
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-17' } })
  expect(screen.getByRole('alert')).toHaveTextContent('From date must be on or before to date.')
  expect(screen.getByRole('button', { name: 'Apply dates' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Filter by date range' }))
  expect(onFilterChange).not.toHaveBeenCalled()
})

it('debounces search and cancels a pending search when filters are cleared', async () => {
  const user = userEvent.setup()
  const onFilterChange = vi.fn()
  render(<TransactionsView transactions={[]} income={0} expenses={0} workspaceName="Business" onFilterChange={onFilterChange} />)
  await user.type(screen.getByRole('searchbox'), ' train ')
  expect(onFilterChange).not.toHaveBeenCalled()
  await waitFor(() => expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({ search: 'train' }))
  await user.type(screen.getByRole('searchbox'), 'ticket')
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  const calls = onFilterChange.mock.calls.length
  await new Promise(resolve => setTimeout(resolve, 350))
  expect(onFilterChange).toHaveBeenCalledTimes(calls)
  expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, date_from: undefined, date_to: undefined }))
})

it.each([false, true])('restricts sources to the workspace with server filtering=%s', async serverFiltering => {
  const user = userEvent.setup()
  const onFilterChange = serverFiltering ? vi.fn() : undefined
  const props = { transactions: [], income: 0, expenses: 0, workspaceName: 'Workspace', onFilterChange }
  const view = render(<TransactionsView {...props} workspaceKind="personal" />)
  const personalSource = screen.getByRole('combobox', { name: 'Filter by source' })
  expect(within(personalSource).getAllByRole('option').map(option => option.textContent)).toEqual(['All sources', 'Manual', 'Revolut'])
  expect(screen.queryByRole('combobox', { name: 'Filter by department' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Filter by project' })).not.toBeInTheDocument()
  // EXPENSE is also a valid category type in Personal Workspace, independently of source.
  await user.click(screen.getByRole('button', { name: 'Expenses' }))
  if (onFilterChange) expect(onFilterChange).toHaveBeenLastCalledWith({ type: 'EXPENSE' })
  view.rerender(<TransactionsView key="business" {...props} workspaceKind="business" />)
  const businessSource = screen.getByRole('combobox', { name: 'Filter by source' })
  expect(within(businessSource).getAllByRole('option').map(option => option.textContent)).toEqual(['All sources', 'Manual', 'Revolut', 'Expense'])
  await user.selectOptions(businessSource, 'Expense')
  if (onFilterChange) expect(onFilterChange).toHaveBeenLastCalledWith({ source: 'EXPENSE' })
})


it('allows editing bank categorization but hides bank deletion', async () => {
  const edit = vi.fn()
  const remove = vi.fn()
  render(<TransactionsView transactions={transactions} income={0} expenses={60} workspaceName="Personal" workspaceKind="personal" onEdit={edit} onDelete={remove} />)
  expect(screen.queryByRole('button', { name: 'Delete Boundary' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Edit Boundary' }))
  expect(edit).toHaveBeenCalledWith(2)
  await userEvent.click(screen.getByRole('button', { name: 'Delete First' }))
  expect(remove).toHaveBeenCalledWith(1)
})
