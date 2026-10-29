import { useEffect, useRef } from 'react'
import { useBanking, useBankAutoPreference } from './banking'

export function BankAutoRefresh({ workspaceId }: { workspaceId: number }) {
  const bank = useBanking(workspaceId)
  const preference = useBankAutoPreference(bank.ownerId, workspaceId)
  const lastInteraction = useRef(0)
  const lastAttempt = useRef(0)
  const loadedScope = useRef<string | null>(null)
  const latest = useRef({ bank, enabled: preference.enabled })
  useEffect(() => { latest.current = { bank, enabled: preference.enabled } })
  useEffect(() => {
    const { bank } = latest.current
    const scope = `${bank.ownerId}:${workspaceId}`
    const data = bank.data
    if (loadedScope.current === scope || bank.ownerId === null || bank.busy || data?.status !== 'connected' || document.visibilityState !== 'visible') return
    loadedScope.current = scope
    if (data.next_sync_at && Date.parse(data.next_sync_at) > Date.now()) return
    lastInteraction.current = Date.now()
    lastAttempt.current = Date.now()
    bank.mutation.mutate('sync')
  }, [workspaceId, bank.ownerId, bank.data?.status, bank.busy])
  useEffect(() => {
    const attempt = (returning = false) => {
      const { bank, enabled } = latest.current
      const data = bank.data
      if (document.visibilityState !== 'visible' || Date.now() - lastInteraction.current >= 60_000 || bank.busy || data?.status !== 'connected') return
      if (data.next_sync_at && Date.parse(data.next_sync_at) > Date.now()) return
      const interval = data.auto_sync_interval_seconds
      if (!returning && (!enabled || !interval || Date.now() - lastAttempt.current < interval * 1000)) return
      if (Date.now() - lastAttempt.current < 1000) return
      lastAttempt.current = Date.now()
      if (returning) loadedScope.current = `${bank.ownerId}:${workspaceId}`
      bank.mutation.mutate(returning ? 'sync' : 'automatic')
    }
    const interact = () => { lastInteraction.current = Date.now() }
    const focus = () => { interact(); attempt(true) }
    const visibility = () => { if (document.visibilityState === 'visible') focus() }
    window.addEventListener('pointerdown', interact)
    window.addEventListener('keydown', interact)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(attempt, 1000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pointerdown', interact)
      window.removeEventListener('keydown', interact)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [workspaceId, bank.ownerId])
  return null
}
