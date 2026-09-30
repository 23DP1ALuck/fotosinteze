import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { loginUser, registerUser } from '@/features/auth/api'
import { decodeJwtPayload, isTokenExpired } from '@/features/auth/jwt'
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  persistSession,
} from '@/features/auth/storage'
import type { AuthUser } from '@/features/auth/types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (
    displayName: string,
    email: string,
    password: string,
  ) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function userFromToken(token: string, fallback?: AuthUser | null): AuthUser | null {
  const payload = decodeJwtPayload(token)
  if (!payload?.sub || !payload.email) {
    return fallback ?? null
  }

  const id = Number.parseInt(payload.sub, 10)
  if (Number.isNaN(id)) {
    return fallback ?? null
  }

  return {
    id,
    email: payload.email,
    displayName: fallback?.displayName ?? payload.email.split('@')[0] ?? 'User',
  }
}

function restoreSession(): { token: string; user: AuthUser } | null {
  const token = getStoredToken()
  if (!token || isTokenExpired(token)) {
    clearSession()
    return null
  }

  const storedUser = getStoredUser()
  const user = userFromToken(token, storedUser)
  if (!user) {
    clearSession()
    return null
  }

  persistSession(token, user)
  return { token, user }
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const session = restoreSession()
    if (session) {
      setUser(session.user)
      setToken(session.token)
      setStatus('authenticated')
    } else {
      setStatus('unauthenticated')
    }
  }, [])

  const applySession = useCallback((accessToken: string, nextUser: AuthUser) => {
    persistSession(accessToken, nextUser)
    setToken(accessToken)
    setUser(nextUser)
    setStatus('authenticated')
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await loginUser({ email, password })
      const storedUser = getStoredUser()
      const nextUser =
        storedUser?.email === email
          ? storedUser
          : userFromToken(access_token) ?? {
              id: 0,
              email,
              displayName: email.split('@')[0] ?? 'User',
            }
      applySession(access_token, nextUser)
    },
    [applySession],
  )

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      const created = await registerUser({
        email,
        display_name: displayName,
        password,
      })
      const { access_token } = await loginUser({ email, password })
      applySession(access_token, {
        id: created.id,
        email: created.email,
        displayName: created.display_name,
      })
    },
    [applySession],
  )

  const logout = useCallback(() => {
    clearSession()
    setToken(null)
    setUser(null)
    setStatus('unauthenticated')
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

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export { AuthProvider, useAuth }
