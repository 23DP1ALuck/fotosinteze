import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, ReceiptText } from 'lucide-react'
import { listTransactions, type TransactionFilters } from '@/features/transactions/api'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { chartDate, chartMoney, type ChartSelection } from './chart-details'
import { MotionDialog } from './MotionDialog'

export function ChartTransactionsDialog({ workspaceId, selection, onClose }: { workspaceId: number; selection: ChartSelection; onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const { type, range, amount, currency, group } = selection
  const income = type === 'INCOME'
  const title = income ? 'Income details' : 'Expense details'
  const filterKey = group ? `${group.dimension}_id` as const : undefined
  const filters: TransactionFilters = { date_from: range.from, date_to: range.to, type }
  if (group && filterKey && group.ids.length === 1 && group.ids[0] !== null) filters[filterKey] = group.ids[0]
  const query = useInfiniteQuery({
    queryKey: [...workspaceQueryKey('transactions', workspaceId), 'chart-details', filters, group, currency],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => listTransactions(workspaceId, pageParam, signal, filters),
    getNextPageParam: page => page.has_more ? page.offset + page.limit : undefined,
  })
  // Match chart totals: base currency only. The API cannot filter currency, null IDs, or combined groups.
  const rows = [...new Map((query.data?.pages.flatMap(page => page.items) ?? [])
    .filter(row => row.currency === currency && (!group || !filterKey || group.ids.includes(row[filterKey])))
    .map(row => [row.transaction_id, row])).values()]
  const period = range.from === range.to ? chartDate(range.from) : `${chartDate(range.from)} – ${chartDate(range.to)}`
  return <MotionDialog title={title} closeLabel={`Close ${title.toLowerCase()}`} onClose={onClose}>
    <div className="mb-6 rounded-2xl border border-[#e1e5df] bg-white p-6">
      <div className="flex items-start gap-3"><span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${income ? 'bg-[#eaf0e6]' : 'bg-[#eef0e2]'}`} aria-hidden="true">{income ? <ArrowUpRight size={21} /> : <ArrowDownLeft size={21} />}</span><div className="min-w-0"><p className="wrap-anywhere text-sm font-medium">{group?.name ?? (income ? 'Money received' : 'Money spent')}</p><p className="mt-1 text-xs leading-relaxed text-[#627168]">{period}</p></div></div>
      <p className="mt-5 wrap-anywhere text-4xl font-semibold tracking-tight tabular-nums">{chartMoney(amount, currency)}</p>
      <p className="mt-2 text-xs text-[#627168]">Chart total in your workspace base currency · {currency}</p>
    </div>
    <div className="mb-4"><h3 className="text-sm font-semibold">{income ? 'Income transactions' : 'Expense transactions'}</h3><p className="mt-2 text-xs leading-relaxed text-[#627168]">Only {currency} transactions included in this chart are shown. Select a transaction for more details.</p></div>
    {query.isPending ? <p role="status" className="rounded-2xl bg-white p-6 text-sm">Loading transactions…</p> : <>
      {rows.length > 0 && <ul aria-label={income ? 'Income transactions' : 'Expense transactions'} className="space-y-3">{rows.map(row => <li key={row.transaction_id} className="overflow-hidden rounded-2xl border border-[#e1e5df] bg-white">
        <button type="button" aria-expanded={expanded === row.transaction_id} aria-controls={`chart-transaction-${row.transaction_id}`} onClick={() => setExpanded(expanded === row.transaction_id ? null : row.transaction_id)} className="flex w-full items-start justify-between gap-4 p-5 text-left hover:bg-[#f3f5ee] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#82965b]">
          <span className="min-w-0"><span className="block wrap-anywhere text-sm font-medium">{row.description || (income ? 'Income' : 'Expense')}</span><span className="mt-1.5 block text-xs text-[#627168]">{chartDate(row.created_at.slice(0, 10))} · {row.source === 'BANK' ? 'Bank sync' : row.source === 'EXPENSE' ? 'Approved expense' : 'Manual'}</span></span>
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium tabular-nums">{income ? '+' : '−'}{chartMoney(Number(row.amount), row.currency)}{expanded === row.transaction_id ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</span>
        </button>
        {expanded === row.transaction_id && <dl id={`chart-transaction-${row.transaction_id}`} className="motion-content mx-5 mb-5 grid grid-cols-2 gap-3 border-t border-[#e1e5df] pt-4 text-xs text-[#526259]"><dt>Source</dt><dd>{row.source === 'BANK' ? 'Bank sync' : row.source === 'EXPENSE' ? 'Expense request' : 'Manual entry'}</dd><dt>Account</dt><dd>#{row.account_id}</dd><dt>Transaction</dt><dd>#{row.transaction_id}</dd><dt>Status</dt><dd>{row.expense_id ? 'Approved expense' : 'Recorded'}</dd></dl>}
      </li>)}</ul>}
      {!query.isError && !rows.length && <div className="rounded-2xl border border-dashed border-[#dce4d8] p-7 text-center"><ReceiptText size={26} className="mx-auto mb-3 text-[#82965b]" aria-hidden="true" /><p className="text-sm font-medium">{query.hasNextPage ? 'No matching transactions on this page.' : `No ${income ? 'income' : 'expense'} transactions in this selection.`}</p>{query.hasNextPage && <p className="mt-2 text-xs text-[#627168]">Load more to continue through this period.</p>}</div>}
      {query.isError && <div role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-5 text-sm text-[#a43b32]"><p>{query.error.message}</p><button type="button" onClick={() => { if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch() }} className="mt-3 rounded-xl bg-white px-4 py-2 font-medium">Retry transactions</button></div>}
      {query.hasNextPage && !query.isFetchNextPageError && <button type="button" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage() }} className="mt-5 w-full rounded-xl bg-[#213d33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50">{query.isFetchingNextPage ? 'Loading…' : 'Load more transactions'}</button>}
    </>}
  </MotionDialog>
}
