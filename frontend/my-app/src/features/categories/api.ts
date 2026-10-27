import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'
import type { Category, CategoryInput, WorkspaceKind } from './types'

const responseSchema = z.object({ category_id: z.number().int().positive(), workspace_id: z.number().int().positive().nullable(), name: z.string(), type: z.enum(['INCOME', 'EXPENSE']) })
async function request(workspaceId: number, path: string, init: RequestInit): Promise<Response> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) throw new Error('Enter a valid workspace ID.')
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch { throw new Error('Cannot reach the server. Check that the backend is running and try again.') }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    const detail = await readApiErrorMessage(response)
    if (response.status === 403 && detail === 'No access to this workspace') throw new Error(`Your account cannot access workspace ${workspaceId}. Use an existing workspace owned by or shared with your account.`)
    if (response.status === 400 && detail === 'Departments and projects require a business workspace') throw new Error(`Workspace ${workspaceId} is Personal. Connect a real Business workspace here.`)
    throw new Error(detail)
  }
  return response
}
function mapCategory(value: unknown, workspaceId: number): Category {
  const result = responseSchema.safeParse(value)
  if (!result.success || (result.data.workspace_id !== null && result.data.workspace_id !== workspaceId)) throw new Error('The server returned unexpected category data. Please retry.')
  const row = result.data
  return { id: row.category_id, name: row.name, type: row.type === 'INCOME' ? 'income' : 'expense', workspaceId: row.workspace_id }
}
export async function listCategories(workspaceId: number, signal?: AbortSignal): Promise<Category[]> {
  const response = await request(workspaceId, '/categories', { method: 'GET', signal })
  const data: unknown = await response.json()
  if (!Array.isArray(data)) throw new Error('The server returned unexpected category data. Please retry.')
  return data.map(row => mapCategory(row, workspaceId))
}
export async function saveCategory(workspaceId: number, input: CategoryInput, id?: number): Promise<Category> {
  const response = await request(workspaceId, id === undefined ? '/categories' : `/categories/${id}`, {
    method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify({ name: input.name.trim(), type: input.type === 'income' ? 'INCOME' : 'EXPENSE' }),
  })
  return mapCategory(await response.json(), workspaceId)
}
export async function deleteCategory(workspaceId: number, id: number): Promise<void> {
  await request(workspaceId, `/categories/${id}`, { method: 'DELETE' })
}

export async function verifyCategoryWorkspace(workspaceId: number, kind: WorkspaceKind, signal?: AbortSignal): Promise<void> {
  await listCategories(workspaceId, signal)
  // Category responses do not identify workspace type; this scoped endpoint rejects Personal workspaces.
  if (kind === 'business') await request(workspaceId, '/departments', { method: 'GET', signal })
}
