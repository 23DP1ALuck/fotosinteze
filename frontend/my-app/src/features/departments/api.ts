import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

export const departmentSchema = z.object({ id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string() })
export type Department = z.infer<typeof departmentSchema>
export const departmentInputSchema = z.object({ name: z.string().trim().min(1, 'Enter a department name').max(100, 'Use 100 characters or fewer') })

async function request(workspaceId: number, path: string, init: RequestInit) {
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new Error('Cannot reach the server. Check that the backend is running and try again.', { cause: error })
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    throw new Error(await readApiErrorMessage(response))
  }
  return response
}
export async function listDepartments(workspaceId: number, signal?: AbortSignal): Promise<Department[]> {
  const parsed = z.array(departmentSchema).safeParse(await (await request(workspaceId, '/departments', { method: 'GET', signal })).json())
  if (!parsed.success || parsed.data.some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned unexpected department data. Please refresh and try again.')
  return parsed.data
}
export async function saveDepartment(workspaceId: number, name: string, id?: number): Promise<Department> {
  const input = departmentInputSchema.parse({ name })
  const query = new URLSearchParams({ name: input.name })
  const response = await request(workspaceId, `${id === undefined ? '/departments' : `/departments/${id}`}?${query}`, { method: id === undefined ? 'POST' : 'PUT' })
  const parsed = departmentSchema.safeParse(await response.json())
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || (id !== undefined && parsed.data.id !== id)) throw new Error('The server returned unexpected department data. Refresh before retrying.')
  return parsed.data
}
export async function deleteDepartment(workspaceId: number, id: number) {
  await request(workspaceId, `/departments/${id}`, { method: 'DELETE' })
}
