import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { HeroPreview } from './HeroPreview'
afterEach(cleanup)
it('switches demo workspaces and tabs without making network requests', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  render(<HeroPreview />)
  await userEvent.click(screen.getByRole('button', { name: 'Personal demo' }))
  expect(screen.getByRole('region', { name: 'Interactive product demo' })).toHaveTextContent('€3,200.00')
  await userEvent.click(screen.getByRole('tab', { name: 'Transactions' }))
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Monthly salary')
  await userEvent.click(screen.getByRole('button', { name: 'Business demo' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Budgets' }))
  expect(within(screen.getByRole('tabpanel')).getByText('Marketing')).toBeInTheDocument()
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Monthly salary')
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRestore()
})
