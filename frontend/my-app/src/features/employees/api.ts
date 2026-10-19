import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const memberSchema = z.object({
  user_id: z.number().int().positive(), workspace_id: z.number().int().positive(),
  display_name: z.string(), email: z.string(), role: z.enum(['OWNER', 'EMPLOYEE']),
  department_id: z.number().int().positive().nullable(), joined_at: z.string(),
})
export type WorkspaceMember = z.infer<typeof memberSchema>
export const employeeInputSchema = z.object({ email: z.string().trim().min(1, 'Enter an email address').max(100, 'Use 100 characters or fewer').email({ pattern: z.regexes.unicodeEmail, message: 'Enter a valid email address' }) })

export class MemberApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
async function request(path: string, init: RequestInit) {
  let response: Response
  try { response = await authenticatedFetch(path, init) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new Error('Cannot reach the server. Check your connection and try again.', { cause: error })
  }
  if (!response.ok) {
    let message: string
    if (response.status === 401) message = 'Your session has expired. Please log in again.'
    else if (response.status === 403) message = 'Only workspace owners can manage employees. Refresh your workspaces to check your access.'
    else {
      // Auth's shared parser translates "User not found" into a login error.
      // In member management it means the email has no registered account.
      const body: unknown = await response.clone().json().catch(() => null)
      if (response.status === 404 && body && typeof body === 'object' && 'detail' in body && body.detail === 'User not found') message = 'No registered user has this email address. Ask them to create an account first.'
      else message = await readApiErrorMessage(response)
    }
    throw new MemberApiError(message, response.status)
  }
  return response
}
async function readMembers(response: Response, workspaceId: number, single: boolean) {
  const json: unknown = await response.json().catch(() => null)
  const result = z.array(memberSchema).safeParse(single ? [json] : json)
  if (!result.success || result.data.some(item => item.workspace_id !== workspaceId) || new Set(result.data.map(item => item.user_id)).size !== result.data.length) {
    throw new Error('The server returned unexpected member data. Refresh members before retrying.')
  }
  return result.data
}
export async function listMembers(workspaceId: number, signal?: AbortSignal): Promise<WorkspaceMember[]> {
  return readMembers(await request(`/workspaces/${workspaceId}/members`, { method: 'GET', signal }), workspaceId, false)
}
export async function addEmployee(workspaceId: number, email: string, departmentId?: number): Promise<WorkspaceMember> {
  const input = employeeInputSchema.parse({ email })
  const [member] = await readMembers(await request(`/workspaces/${workspaceId}/employees`, { method: 'POST', body: JSON.stringify({ ...input, ...(departmentId === undefined ? {} : { department_id: departmentId }) }) }), workspaceId, true)
  if (member.role !== 'EMPLOYEE') throw new Error('The server returned an unexpected membership role. Refresh members before retrying.')
  return member
}
export async function removeEmployee(workspaceId: number, userId: number): Promise<void> {
  await request(`/workspaces/${workspaceId}/employees/${userId}`, { method: 'DELETE' })
}

export async function assignEmployee(workspaceId: number, userId: number, departmentId: number) {
  const response = await authenticatedFetch(`/departments/${departmentId}/employees/${userId}`, { method: 'PUT' }, { workspaceId })
  if (!response.ok) throw new MemberApiError(await readApiErrorMessage(response), response.status)
  const parsed = z.object({ user_id: z.number(), workspace_id: z.number(), department_id: z.number() }).safeParse(await response.json())
  if (!parsed.success || parsed.data.user_id !== userId || parsed.data.workspace_id !== workspaceId || parsed.data.department_id !== departmentId) throw new Error('The server returned unexpected assignment data. Refresh members before retrying.')
  return parsed.data
}
