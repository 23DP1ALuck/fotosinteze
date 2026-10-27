import { useState } from 'react'
import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Check, ChevronRight, CircleAlert, WalletCards } from 'lucide-react'
import { authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { MotionDialog } from '@/features/insights/MotionDialog'
import { loadPersonalBudgets, type BusinessBudget } from './api'

const money = (amount: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amount)
const statuses = {
  EXCEEDED: { label: 'Over budget', color: 'bg-[#fae8e5] text-[#a43b32]', priority: 2 },
  WARNING: { label: 'Near limit', color: 'bg-[#fff3d6] text-[#8a6200]', priority: 1 },
  ON_TRACK: { label: 'On track', color: 'bg-[#eaf0e6] text-[#486c43]', priority: 0 },
}
const usedPercent = (row: BusinessBudget) => Math.round(Math.max(0, row.spent) / row.limit_amount * 100)
function BudgetProgress({ row }: { row: BusinessBudget }) {
  const { t } = useTranslation('finance')
  return <progress className="budget-progress mt-3 block h-1.5 w-full overflow-hidden rounded-full border-0" data-status={row.status}
    aria-label={t('budgetUsed', { name: row.name })} aria-valuetext={`${usedPercent(row)}% used. ${money(row.spent, row.currency)} spent of ${money(row.limit_amount, row.currency)}.`}
    value={Math.max(0, Math.min(row.spent, row.limit_amount))} max={row.limit_amount} />
}
function periodLabel(row: BusinessBudget) {
  const format = (date: Date) => new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
  const lastDay = new Date(Date.parse(`${row.period_end}T00:00:00Z`) - 86400000)
  return `${format(new Date(`${row.period_start}T00:00:00Z`))} – ${format(lastDay)}`
}

export function PersonalBudgetSummary(props: { workspaceId: number; onManage: () => void }) {
  return <BudgetSummary key={`${authAccountId()}:${props.workspaceId}`} {...props} />
}
function BudgetSummary({ workspaceId, onManage }: { workspaceId: number; onManage: () => void }) {
  const { t } = useTranslation('finance')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const query = useQuery({ queryKey: workspaceQueryKey('budgets', workspaceId), queryFn: ({ signal }) => loadPersonalBudgets(workspaceId, signal), staleTime: 0, refetchOnMount: 'always' })
  const rows = query.data?.budgets ?? []
  const ordered = [...rows].sort((a, b) => statuses[b.status].priority - statuses[a.status].priority || b.spent / b.limit_amount - a.spent / a.limit_amount || a.id - b.id)
  const visible = ordered.slice(0, 3)
  const attention = rows.filter(row => row.status !== 'ON_TRACK').length
  const selected = rows.find(row => row.id === selectedId)
  function manage() { setSelectedId(null); onManage() }
  return <>
    <section aria-label={f("Budget overview")} className="flex min-w-0 flex-col rounded-2xl bg-white p-6 text-[#193f33] max-sm:p-5">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf0e6]" aria-hidden="true"><WalletCards size={20} /></span><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold! tracking-tight">Plans at a glance.</h2>
        {!query.isPending && !query.isError && rows.length > 0 && <p className={`mt-1 flex items-center gap-1.5 text-xs ${attention ? 'text-[#8a6200]' : 'text-[#486c43]'}`}>{attention ? <CircleAlert size={13} className="shrink-0" aria-hidden="true" /> : <Check size={13} className="shrink-0" aria-hidden="true" />}<span>{attention ? `${attention} ${attention === 1 ? 'plan needs' : 'plans need'} attention` : 'All plans on track'}</span></p>}
      </div></div>
      {query.isPending && <p role="status" className="mt-5 mb-5 rounded-xl bg-[#f7f8f2] p-5 text-sm text-[#627168]">Loading your plans…</p>}
      {query.isError && <div className="mt-5 mb-5 rounded-xl bg-[#fcf0ed] p-4 text-sm"><p role="alert" className="text-[#a43b32]">{f(query.error.message, true)}</p><button type="button" className="mt-3 underline underline-offset-4" onClick={() => void query.refetch()}>{f("Retry budgets")}</button></div>}
      {!query.isPending && !query.isError && rows.length === 0 && <div className="mt-5 mb-5 rounded-2xl bg-[#f7f8f2] p-5"><p className="text-sm font-medium">Give your money a plan.</p><p className="mt-2 text-xs leading-relaxed text-[#627168]">Set a spending limit and we’ll help you keep an eye on it here.</p></div>}
      {!query.isError && visible.length > 0 && <div className="mt-5 mb-5 space-y-2">{visible.map(row => <article key={row.id} aria-label={t('budgetNamed', { name: row.name })} className="rounded-xl bg-[#f7f8f2] px-3.5 pb-3.5">
        <button type="button" aria-label={`View ${row.name} budget details`} onClick={() => setSelectedId(row.id)} className="group flex w-full items-start justify-between gap-3 pt-3.5 pb-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#82965b]">
          <span className="min-w-0 flex-1"><span title={row.name} className="block truncate text-sm font-medium">{row.name}</span></span><span className="flex shrink-0 items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statuses[row.status].color}`}>{f(statuses[row.status].label)}</span><ChevronRight size={13} className="text-[#82965b] transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
        </button>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs"><span className={row.remaining < 0 ? 'font-medium text-[#a43b32]' : 'text-[#526259]'}>{money(Math.abs(row.remaining), row.currency)} {row.remaining < 0 ? 'over' : 'left'}</span><span className="tabular-nums text-[#627168]">{usedPercent(row)}% used</span></div>
        <BudgetProgress row={row} />
      </article>)}</div>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e5df] pt-4">
        {!query.isPending && !query.isError && rows.length > 0 && <p className="text-[10px] text-[#627168]">{rows.length > visible.length ? `${visible.length} of ${rows.length} plans · priority first` : `${rows.length} ${rows.length === 1 ? 'saved plan' : 'saved plans'}`}</p>}
        <button type="button" onClick={manage} className="ml-auto inline-flex items-center gap-1.5 rounded-lg py-1 text-xs font-medium hover:text-[#60815b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#82965b]">{f("Manage budgets")}<ArrowUpRight size={14} aria-hidden="true" /></button>
      </div>
    </section>
    {selected && !query.isError && <MotionDialog title="Budget details" closeLabel="Close budget details" onClose={() => setSelectedId(null)}>
      <div className="rounded-2xl bg-white p-6"><span className={`inline-block rounded-full px-3 py-1 text-xs ${statuses[selected.status].color}`}>{f(statuses[selected.status].label)}</span><h3 className="mt-4 wrap-anywhere text-2xl font-semibold! tracking-tight">{selected.name}</h3><p className={`mt-5 wrap-anywhere text-4xl font-semibold tracking-tight tabular-nums ${selected.remaining < 0 ? 'text-[#a43b32]' : ''}`}>{money(Math.abs(selected.remaining), selected.currency)}</p><p className="mt-2 text-sm text-[#627168]">{selected.remaining < 0 ? 'over your budget' : 'still available in this plan'}</p><BudgetProgress row={selected} />
        <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-[#e1e5df] pt-5 text-sm"><dt className="text-[#627168]">Spent</dt><dd className="text-right tabular-nums">{money(selected.spent, selected.currency)}</dd><dt className="text-[#627168]">Spending limit</dt><dd className="text-right tabular-nums">{money(selected.limit_amount, selected.currency)}</dd><dt className="text-[#627168]">Tracks</dt><dd className="wrap-anywhere text-right">{selected.target_name}</dd><dt className="text-[#627168]">Repeats</dt><dd className="text-right">{selected.period_length === 'MONTHLY' ? 'Monthly' : selected.period_length === 'WEEKLY' ? 'Weekly' : 'Custom period'}</dd></dl>
        <p className="mt-5 border-t border-[#e1e5df] pt-4 text-xs leading-relaxed text-[#627168]">{periodLabel(selected)}</p>
      </div>
      <button type="button" onClick={manage} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947]">{f("Manage budgets")}<ArrowUpRight size={16} aria-hidden="true" /></button>
    </MotionDialog>}
  </>
}
