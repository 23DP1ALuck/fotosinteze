import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { loginUser, logoutUser, refreshAccessToken, registerUser } from '@/features/auth/api'
import { decodeJwtPayload } from '@/features/auth/jwt'
import {
  clearLegacySession,
  clearSession,
  getAccessToken,
  setAccessToken,
  subscribeAccessToken,
} from '@/features/auth/storage'
import type { AuthUser } from '@/features/auth/types'
import { AuthContext, type AuthStatus } from '@/features/auth/use-auth'

function userFromToken(token: string): AuthUser | null {
  const payload = decodeJwtPayload(token)
  if (!payload?.sub || !payload.email || !payload.display_name) {
    return null
  }

  const id = Number.parseInt(payload.sub, 10)
  if (Number.isNaN(id)) {
    return null
  }

  return {
    id,
    email: payload.email,
    displayName: payload.display_name,
  }
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    clearLegacySession()

    // Keep route state in sync when a protected request refreshes or loses its token.
    const unsubscribe = subscribeAccessToken((nextToken) => {
      const nextUser = nextToken ? userFromToken(nextToken) : null
      if (nextToken && !nextUser) {
        clearSession()
        return
      }
      setToken(nextToken)
      setUser(nextUser)
      setStatus(nextUser ? 'authenticated' : 'unauthenticated')
    })

    // A page reload loses the in-memory access token; the cookie restores it through the API.
    refreshAccessToken()
      .then(({ access_token }) => {
        if (cancelled) return
        setAccessToken(access_token)
      })
      .catch(() => {
        if (cancelled) return
        clearSession()
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated' || !token) return
    const expiresAt = decodeJwtPayload(token)?.exp
    if (!expiresAt) return

    // Refresh one minute early; a suspended tab will run this when it wakes.
    const delay = Math.max(0, expiresAt * 1000 - Date.now() - 60_000)
    let cancelled = false
    const timer = window.setTimeout(() => {
      refreshAccessToken()
        .then(({ access_token }) => {
          if (!cancelled && getAccessToken() === token) setAccessToken(access_token)
        })
        .catch(() => {
          if (!cancelled && getAccessToken() === token) clearSession()
        })
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [status, token])

  const applySession = useCallback((accessToken: string) => {
    setAccessToken(accessToken)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await loginUser({ email, password })
      const nextUser = userFromToken(access_token)
      if (!nextUser) throw new Error('Login response is missing user details')
      applySession(access_token)
    },
    [applySession],
  )

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      await registerUser({
        email,
        display_name: displayName,
        password,
      })
      const { access_token } = await loginUser({ email, password })
      const nextUser = userFromToken(access_token)
      if (!nextUser) throw new Error('Login response is missing user details')
      applySession(access_token)
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    // Keep the current session visible if revocation fails, so logout can be retried.
    await logoutUser()
    clearSession()
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      token,
      login,
      register,
      logout,
    }),
    [status, user, token, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
