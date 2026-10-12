import { createContext, useContext } from 'react'
import type { AccessibleWorkspace } from './api'
export type WorkspaceContextValue = {
  workspaces: AccessibleWorkspace[]; activeWorkspace?: AccessibleWorkspace
  status: 'loading' | 'ready' | 'empty' | 'error' | 'unauthenticated'; error: string
  selectWorkspace: (id: number) => void; retry: () => void
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
