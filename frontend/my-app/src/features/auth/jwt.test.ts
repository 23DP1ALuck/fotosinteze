import { describe, expect, it } from 'vitest'

import { decodeJwtPayload, isTokenExpired } from '@/features/auth/jwt'

function makeToken(payload: Record<string, unknown>) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

describe('jwt helpers', () => {
  it('decodes email and subject from a token', () => {
    const token = makeToken({ sub: '7', email: 'user@example.com', exp: 9999999999 })
    expect(decodeJwtPayload(token)).toMatchObject({
      sub: '7',
      email: 'user@example.com',
    })
  })

  it('detects expired tokens', () => {
    const expired = makeToken({ sub: '1', email: 'user@example.com', exp: 1 })
    expect(isTokenExpired(expired)).toBe(true)
  })
})
