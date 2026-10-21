import { createContext, useContext } from 'react'
import type { AccessibleWorkspace, BusinessWorkspaceInput } from './api'
export type WorkspaceContextValue = {
  workspaces: AccessibleWorkspace[]; activeWorkspace?: AccessibleWorkspace
  status: 'loading' | 'ready' | 'empty' | 'error' | 'unauthenticated'; error: string
  selectWorkspace: (id: number) => void; retry: () => void
  createBusiness: (input: BusinessWorkspaceInput) => Promise<void>
  updateBusiness: (id: number, input: BusinessWorkspaceInput) => Promise<void>
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
