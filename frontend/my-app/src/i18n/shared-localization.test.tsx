import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { render } from '@/test/render'
import { DateInput } from '@/components/calendar/DateInput'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import i18n from './index'
import { commonMessage } from './common'
import { reviewLines, reviewMoney } from '@/features/insights/review-export'
import { normalizeDecimal } from '@/lib/decimal'

afterEach(cleanup)
it('translates every keyboard shortcut segment', async () => {
  await i18n.changeLanguage('lv')
  expect(commonMessage('Enter to continue · Ctrl/⌘+↑/↓ to switch fields · Ctrl/⌘+Enter to save')).not.toMatch(/to switch|to save|to continue/)
})
it('keeps calendar ISO values while translating an open calendar', async () => {
  const user = userEvent.setup()
  render(<DateInput aria-label="Period" defaultValue="2026-10-12" />)
  await user.click(screen.getByRole('button', { name: 'Open calendar for Period' }))
  expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument()
  await act(() => i18n.changeLanguage('ru'))
  expect(screen.getByRole('grid', { name: 'октябрь 2026' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('2026-10-12')
})
it('translates stored keyboard-form hints without clearing a draft', async () => {
  render(<KeyboardForm><input aria-label="Draft" defaultValue="keep" /><button type="submit">Save</button></KeyboardForm>)
  fireEvent.focus(screen.getByRole('textbox'))
  await act(() => i18n.changeLanguage('ru'))
  expect(screen.getByRole('status')).toHaveTextContent('Enter для продолжения')
  expect(screen.getByRole('status')).not.toHaveTextContent('to switch')
  expect(screen.getByRole('textbox')).toHaveValue('keep')
})
it('localizes export labels and values and preserves user identity and currency', async () => {
  await i18n.changeLanguage('ru')
  const data = { month: 'октябрь 2026', workspaceName: 'My Studio', currency: 'USD', income: 100, expenses: 20.5, kind: 'personal' as const }
  const lines = reviewLines(data)
  expect(lines).toContain('My Studio')
  expect(lines).toContain(`Доходы: ${reviewMoney(100, 'USD')}`)
  expect(lines.join(' ')).toContain('79,5')
  expect(data.expenses).toBe(20.5)
  expect(data.currency).toBe('USD')
})
it('normalizes an ungrouped decimal comma without guessing thousands separators', () => {
  expect(normalizeDecimal(' 12,50 ')).toBe('12.50')
  expect(normalizeDecimal('-0,25')).toBe('-0.25')
  expect(normalizeDecimal('12.50')).toBe('12.50')
  expect(normalizeDecimal('1,234.56')).toBe('1,234.56')
  expect(normalizeDecimal('1,234')).toBe('1,234')
  expect(normalizeDecimal('1 234,56')).toBe('1 234,56')
})
