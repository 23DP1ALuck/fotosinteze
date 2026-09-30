import { readApiErrorMessage } from '@/features/auth/api-error'
import type { LoginResponse, RegisterResponse } from '@/features/auth/types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

class ApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new ApiError(await readApiErrorMessage(response))
  }

  return (await response.json()) as T
}

export async function registerUser(input: {
  email: string
  display_name: string
  password: string
}): Promise<RegisterResponse> {
  return request<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function loginUser(input: {
  email: string
  password: string
}): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export { API_URL, ApiError }
