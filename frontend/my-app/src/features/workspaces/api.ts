import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const workspaceSchema = z.object({ id: z.number().int().positive(), name: z.string(), type: z.enum(['PERSONAL', 'BUSINESS']), role: z.enum(['OWNER', 'EMPLOYEE']) })
export type AccessibleWorkspace = z.infer<typeof workspaceSchema>
export async function listAccessibleWorkspaces(signal?: AbortSignal): Promise<AccessibleWorkspace[]> {
  let response: Response
  try { response = await authenticatedFetch('/workspaces', { method: 'GET', signal }) }
  catch { throw new Error('Cannot reach the server. Check that the backend is running and try again.') }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    throw new Error(await readApiErrorMessage(response))
  }
  const result = z.array(workspaceSchema).safeParse(await response.json())
  if (!result.success) throw new Error('The server returned unexpected workspace data. Please retry.')
  return result.data
}


export const businessWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name').max(100, 'Use 100 characters or fewer'),
  base_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Enter a three-letter currency code, such as EUR'),
})
export type BusinessWorkspaceInput = z.infer<typeof businessWorkspaceInputSchema>

export async function createBusinessWorkspace(input: BusinessWorkspaceInput): Promise<AccessibleWorkspace> {
  const body = businessWorkspaceInputSchema.parse(input)
  let response: Response
  try {
    response = await authenticatedFetch('/workspaces/business', { method: 'POST', body: JSON.stringify(body) })
  } catch {
    throw new Error('Cannot reach the server. Check that the backend is running and try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    throw new Error(await readApiErrorMessage(response))
  }
  const result = workspaceSchema.safeParse(await response.json())
  if (!result.success || result.data.type !== 'BUSINESS' || result.data.role !== 'OWNER') {
    throw new Error('The server returned unexpected workspace data. Refresh your workspaces before retrying.')
  }
  return result.data
}
