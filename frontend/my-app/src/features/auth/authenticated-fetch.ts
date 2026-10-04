import { isTokenExpired } from '@/features/auth/jwt'
import { clearSession, getAccessToken, setAccessToken } from '@/features/auth/storage'

import { API_URL, refreshAccessToken } from './api'

async function renewAccessToken(): Promise<string | null> {
  const previousToken = getAccessToken()
  try {
    const { access_token } = await refreshAccessToken()
    // Do not restore a token if logout cleared the session while refresh was in flight.
    if (previousToken && getAccessToken() === null) return null
    setAccessToken(access_token)
    return access_token
  } catch {
    clearSession()
    return null
  }
}

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = getAccessToken()
  if (token && isTokenExpired(token)) {
    token = await renewAccessToken()
    if (!token) return new Response(null, { status: 401 })
  }
  const headers = new Headers(init.headers)

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  })

  if (response.status !== 401 || !token) return response

  // A 401 may mean the access token expired between checks; retry with a fresh one once.
  const currentToken = getAccessToken()
  const replacement = currentToken && currentToken !== token && !isTokenExpired(currentToken)
    ? currentToken
    : await renewAccessToken()
  if (!replacement) return response

  headers.set('Authorization', `Bearer ${replacement}`)
  return fetch(`${API_URL}${path}`, { ...init, headers })
}
