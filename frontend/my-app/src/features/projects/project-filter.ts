import type { ApiProject } from './api'

export function matchesProjectDepartment(project: Pick<ApiProject, 'department_ids'>, departmentId: string) {
  if (!departmentId) return true
  if (departmentId === 'workspace') return project.department_ids.length === 0
  return project.department_ids.length === 0 || project.department_ids.includes(Number(departmentId))
}
