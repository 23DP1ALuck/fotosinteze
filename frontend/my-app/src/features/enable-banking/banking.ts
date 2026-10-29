import { useMutation, useQuery, useQueryClient, useIsMutating, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'
import { subscribeAccessToken } from '@/features/auth/storage'
import { authAccountId } from '@/features/workspaces/workspace-state'

export const connectionSchema = z.object({
  status: z.enum(['not_connected', 'connected', 'pending', 'expired', 'failed']),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  last_sync_at: z.string().datetime({ offset: true }).nullable(),
  auto_sync_interval_seconds: z.number().min(5).nullable().default(null),
  next_sync_at: z.string().datetime({ offset: true }).nullable().default(null),
})
export const disconnected = connectionSchema.parse({ status: 'not_connected', expires_at: null, last_sync_at: null })
export const financeFeatures = ['accounts', 'account-details', 'transactions', 'dashboard', 'statistics', 'categories', 'budgets', 'business-budgets', 'bank-pending']
export function invalidateFinance(client: QueryClient, ownerId: number | null, workspaceId: number) {
  return Promise.all(financeFeatures.map(feature => client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })))
}
const operations = new Map<string, AbortController>()
export function useBanking(workspaceId: number) {
  const ownerId = useSyncExternalStore(subscribeAccessToken, authAccountId)
  const client = useQueryClient()
  const queryKey = ['bank-connection', ownerId, workspaceId]
  const mutationKey = ['bank-operation', ownerId, workspaceId]
  const scope = `${ownerId}:${workspaceId}`
  const owned = useRef<AbortController | null>(null)
  useEffect(() => () => { owned.current?.abort() }, [scope])
  const query = useQuery({ queryKey, enabled: ownerId !== null, retry: false, staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const response = await authenticatedFetch('/enable-banking/connection', { signal }, { workspaceId })
      if (!response.ok) throw new Error('Could not check Enable Banking connection. Return to this tab to retry.')
      const data = connectionSchema.parse(await response.json())
      const cached = client.getQueryData<z.infer<typeof connectionSchema>>(queryKey)
      // A focus check must not erase a Retry-After deadline returned by sync.
      if (cached?.next_sync_at && Date.parse(cached.next_sync_at) > Date.now() && (!data.next_sync_at || Date.parse(cached.next_sync_at) > Date.parse(data.next_sync_at))) data.next_sync_at = cached.next_sync_at
      return data
    },
  })
  const { refetch } = query
  // Explicit focus handling also works while the Accounts panel is unmounted.
  useEffect(() => {
    const focus = () => { void refetch({ cancelRefetch: false }) }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [refetch])
  const mutation = useMutation({ mutationKey, mutationFn: async (action: 'sync' | 'delete' | 'automatic' | 'full') => {
    if (operations.has(scope)) return null
    const current = client.getQueryData<z.infer<typeof connectionSchema>>(queryKey)
    if (action !== 'delete' && current?.next_sync_at && Date.parse(current.next_sync_at) > Date.now()) return null
    const controller = new AbortController()
    owned.current = controller
    operations.set(scope, controller)
    try {
      const response = await authenticatedFetch(action === 'delete' ? '/enable-banking/connection' : `/enable-banking/sync${action === 'full' ? '' : `?recent=true&automatic=${action === 'automatic'}`}`, { method: action === 'delete' ? 'DELETE' : 'POST', signal: controller.signal, credentials: 'include' }, { workspaceId })
      if (controller.signal.aborted || authAccountId() !== ownerId) return null
      if (response.status === 429 && action !== 'delete') {
        const seconds = Number(response.headers.get('Retry-After'))
        const next = new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000).toISOString()
        client.setQueryData(queryKey, (data: z.infer<typeof connectionSchema> | undefined) => data && { ...data, next_sync_at: next })
        return null
      }
      if (!response.ok) {
        if (action === 'delete' && response.status === 429) await client.invalidateQueries({ queryKey })
        throw new Error(await readApiErrorMessage(response))
      }
      if (action === 'delete') {
        await Promise.all([...financeFeatures, 'bank-connection'].map(feature => client.cancelQueries({ queryKey: [feature, ownerId, workspaceId] })))
        if (controller.signal.aborted || authAccountId() !== ownerId) return null
        client.removeQueries({ queryKey: ['account-details', ownerId, workspaceId] })
        client.removeQueries({ queryKey: ['bank-pending', ownerId, workspaceId] })
        client.setQueryData(queryKey, disconnected)
        await invalidateFinance(client, ownerId, workspaceId)
        return null
      }
      const data = z.object({ accounts_count: z.number().int().nonnegative(), imported_count: z.number().int().nonnegative(), last_sync_at: z.string().datetime({ offset: true }) }).safeParse(await response.json())
      if (!data.success) throw new Error('The server returned unexpected sync data. Please retry.')
      if (controller.signal.aborted || authAccountId() !== ownerId) return null
      client.setQueryData(queryKey, (value: z.infer<typeof connectionSchema> | undefined) => value && { ...value, last_sync_at: data.data.last_sync_at, next_sync_at: value.auto_sync_interval_seconds ? new Date(Date.now() + value.auto_sync_interval_seconds * 1000).toISOString() : null })
      await invalidateFinance(client, ownerId, workspaceId)
      return data.data
    } finally {
      if (operations.get(scope) === controller) operations.delete(scope)
      if (owned.current === controller) owned.current = null
    }
  } })
  return { ...query, ownerId, mutation, busy: useIsMutating({ mutationKey }) > 0 }
}

export function useBankAutoPreference(ownerId: number | null, workspaceId: number) {
  const client = useQueryClient()
  const key = ['bank-auto', ownerId, workspaceId]
  const storageKey = `bank-auto:${ownerId}:${workspaceId}`
  const preference = useQuery({ queryKey: key, queryFn: () => localStorage.getItem(storageKey) === 'true', initialData: () => localStorage.getItem(storageKey) === 'true', staleTime: Infinity })
  return { enabled: preference.data, setEnabled(value: boolean) { localStorage.setItem(storageKey, String(value)); client.setQueryData(key, value) } }
}
