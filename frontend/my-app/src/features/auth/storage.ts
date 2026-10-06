let accessToken: string | null = null
const listeners = new Set<(token: string | null) => void>()

// Access tokens live only in this tab's JavaScript memory; refresh is handled by the HttpOnly cookie.
export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string): void {
  accessToken = token
  listeners.forEach((listener) => listener(token))
}

export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearLegacySession(): void {
  // Remove tokens saved by earlier versions of the app.
  localStorage.removeItem('fm_access_token')
  localStorage.removeItem('fm_user')
}

export function clearSession(): void {
  accessToken = null
  clearLegacySession()
  listeners.forEach((listener) => listener(null))
}
