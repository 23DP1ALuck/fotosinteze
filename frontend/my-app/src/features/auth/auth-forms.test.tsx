import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '@/features/auth/auth-context'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

function submitLoginButton() {
  return screen.getByRole('button', { name: 'Log in' })
}

function submitRegisterButton() {
  return screen.getByRole('button', { name: 'Create account' })
}

describe('auth forms', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows validation errors when login is submitted empty', async () => {
    const user = userEvent.setup()
    renderAt('/login')

    await user.click(submitLoginButton())

    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
  })

  it('shows a safe message when login fails on the server', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Incorrect password' }),
      }),
    )

    renderAt('/login')

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(submitLoginButton())

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Invalid email or password.')
  })

  it('registers, keeps the access token in memory, and lands on home', async () => {
    const user = userEvent.setup()
    const tokenPayload = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const tokenBody = btoa(
      JSON.stringify({
        sub: '42',
        email: 'new@example.com',
        display_name: 'New User',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
    const accessToken = `${tokenPayload}.${tokenBody}.signature`

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'Refresh token missing' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            id: 42,
            display_name: 'New User',
            email: 'new@example.com',
            created_at: '2026-01-01T00:00:00Z',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: accessToken }),
        }),
    )

    renderAt('/register')

    await user.type(screen.getByLabelText(/full name/i), 'New User')
    await user.type(screen.getByLabelText(/email address/i), 'new@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'long-enough-password')
    await user.click(submitRegisterButton())

    await waitFor(() => {
      expect(screen.getByText(/welcome back, new user/i)).toBeInTheDocument()
    })

    expect(localStorage.getItem('fm_access_token')).toBeNull()
    expect(localStorage.getItem('fm_user')).toBeNull()
  })

  it('disables submit while a login request is in flight', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: unknown) => void = () => {}
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        fetchPromise.then(() => ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token:
              'a.b.' +
              btoa(
                JSON.stringify({
                  sub: '1',
                  email: 'user@example.com',
                  display_name: 'A User',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                }),
              ),
          }),
        })),
      ),
    )

    renderAt('/login')

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(submitLoginButton())

    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled()

    resolveFetch(undefined)

    await waitFor(() => {
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    })
  })
})
