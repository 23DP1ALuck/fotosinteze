import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { API_URL } from '@/features/auth/api'
import { RevolutConnect } from './RevolutConnect'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearSession() })

it('starts consent with the selected workspace, bearer token and browser cookie, then redirects', async () => {
  const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Date.now() / 1000 + 3600 }))}.s`
  setAccessToken(token)
  const url = 'https://sandbox-oba.revolut.com/ui/index.html?request=signed'
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ authorization_url: url }))
  const assign = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { assign })
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/revolut/authorize`, expect.objectContaining({ method: 'POST', credentials: 'include' }))
  const headers = new Headers(fetchMock.mock.calls[0][1].headers)
  expect(headers.get('Workspace-ID')).toBe('7')
  expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
  expect(assign).toHaveBeenCalledWith(url)
})

it('shows a failed authorization and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'No access to this workspace' }, { status: 403 })))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No access to this workspace')
  expect(screen.getByRole('button', { name: 'Connect Revolut sandbox' })).toBeEnabled()
})

it.each(['https://evil.example/steal', 'javascript:alert(1)', null])('rejects an unexpected authorization URL: %s', async url => {
  const assign = vi.fn()
  vi.stubGlobal('location', { assign })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ authorization_url: url })))
  render(<RevolutConnect workspaceId={7} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect Revolut sandbox' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected authorization URL')
  expect(assign).not.toHaveBeenCalled()
})
