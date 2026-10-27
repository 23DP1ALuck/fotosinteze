import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth/auth-context'
import LoginPage from '@/pages/LoginPage'
import { HeroPreview } from '@/components/landing/HeroPreview'
import { render } from '@/test/render'
import i18n from '@/i18n'
import { pageError } from './pages'

afterEach(cleanup)

describe('localized pages', () => {
  it('switches visible validation and password controls without losing draft values or input identity', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><MemoryRouter><LoginPage /></MemoryRouter></AuthProvider>)
    const email = screen.getByLabelText('Email address')
    const password = screen.getByLabelText('Password')
    await user.type(email, 'draft@example.com')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Password is required')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Latviešu' }))
    expect(screen.getByText('Parole ir obligāta')).toBeInTheDocument()
    expect(screen.getByLabelText('E-pasta adrese')).toBe(email)
    expect(email).toHaveValue('draft@example.com')
    expect(screen.getByLabelText('Parole')).toBe(password)
    await user.click(screen.getByRole('button', { name: 'Русский' }))
    expect(screen.getByText('Укажите пароль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать пароль' })).toBeInTheDocument()
    expect(email).toHaveValue('draft@example.com')
  })

  it('keeps the selected demo section and localizes demo amounts', async () => {
    const user = userEvent.setup()
    render(<HeroPreview />)
    await user.click(screen.getByRole('tab', { name: 'Transactions' }))
    await act(async () => { await i18n.changeLanguage('lv') })
    expect(screen.getByRole('tab', { name: 'Darījumi' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('cell', { name: 'Klienta projekts' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /8\s?400,00/ })).toBeInTheDocument()
  })

  it('uses a safe localized fallback for unrecognized server messages', async () => {
    await i18n.changeLanguage('ru')
    const t = i18n.getFixedT('ru', 'pages')
    expect(pageError('database password=secret', t)).toBe('Что-то пошло не так. Попробуйте ещё раз.')
    expect(pageError('Invalid email or password.', t)).toBe('Неверная почта или пароль.')
  })
})
