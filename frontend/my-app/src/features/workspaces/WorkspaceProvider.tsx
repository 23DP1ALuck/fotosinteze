import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/use-auth'
import { createBusinessWorkspace, listAccessibleWorkspaces, type AccessibleWorkspace, type BusinessWorkspaceInput } from './api'
import { WorkspaceContext } from './use-workspace'
import { authAccountId, setWorkspace, subscribeWorkspace, workspaceSnapshot } from './workspace-state'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const accountId = auth.status === 'authenticated' ? auth.user?.id ?? null : null
  const queryClient = useQueryClient()
  const previousAccount = useRef<number | null>(null)
  const selection = useSyncExternalStore(subscribeWorkspace, workspaceSnapshot)
  const query = useQuery({ queryKey: ['workspaces', accountId], queryFn: ({signal}) => listAccessibleWorkspaces(signal), enabled: accountId !== null, retry: false, staleTime: 30_000, refetchOnWindowFocus: false })
  const workspaces = accountId === null ? [] : query.data ?? []
  const activeWorkspace = selection.accountId === accountId ? workspaces.find(item => item.id === selection.workspaceId) : undefined
  useEffect(() => {
    const previous = previousAccount.current
    if (previous !== accountId) {
      if (previous !== null) {
        void queryClient.cancelQueries({ predicate: query => query.queryKey[1] === previous })
        queryClient.removeQueries({ predicate: query => query.queryKey[1] === previous })
        try { localStorage.removeItem(`fotosinteze.workspace.${previous}`) } catch { /* Optional persistence. */ }
      }
      setWorkspace(accountId, null)
      previousAccount.current = accountId
    }
  }, [accountId, queryClient])
  useEffect(() => {
    if (accountId === null || !query.data) return
    const accessible = new Set(query.data.map(item => item.id))
    const inaccessibleQueries = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] === accountId && typeof query.queryKey[2] === 'number' && !accessible.has(query.queryKey[2]) }
    void queryClient.cancelQueries(inaccessibleQueries)
    queryClient.removeQueries(inaccessibleQueries)
    if (selection.accountId === accountId && query.data.some(item => item.id === selection.workspaceId)) return
    let saved: number | null = null
    try { const raw = selection.accountId !== accountId || selection.workspaceId === null ? localStorage.getItem(`fotosinteze.workspace.${accountId}`) : null; if (raw) saved = Number(raw) } catch { /* Optional persistence. */ }
    const chosen = query.data.find(item => item.id === saved) ?? query.data.find(item => item.type === 'PERSONAL') ?? query.data[0]
    setWorkspace(accountId, chosen?.id ?? null)
    try { if (chosen) localStorage.setItem(`fotosinteze.workspace.${accountId}`, String(chosen.id)); else localStorage.removeItem(`fotosinteze.workspace.${accountId}`) } catch { /* Optional persistence. */ }
  }, [accountId, query.data, queryClient, selection])
  function selectWorkspace(id: number) {
    if (accountId === null || !workspaces.some(item => item.id === id)) return
    setWorkspace(accountId, id)
    try { localStorage.setItem(`fotosinteze.workspace.${accountId}`, String(id)) } catch { /* Selection still works in memory. */ }
  }
  async function createBusiness(input: BusinessWorkspaceInput) {
    const ownerId = accountId
    if (ownerId === null || authAccountId() !== ownerId) throw new Error('Please log in before creating a workspace.')
    const created = await createBusinessWorkspace(input)
    await queryClient.cancelQueries({ queryKey: ['workspaces', ownerId], exact: true })
    if (authAccountId() !== ownerId) throw new Error('Your account changed. Log in again to view the created workspace.')
    queryClient.setQueryData<AccessibleWorkspace[]>(['workspaces', ownerId], previous => [...(previous ?? []).filter(item => item.id !== created.id), created])
    setWorkspace(ownerId, created.id)
    try { localStorage.setItem(`fotosinteze.workspace.${ownerId}`, String(created.id)) } catch { /* Selection still works in memory. */ }
  }
  const status = accountId === null ? 'unauthenticated' : query.isPending ? 'loading' : query.isError ? 'error' : !workspaces.length ? 'empty' : !activeWorkspace ? 'loading' : 'ready'
  return <WorkspaceContext.Provider value={{ workspaces, activeWorkspace, status, error: query.error instanceof Error ? query.error.message : '', selectWorkspace, createBusiness, retry: () => { void query.refetch() } }}>{children}</WorkspaceContext.Provider>
}
