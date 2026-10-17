import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadProjectCatalog, type ApiProject } from './api'
import { authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
const emptyCatalog: Awaited<ReturnType<typeof loadProjectCatalog>> = { projects: [], departments: [] }
export function useProjectCatalog(workspaceId: number | undefined, enabled: boolean) {
  const client = useQueryClient()
  const key = workspaceQueryKey('projects',workspaceId)
  const query = useQuery({ queryKey: key, queryFn: ({signal}) => loadProjectCatalog(workspaceId!,signal), enabled: enabled && workspaceId !== undefined })
  const data = enabled && !query.isError ? query.data : undefined
  return {
    workspaceId, projects: data?.projects ?? emptyCatalog.projects, departments: data?.departments ?? emptyCatalog.departments,
    loading: enabled && workspaceId !== undefined && (query.isPending || query.isFetching),
    error: query.error instanceof Error ? query.error.message : '',
    refresh() { void client.invalidateQueries({queryKey:key,exact:true}) },
    upsert(project: ApiProject) { if(authAccountId()!==key[1])return; client.setQueryData<Awaited<ReturnType<typeof loadProjectCatalog>>>(key, previous => previous ? { ...previous, projects: previous.projects.some(item=>item.id===project.id) ? previous.projects.map(item=>item.id===project.id?project:item) : [...previous.projects,project] } : previous) },
    remove(id: number) { if(authAccountId()!==key[1])return; client.setQueryData<Awaited<ReturnType<typeof loadProjectCatalog>>>(key, previous => previous ? { ...previous, projects: previous.projects.filter(item=>item.id!==id) } : previous) },
  }
}
export type ProjectCatalog = ReturnType<typeof useProjectCatalog>
