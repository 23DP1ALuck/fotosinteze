import { getAccessToken, subscribeAccessToken } from '@/features/auth/storage'
import { decodeJwtPayload } from '@/features/auth/jwt'

type Snapshot = { accountId: number | null; workspaceId: number | null }
let snapshot: Snapshot = { accountId: null, workspaceId: null }
const listeners = new Set<() => void>()
export function authAccountId(): number | null {
  const token = getAccessToken()
  const id = token ? Number(decodeJwtPayload(token)?.sub) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
export function workspaceSnapshot() { return snapshot }
export function subscribeWorkspace(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setWorkspace(accountId: number | null, workspaceId: number | null) {
  if (snapshot.accountId === accountId && snapshot.workspaceId === workspaceId) return
  snapshot = { accountId, workspaceId }; listeners.forEach(listener => listener())
}
export function activeWorkspaceId(): number | null { return snapshot.accountId === authAccountId() ? snapshot.workspaceId : null }
export function workspaceQueryKey(feature: string, workspaceId?: number | null) { return [feature, authAccountId(), workspaceId ?? activeWorkspaceId()] as const }
subscribeAccessToken(() => {
  const accountId = authAccountId()
  if (accountId !== snapshot.accountId || accountId === null) {
    if (snapshot.accountId !== null) {
      try { localStorage.removeItem(`fotosinteze.workspace.${snapshot.accountId}`) } catch { /* Storage may be disabled. */ }
    }
    setWorkspace(accountId, null)
  }
})
