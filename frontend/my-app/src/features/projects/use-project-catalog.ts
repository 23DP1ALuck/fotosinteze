import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listProjects, type ApiProject } from './api'
import { useDepartments } from '@/features/departments/use-departments'
import { authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
type ProjectData = { projects: ApiProject[] }
const emptyProjects: ApiProject[] = []
export function useProjectCatalog(workspaceId: number | undefined, enabled: boolean, accessRole?: 'OWNER' | 'EMPLOYEE') {
  const client = useQueryClient()
  const baseKey = workspaceQueryKey('projects',workspaceId)
  const key = accessRole === undefined ? baseKey : [...baseKey, accessRole] as const
  const departments = useDepartments(workspaceId, enabled, accessRole)
  const query = useQuery({ queryKey: key, queryFn: async ({signal}) => ({ projects: await listProjects(workspaceId!,signal) }), enabled: enabled && workspaceId !== undefined })
  const data = enabled && !query.isError ? query.data : undefined
  return {
    workspaceId, projects: data?.projects ?? emptyProjects, departments: departments.departments,
    loading: enabled && workspaceId !== undefined && (query.isPending || query.isFetching || departments.refreshing),
    error: query.error instanceof Error ? query.error.message : departments.error,
    refresh() { void client.invalidateQueries({queryKey:key,exact:true}); departments.refresh() },
    upsert(project: ApiProject) { if(authAccountId()!==key[1])return; client.setQueryData<ProjectData>(key, previous => previous ? { ...previous, projects: previous.projects.some(item=>item.id===project.id) ? previous.projects.map(item=>item.id===project.id?project:item) : [...previous.projects,project] } : previous) },
    remove(id: number) { if(authAccountId()!==key[1])return; client.setQueryData<ProjectData>(key, previous => previous ? { ...previous, projects: previous.projects.filter(item=>item.id!==id) } : previous) },
  }
}
export type ProjectCatalog = ReturnType<typeof useProjectCatalog>
