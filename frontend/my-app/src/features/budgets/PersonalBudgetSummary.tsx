import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { useQuery } from '@tanstack/react-query'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { loadPersonalBudgets } from './api'

const budgetDate = (value: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
const money = (amount: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amount)

export function PersonalBudgetSummary({ workspaceId, onManage }: { workspaceId: number; onManage: () => void }) {
  const { t } = useTranslation('finance')
  const query = useQuery({ queryKey: workspaceQueryKey('budgets', workspaceId), queryFn: ({ signal }) => loadPersonalBudgets(workspaceId, signal), staleTime: 0, refetchOnMount: 'always' })
  return <section aria-label={f("Budget overview")} className="min-w-0 rounded-2xl bg-white p-6 text-[#193f33]">
    <h2 className="text-[22px] font-semibold!">{f("Stay within your plans.")}</h2>
    {query.isPending && <p role="status" className="mt-4 text-sm">{f("Loading budgets…")}</p>}
    {query.isError && <div className="mt-4 text-sm"><p role="alert">{f(query.error.message, true)}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>{f("Retry budgets")}</button></div>}
    {!query.isPending && !query.isError && query.data?.budgets.length === 0 && <p className="mt-4 text-sm text-[#627168]">{f("No saved budgets yet.")}</p>}
    {!query.isError && query.data?.budgets.map(row => <article key={row.id} aria-label={t('budgetNamed', { name: row.name })} className="mt-5">
      <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold!">{row.name}</h3><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${row.status === 'EXCEEDED' ? 'bg-[#fae8e5] text-[#a43b32]' : row.status === 'WARNING' ? 'bg-[#fff3d6] text-[#8a6200]' : 'bg-[#eaf0e6] text-[#486c43]'}`}>{row.status === 'EXCEEDED' ? f("Exceeded") : row.status === 'WARNING' ? f("Almost there") : f("On track")}</span></div>
      <p className="mt-2 text-xs text-[#627168]">{t('budgetSummary', { spent: money(row.spent, row.currency), remaining: t(row.remaining < 0 ? 'overBudget' : 'remaining', { amount: money(Math.abs(row.remaining), row.currency) }), limit: money(row.limit_amount, row.currency) })}</p>
      <p className="mt-1 text-xs text-[#627168]">{row.target_name} · {t('periodRange', { period: f(row.period_length === 'MONTHLY' ? 'Monthly' : row.period_length === 'WEEKLY' ? 'Weekly' : 'Custom'), from: budgetDate(row.period_start), to: budgetDate(row.period_end) })}</p>
      <progress className={`mt-3 block h-2 w-full ${row.status === 'EXCEEDED' ? 'accent-[#a43b32]' : 'accent-[#193f33]'}`} aria-label={t('budgetUsed', { name: row.name })} value={Math.max(0, Math.min(row.spent, row.limit_amount))} max={row.limit_amount} />
    </article>)}
    <button className="mt-6 text-sm underline" onClick={onManage}>{f("Manage budgets")}</button>
  </section>
}
