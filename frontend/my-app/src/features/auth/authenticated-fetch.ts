import { getStoredToken } from '@/features/auth/storage'

import { API_URL } from './api'

export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getStoredToken()
  const headers = new Headers(init.headers)

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  })
}
