import { useQuery } from '@tanstack/react-query'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { loadPersonalBudgets } from './api'

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount)

export function PersonalBudgetSummary({ workspaceId, onManage }: { workspaceId: number; onManage: () => void }) {
  const query = useQuery({ queryKey: workspaceQueryKey('budgets', workspaceId), queryFn: ({ signal }) => loadPersonalBudgets(workspaceId, signal), staleTime: 0, refetchOnMount: 'always' })
  return <section aria-label="Budget overview" className="min-w-0 rounded-2xl bg-white p-6 text-[#193f33]">
    <h2 className="text-[22px] font-semibold!">Stay within your plans.</h2>
    {query.isPending && <p role="status" className="mt-4 text-sm">Loading budgets…</p>}
    {query.isError && <div className="mt-4 text-sm"><p role="alert">{query.error.message}</p><button className="mt-2 underline" onClick={() => void query.refetch()}>Retry budgets</button></div>}
    {!query.isPending && !query.isError && query.data?.budgets.length === 0 && <p className="mt-4 text-sm text-[#7d877f]">No saved budgets yet.</p>}
    {!query.isError && query.data?.budgets.map(row => <article key={row.id} aria-label={`Budget ${row.name}`} className="mt-5">
      <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold!">{row.name}</h3><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${row.status === 'EXCEEDED' ? 'bg-[#fae8e5] text-[#a43b32]' : row.status === 'WARNING' ? 'bg-[#fff3d6] text-[#8a6200]' : 'bg-[#eaf0e6] text-[#486c43]'}`}>{row.status === 'EXCEEDED' ? 'Exceeded' : row.status === 'WARNING' ? 'Almost there' : 'On track'}</span></div>
      <p className="mt-2 text-xs text-[#7d877f]">{money(row.spent, row.currency)} spent · {row.remaining < 0 ? `${money(-row.remaining, row.currency)} over budget` : `${money(row.remaining, row.currency)} remaining`} of {money(row.limit_amount, row.currency)}</p>
      <p className="mt-1 text-xs text-[#7d877f]">{row.target_name} · {row.period_length.toLowerCase()} · {row.period_start} to {row.period_end} (end excluded)</p>
      <progress className={`mt-3 block h-2 w-full ${row.status === 'EXCEEDED' ? 'accent-[#a43b32]' : 'accent-[#193f33]'}`} aria-label={`${row.name} budget used`} value={Math.max(0, Math.min(row.spent, row.limit_amount))} max={row.limit_amount} />
    </article>)}
    <button className="mt-6 text-sm underline" onClick={onManage}>Manage budgets</button>
  </section>
}
