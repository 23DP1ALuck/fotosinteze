import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CategoryManager } from './CategoryManager'
import type { Category } from './types'

function Harness({ initial = [] }: { initial?: Category[] }) {
  const [categories, setCategories] = useState(initial)
  return <CategoryManager categories={categories} onChange={setCategories} />
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() { this.setAttribute('open', '') },
  })
})
afterEach(cleanup)

describe('category management', () => {
  it.each(['Personal', 'Business'])('creates, edits and deletes a hierarchy in %s without refreshing', async (workspace) => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: workspace }))
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    let dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), 'Food')
    await user.click(dialog.getByRole('button', { name: 'Create category' }))
    expect(screen.getByRole('group', { name: 'Category Food' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add subcategory to Food' }))
    dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), 'Groceries')
    await user.click(dialog.getByRole('button', { name: 'Create subcategory' }))
    expect(within(screen.getByRole('list', { name: 'Subcategories of Food' })).getByText('Groceries')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Groceries' }))
    dialog = within(screen.getByRole('dialog'))
    await user.clear(dialog.getByLabelText('Name'))
    await user.type(dialog.getByLabelText('Name'), 'Weekly groceries')
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(screen.getByText('Weekly groceries')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Food' }))
    dialog = within(screen.getByRole('dialog'))
    await user.clear(dialog.getByLabelText('Name'))
    await user.type(dialog.getByLabelText('Name'), 'Food & drinks')
    await user.selectOptions(dialog.getByLabelText('Type'), 'income')
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('list', { name: 'Subcategories of Food & drinks' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly groceries' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Type: Income')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Delete Food & drinks' }))
    dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: 'Delete category' })).toBeDisabled()
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete Weekly groceries' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete subcategory' }))
    expect(screen.queryByText('Weekly groceries')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Food & drinks' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete category' }))
    expect(screen.getByText('No categories yet')).toBeInTheDocument()
  })

  it('keeps workspace data separate and rejects duplicate sibling names', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ id: '1', name: 'Food', type: 'expense', parentId: null, workspace: 'personal' }]} />)
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    let dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), '  food  ')
    await user.click(dialog.getByRole('button', { name: 'Create category' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('already exists')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Business' }))
    expect(screen.queryByRole('group', { name: 'Category Food' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), 'Food')
    await user.click(dialog.getByRole('button', { name: 'Create category' }))
    await user.click(screen.getByRole('button', { name: 'Edit Food' }))
    dialog = within(screen.getByRole('dialog'))
    await user.clear(dialog.getByLabelText('Name'))
    await user.type(dialog.getByLabelText('Name'), 'Business food')
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('button', { name: 'Personal' }))
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.queryByText('Business food')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Business' }))
    expect(screen.getByText('Business food')).toBeInTheDocument()
  })

  it('validates blank names and cancels creation without changing the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Create category' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), '   ')
    await user.click(dialog.getByRole('button', { name: 'Create category' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Name is required')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('No categories yet')).toBeInTheDocument()
  })
})
