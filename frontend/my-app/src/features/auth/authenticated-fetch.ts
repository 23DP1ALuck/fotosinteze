import { decodeJwtPayload, isTokenExpired } from '@/features/auth/jwt'
import { clearSession, getAccessToken, setAccessToken } from '@/features/auth/storage'

import { API_URL, refreshAccessToken } from './api'
import { activeWorkspaceId } from '@/features/workspaces/workspace-state'

async function renewAccessToken(): Promise<string | null> {
  const previousToken = getAccessToken()
  try {
    const { access_token } = await refreshAccessToken()
    // Do not overwrite a logout, login, or another refresh that happened in flight.
    const current = getAccessToken()
    if (current !== previousToken) {
      // Another request may have completed the same refresh already.
      return current && previousToken && !isTokenExpired(current) && decodeJwtPayload(current)?.sub === decodeJwtPayload(previousToken)?.sub ? current : null
    }
    if (previousToken && decodeJwtPayload(previousToken)?.sub !== decodeJwtPayload(access_token)?.sub) {
      clearSession()
      return null
    }
    setAccessToken(access_token)
    return access_token
  } catch {
    if (getAccessToken() === previousToken) clearSession()
    return null
  }
}

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
  scope: { workspaceId?: number } = {},
): Promise<Response> {
  // Capture once: switching while refresh is pending must not retarget this request.
  const requestedWorkspaceId = scope.workspaceId ?? activeWorkspaceId()
  let token = getAccessToken()
  if (token && isTokenExpired(token)) {
    token = await renewAccessToken()
    if (!token) return new Response(null, { status: 401 })
  }
  const headers = new Headers(init.headers)
  const scoped = /^\/(business-budgets|expenses|accounts|transactions|categories|budgets|dashboards?|statistics|projects|departments|revolut)(\/|\?|$)/.test(path)
  if (scoped) {
    const id = requestedWorkspaceId
    if (id === null || !Number.isSafeInteger(id) || id < 1) throw new Error('Select an accessible workspace before making this request.')
    headers.set('X-Workspace-ID', String(id))
    // Compatibility with the current FastAPI header alias.
    headers.set('Workspace-ID', String(id))
  } else {
    headers.delete('X-Workspace-ID')
    headers.delete('Workspace-ID')
  }

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
  if (!currentToken || decodeJwtPayload(currentToken)?.sub !== decodeJwtPayload(token)?.sub) return response
  const replacement = currentToken && currentToken !== token && !isTokenExpired(currentToken)
    ? currentToken
    : await renewAccessToken()
  if (!replacement) return response

  headers.set('Authorization', `Bearer ${replacement}`)
  return fetch(`${API_URL}${path}`, { ...init, headers })
}
