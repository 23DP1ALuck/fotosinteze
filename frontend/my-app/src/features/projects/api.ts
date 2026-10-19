import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { listDepartments, type Department } from '@/features/departments/api'
import { readApiErrorMessage } from '@/features/auth/api-error'

const projectSchema = z.object({ id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string(), status: z.string().nullable().default(null), start_date: z.string().nullable().default(null), end_date: z.string().nullable().default(null), department_ids: z.array(z.number().int().positive()).default([]) })
export type ApiProject = z.infer<typeof projectSchema>
export type ApiDepartment = Department
export type ProjectInput = Pick<ApiProject, 'name' | 'status' | 'start_date' | 'end_date'> & Partial<Pick<ApiProject, 'department_ids'>>

async function request(workspaceId: number, path: string, init: RequestInit): Promise<Response> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new Error('Enter a valid workspace ID.')
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch { throw new Error('Cannot reach the server. Check that the backend is running and try again.') }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    const detail = await readApiErrorMessage(response)
    if (response.status === 403 && detail === 'No access to this workspace') {
      throw new Error(`Your account cannot access workspace ${workspaceId}. Choose an accessible Business workspace from the workspace switcher.`)
    }
    if (response.status === 400 && detail === 'Departments and projects require a business workspace') {
      throw new Error(`Workspace ${workspaceId} is a Personal workspace. Projects require a Business workspace.`)
    }
    throw new Error(detail)
  }
  return response
}
export async function listProjects(workspaceId: number, signal?: AbortSignal) {
  const projects = z.array(projectSchema).parse(await (await request(workspaceId, '/projects', { method: 'GET', signal })).json())
  if (projects.some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned data for another workspace. Please retry.')
  return projects
}
export async function loadProjectCatalog(workspaceId: number, signal?: AbortSignal) {
  const [projects, departments] = await Promise.all([listProjects(workspaceId, signal), listDepartments(workspaceId, signal)])
  return { projects, departments }
}
export async function saveProject(workspaceId: number, input: ProjectInput, id?: number): Promise<ApiProject> {
  const response = await request(workspaceId, id === undefined ? '/projects' : `/projects/${id}`, { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(input) })
  const project = projectSchema.parse(await response.json())
  if (project.workspace_id !== workspaceId) throw new Error('The server returned a project for another workspace.')
  return project
}
export async function deleteProject(workspaceId: number, id: number) { await request(workspaceId, `/projects/${id}`, { method: 'DELETE' }) }
