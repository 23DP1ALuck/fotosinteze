import { useEffect, useState } from 'react'
import { loadProjectCatalog, type ApiDepartment, type ApiProject } from './api'

export function useProjectCatalog(workspaceId: number | undefined, enabled: boolean) {
  const [state, setState] = useState<{ workspaceId?: number; projects: ApiProject[]; departments: ApiDepartment[]; loading: boolean; error: string }>({ projects: [], departments: [], loading: true, error: '' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (workspaceId === undefined || !enabled) return
    let cancelled = false
    const controller = new AbortController()
    loadProjectCatalog(workspaceId, controller.signal).then(data => {
      if (!cancelled) setState({ workspaceId, ...data, loading: false, error: '' })
    }).catch(error => {
      if (!cancelled) setState(previous => ({ workspaceId, projects: previous.workspaceId === workspaceId ? previous.projects : [], departments: previous.workspaceId === workspaceId ? previous.departments : [], loading: false, error: error instanceof Error ? error.message : 'Could not load projects. Please retry.' }))
    })
    return () => { cancelled = true; controller.abort() }
  }, [workspaceId, enabled, revision])
  const current = enabled && workspaceId !== undefined && state.workspaceId === workspaceId
  return {
    workspaceId,
    projects: current ? state.projects : [],
    departments: current ? state.departments : [],
    loading: enabled && workspaceId !== undefined && (!current || state.loading),
    error: current ? state.error : '',
    refresh() { setState(previous => ({ ...previous, loading: true, error: '' })); setRevision(value => value + 1) },
    upsert(project: ApiProject) { setState(previous => previous.workspaceId !== project.workspace_id ? previous : ({ ...previous, projects: previous.projects.some(item => item.id === project.id) ? previous.projects.map(item => item.id === project.id ? project : item) : [...previous.projects, project] })) },
    remove(id: number) { setState(previous => ({ ...previous, projects: previous.projects.filter(item => item.id !== id) })) },
  }
}
export type ProjectCatalog = ReturnType<typeof useProjectCatalog>
