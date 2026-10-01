import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GuestRoute, ProtectedRoute } from '@/components/auth/AuthGate'
import { AuthProvider } from '@/features/auth/auth-context'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { clearSession, getAccessToken, setAccessToken } from '@/features/auth/storage'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'

function tokenFor(email: string, displayName = 'A User', expiresInSeconds = 900) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    sub: '42',
    email,
    display_name: displayName,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  }))
  return `${header}.${payload}.signature`
}

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HomePage />} />
          </Route>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('browser auth session', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSession()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('restores an access token through the refresh cookie without using local storage', async () => {
    const accessToken = tokenFor('math@example.com', 'Ada Lovelace')
    localStorage.setItem('fm_access_token', 'stale-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: accessToken }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderAt('/')

    expect(await screen.findByText(/welcome back, ada lovelace/i)).toBeInTheDocument()
    expect(screen.getByText(/math@example.com/)).toBeInTheDocument()
    expect(localStorage.getItem('fm_access_token')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/auth/refresh',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )

    await authenticatedFetch('/protected')
    expect(fetchMock.mock.lastCall?.[0]).toBe('http://localhost:8000/protected')
    expect(fetchMock.mock.lastCall?.[1].headers.get('Authorization')).toBe(
      `Bearer ${accessToken}`,
    )
  })

  it('calls logout with the cookie, clears memory, and returns to login', async () => {
    const accessToken = tokenFor('user@example.com')
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return { ok: false, status: 401, json: async () => ({ detail: 'Invalid session' }) }
      }
      if (url.endsWith('/auth/login')) {
        return { ok: true, status: 200, json: async () => ({ access_token: accessToken }) }
      }
      return { ok: true, status: 200, json: async () => ({ detail: 'Successfully logged out' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderAt('/login')
    await user.type(await screen.findByLabelText(/email address/i), 'user@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password123')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    const logoutButton = await screen.findByRole('button', { name: 'Log out' })
    expect(localStorage.getItem('fm_access_token')).toBeNull()
    await user.click(logoutButton)

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    await authenticatedFetch('/protected')
    await waitFor(() => {
      const call = fetchMock.mock.lastCall
      expect(call?.[1]?.headers?.get?.('Authorization')).toBeNull()
    })
    expect(localStorage.getItem('fm_access_token')).toBeNull()
    expect(localStorage.getItem('fm_user')).toBeNull()
  })

  it('refreshes an expired access token before a protected request', async () => {
    const freshToken = tokenFor('math@example.com', 'Ada Lovelace')
    setAccessToken(tokenFor('math@example.com', 'Ada Lovelace', -1))
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return { ok: true, status: 200, json: async () => ({ access_token: freshToken }) }
      }
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await authenticatedFetch('/protected')

    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8000/auth/refresh',
      'http://localhost:8000/protected',
    ])
    expect(fetchMock.mock.lastCall?.[1].headers.get('Authorization')).toBe(
      `Bearer ${freshToken}`,
    )
    expect(getAccessToken()).toBe(freshToken)
  })

  it('retries once with a refreshed token after a protected request returns 401', async () => {
    const oldToken = tokenFor('math@example.com', 'Ada Lovelace')
    const freshToken = tokenFor('math@example.com', 'Ada Lovelace', 1200)
    setAccessToken(oldToken)
    let protectedCalls = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return { ok: true, status: 200, json: async () => ({ access_token: freshToken }) }
      }
      protectedCalls += 1
      return { ok: protectedCalls > 1, status: protectedCalls > 1 ? 200 : 401 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await authenticatedFetch('/protected')

    expect(response.status).toBe(200)
    expect(protectedCalls).toBe(2)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1)
    expect(fetchMock.mock.lastCall?.[1].headers.get('Authorization')).toBe(
      `Bearer ${freshToken}`,
    )
  })

  it('returns to login when a protected request and refresh are both unauthorized', async () => {
    const accessToken = tokenFor('math@example.com', 'Ada Lovelace')
    let refreshCalls = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1
        return refreshCalls === 1
          ? { ok: true, status: 200, json: async () => ({ access_token: accessToken }) }
          : { ok: false, status: 401, json: async () => ({ detail: 'Invalid session' }) }
      }
      return { ok: false, status: 401 }
    })
    vi.stubGlobal('fetch', fetchMock)

    renderAt('/')
    expect(await screen.findByText(/welcome back, ada lovelace/i)).toBeInTheDocument()

    const response = await authenticatedFetch('/protected')

    expect(response.status).toBe(401)
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('renews an access token before expiry while the tab remains open', async () => {
    const nearExpiry = tokenFor('math@example.com', 'Ada Lovelace', 60)
    const renewed = tokenFor('math@example.com', 'Ada Lovelace', 900)
    let refreshCalls = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      refreshCalls += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: refreshCalls === 1 ? nearExpiry : renewed }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    renderAt('/')
    expect(await screen.findByText(/welcome back, ada lovelace/i)).toBeInTheDocument()

    await waitFor(() => expect(refreshCalls).toBe(2))
    expect(getAccessToken()).toBe(renewed)
  })
})
