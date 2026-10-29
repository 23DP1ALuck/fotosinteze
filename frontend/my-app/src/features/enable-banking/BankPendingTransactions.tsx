import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { useBanking } from './banking'

const pendingSchema = z.object({ items: z.array(z.object({
  account_id: z.number().int().positive(), amount: z.string().regex(/^\d+(\.\d+)?$/).refine(value => Number(value) > 0 && Number.isFinite(Number(value))),
  currency: z.string().min(1), description: z.string(), direction: z.enum(['income', 'expense']), date: z.string().date().nullable(),
})) })
export function BankPendingTransactions({ workspaceId }: { workspaceId: number }) {
  const { t } = useTranslation('finance')
  const bank = useBanking(workspaceId)
  const pending = useQuery({ queryKey: ['bank-pending', bank.ownerId, workspaceId], enabled: bank.data?.status === 'connected', retry: false,
    queryFn: async ({ signal }) => {
      const response = await authenticatedFetch('/enable-banking/pending', { signal }, { workspaceId })
      if (!response.ok) throw new Error()
      return pendingSchema.parse(await response.json()).items
    },
  })
  if (bank.data?.status !== 'connected') return null
  return <section aria-label={t('bankPendingTransactions')} className="mb-6 rounded-2xl bg-[#eaf0e5] p-6">
    <h2 className="font-semibold">{t('bankPendingTransactions')}</h2><p className="mt-1 text-sm">{t('bankPendingExcluded')}</p>
    {pending.isError ? <p role="alert" className="mt-3 text-sm">{t('bankPendingError')}</p> : pending.isPending ? <p role="status">{t('bankPendingLoading')}</p> : !pending.data?.length ? <p className="mt-3 text-sm">{t('bankPendingEmpty')}</p> : <ul className="mt-3 divide-y divide-[#ccd9c6]">{pending.data.map((item, index) => <li key={index} className="flex justify-between gap-4 py-3 text-sm"><div>{item.description}<span className="ml-2 text-xs">{item.date ?? t('bankPendingDateUnknown')}</span></div><span>{item.direction === 'expense' ? '−' : '+'}{item.amount} {item.currency}</span></li>)}</ul>}
  </section>
}
