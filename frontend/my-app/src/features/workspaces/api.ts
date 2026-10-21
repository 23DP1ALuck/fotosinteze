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

const businessWorkspaceSettingsSchema = workspaceSchema.extend({ base_currency: z.string().regex(/^[A-Z]{3}$/) })
export type BusinessWorkspaceSettings = z.infer<typeof businessWorkspaceSettingsSchema>

async function workspaceSettingsRequest(workspaceId: number, init: RequestInit): Promise<BusinessWorkspaceSettings> {
  let response: Response
  try { response = await authenticatedFetch(`/workspaces/${workspaceId}`, init) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new Error('Cannot reach the server. Check your connection and try again.', { cause: error })
  }
  if (!response.ok) throw new Error(await readApiErrorMessage(response))
  const result = businessWorkspaceSettingsSchema.safeParse(await response.json())
  if (!result.success || result.data.id !== workspaceId || result.data.type !== 'BUSINESS') {
    throw new Error('The server returned unexpected workspace settings. Please retry.')
  }
  if (result.data.role !== 'OWNER') throw new Error('Only the workspace owner can manage these settings.')
  return result.data
}
export function getBusinessWorkspaceSettings(workspaceId: number, signal?: AbortSignal) {
  return workspaceSettingsRequest(workspaceId, { method: 'GET', signal })
}
export function updateBusinessWorkspace(workspaceId: number, input: BusinessWorkspaceInput) {
  return workspaceSettingsRequest(workspaceId, { method: 'PUT', body: JSON.stringify(businessWorkspaceInputSchema.parse(input)) })
}
