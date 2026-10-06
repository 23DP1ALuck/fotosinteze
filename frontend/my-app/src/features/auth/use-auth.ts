import { createContext, useContext } from 'react'

import type { AuthUser } from '@/features/auth/types'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export type AuthContextValue = {
  status: AuthStatus
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (
    displayName: string,
    email: string,
    password: string,
  ) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
