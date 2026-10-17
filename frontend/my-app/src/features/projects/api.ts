import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const projectSchema = z.object({ id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string(), status: z.string().nullable().default(null), start_date: z.string().nullable().default(null), end_date: z.string().nullable().default(null), department_ids: z.array(z.number().int().positive()).default([]) })
const departmentSchema = z.object({ id: z.number().int().positive(), name: z.string(), workspace_id: z.number().int().positive() })
export type ApiProject = z.infer<typeof projectSchema>
export type ApiDepartment = z.infer<typeof departmentSchema>
export type ProjectInput = Pick<ApiProject, 'name' | 'status' | 'start_date' | 'end_date' | 'department_ids'>

async function request(workspaceId: number, path: string, init: RequestInit): Promise<Response> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new Error('Enter a valid workspace ID.')
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch { throw new Error('Cannot reach the server. Check that the backend is running and try again.') }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    const detail = await readApiErrorMessage(response)
    if (response.status === 403 && detail === 'No access to this workspace') {
      throw new Error(`Your account cannot access workspace ${workspaceId}. Connect an existing Business workspace where you are a member. Creating a workspace in this frontend currently creates a session workspace only.`)
    }
    if (response.status === 400 && detail === 'Departments and projects require a business workspace') {
      throw new Error(`Workspace ${workspaceId} is a Personal workspace. Projects require a Business workspace.`)
    }
    throw new Error(detail)
  }
  return response
}
export async function loadProjectCatalog(workspaceId: number, signal?: AbortSignal) {
  const [projectsResponse, departmentsResponse] = await Promise.all([
    request(workspaceId, '/projects', { method: 'GET', signal }), request(workspaceId, '/departments', { method: 'GET', signal }),
  ])
  const projects = z.array(projectSchema).parse(await projectsResponse.json())
  const departments = z.array(departmentSchema).parse(await departmentsResponse.json())
  if ([...projects, ...departments].some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned data for another workspace. Please retry.')
  return { projects, departments }
}
export async function saveProject(workspaceId: number, input: ProjectInput, id?: number): Promise<ApiProject> {
  const response = await request(workspaceId, id === undefined ? '/projects' : `/projects/${id}`, { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(input) })
  const project = projectSchema.parse(await response.json())
  if (project.workspace_id !== workspaceId) throw new Error('The server returned a project for another workspace.')
  return project
}
export async function deleteProject(workspaceId: number, id: number) { await request(workspaceId, `/projects/${id}`, { method: 'DELETE' }) }
