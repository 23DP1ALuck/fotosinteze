import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { listDepartments, type Department } from './api'

const empty: Department[] = []
export function useDepartments(workspaceId: number | undefined, enabled = true) {
  const client = useQueryClient()
  const key = workspaceQueryKey('departments', workspaceId)
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => listDepartments(workspaceId!, signal), enabled: enabled && workspaceId !== undefined })
  return {
    departments: enabled && !query.isError ? query.data ?? empty : empty,
    loading: enabled && workspaceId !== undefined && query.isPending,
    refreshing: enabled && query.isFetching,
    error: query.error instanceof Error ? query.error.message : '',
    refresh: () => { void client.invalidateQueries({ queryKey: key, exact: true }) },
  }
}
