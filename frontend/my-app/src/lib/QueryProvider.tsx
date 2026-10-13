import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { subscribeAccessToken } from '@/features/auth/storage'
import { authAccountId } from '@/features/workspaces/workspace-state'
import { createQueryClient } from './query-client'
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  useEffect(() => {
    let previous = authAccountId()
    return subscribeAccessToken(() => {
      const account = authAccountId()
      if (account !== previous || account === null) client.clear()
      previous = account
    })
  }, [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
