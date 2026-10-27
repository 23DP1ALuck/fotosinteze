import { useTranslation } from 'react-i18next'
import { getLocale } from '@/i18n'
import { insightMessage as im, insightError } from '@/i18n/insight-message'
import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { loadMetric, type DateRange } from '@/features/statistics/api'
import { listTransactions } from '@/features/transactions/api'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { MotionDialog } from './MotionDialog'
const money=(amount:number,currency:string)=>new Intl.NumberFormat(getLocale(),{style:'currency',currency}).format(amount)
type Category={id:number|null;name:string;amount:number}
export function ExpenseExplorer(props:{workspaceId:number;range:DateRange;onClose:()=>void}) {
  return <Explorer key={`${props.workspaceId}:${props.range.from}:${props.range.to}`} {...props} />
}
function Explorer({workspaceId,range,onClose}:{workspaceId:number;range:DateRange;onClose:()=>void}) {
  const { t } = useTranslation('insights')
  const [selected,setSelected]=useState<Category|null>(null)
  const [detail,setDetail]=useState<number|null>(null)
  const categories=useQuery({queryKey:[...workspaceQueryKey('statistics',workspaceId),'categories',range.from,range.to],queryFn:({signal})=>loadMetric('categories',workspaceId,range,signal)})
  const transactions=useInfiniteQuery({queryKey:[...workspaceQueryKey('transactions',workspaceId),'exploration',range,selected?.id],initialPageParam:0,enabled:selected!==null,queryFn:({signal,pageParam})=>listTransactions(workspaceId,pageParam,signal,{date_from:range.from,date_to:range.to,type:'EXPENSE',...(selected?.id!=null?{category_id:selected.id}:{})}),getNextPageParam:page=>page.has_more?page.offset+page.limit:undefined})
  const data=categories.data
  const currency=data?.currency??'EUR'
  const rows=(transactions.data?.pages.flatMap(page=>page.items)??[]).filter(row=>row.category_id===selected?.id)
  const total=data?.items.reduce((sum,row)=>sum+Math.round(row.amount*100),0)??0
  return <MotionDialog title={im("Explore expenses")} onClose={onClose}>
    <p className="mb-5 text-xs text-[#526259]">{t('dateRange', { from: new Intl.DateTimeFormat(getLocale()).format(new Date(`${range.from}T12:00:00`)), to: new Intl.DateTimeFormat(getLocale()).format(new Date(`${range.to}T12:00:00`)), currency })}</p>
    {selected&&<button type="button" onClick={()=>{setSelected(null);setDetail(null)}} className="mb-5 inline-flex items-center gap-2 text-sm"><ArrowLeft size={16}/>{im("All categories")}</button>}
    <div key={selected?.name??'categories'} className="motion-content">
      <div className="mb-6 rounded-2xl bg-white p-6"><p className="text-sm text-[#526259]">{selected?selected.name:im("Spending by category")}</p>{data&&<p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{money(selected ? (data?.items.find(row=>row.id===selected.id)?.amount??0) : total/100,currency)}</p>}<p className="mt-3 text-xs text-[#526259]">{selected?im("Category total in your workspace base currency."):im("Choose a category to see the transactions behind it.")}</p></div>
      {categories.isPending?<p role="status">{im("Loading expense categories…")}</p>:categories.error?<div role="alert"><p>{insightError(categories.error.message)}</p><button onClick={()=>{void categories.refetch()}} className="mt-3 underline">{im("Retry expense categories")}</button></div>:!selected?<ul className="space-y-3">
        {data?.items.filter(row=>row.amount>0).sort((a,b)=>b.amount-a.amount).map(row=><li key={row.id??'uncategorised'}><button type="button" className="group w-full rounded-2xl bg-white p-5 text-left hover:bg-[#eaf0e6]" onClick={()=>setSelected(row)}><span className="flex items-center justify-between gap-4"><span className="font-medium wrap-anywhere">{row.name}</span><span className="flex shrink-0 items-center gap-3 text-sm tabular-nums">{money(row.amount,currency)}<ChevronRight size={16}/></span></span><span className="mt-4 block h-1.5 overflow-hidden rounded-full bg-[#e6ebe3]" aria-hidden><span className="block h-full rounded-full bg-[#213d33]" style={{width:`${total?row.amount*10000/total:0}%`}}/></span></button></li>)}
        {!data?.items.some(row=>row.amount>0)&&<li className="rounded-xl border border-dashed border-[#dce4d8] p-6 text-sm text-[#526259]">{im("No expenses in this period.")}</li>}
      </ul>:<>
        <p className="mb-4 text-xs text-[#526259]">{im("Transactions show their original currencies. Select a row for its details.")}</p>
        {transactions.isPending?<p role="status">{im("Loading transactions…")}</p>:transactions.error?<div role="alert"><p>{insightError(transactions.error.message)}</p><button onClick={()=>{void transactions.refetch()}} className="mt-3 underline">{im("Retry expense transactions")}</button></div>:<ul className="space-y-3">{rows.map(row=><li key={row.transaction_id} className="rounded-2xl bg-white p-5"><button type="button" aria-expanded={detail===row.transaction_id} onClick={()=>setDetail(detail===row.transaction_id?null:row.transaction_id)} className="flex w-full items-start justify-between gap-4 text-left"><span className="min-w-0"><span className="block font-medium wrap-anywhere">{row.description||im("Expense")}</span><span className="mt-1 block text-xs text-[#526259]">{new Intl.DateTimeFormat(getLocale()).format(new Date(`${row.created_at.slice(0,10)}T12:00:00`))}</span></span><span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">{money(Number(row.amount),row.currency)}<ArrowUpRight size={14}/></span></button>{detail===row.transaction_id&&<dl className="motion-content mt-4 grid grid-cols-2 gap-2 border-t border-[#e6ebe3] pt-4 text-xs text-[#526259]"><dt>{im("Source")}</dt><dd>{im(row.source)}</dd><dt>{im("Account")}</dt><dd>#{row.account_id}</dd><dt>{im("Transaction")}</dt><dd>#{row.transaction_id}</dd><dt>{im("Status")}</dt><dd>{row.expense_id?im("Approved expense"):im("Recorded")}</dd></dl>}</li>)}</ul>}
        {!transactions.isPending&&!transactions.error&&!rows.length&&<p className="my-5 text-sm text-[#526259]">{im(transactions.hasNextPage?'No matching transactions on this page. Load more to continue.':'No matching transactions in this period.')}</p>}
        {transactions.hasNextPage&&<button type="button" disabled={transactions.isFetchingNextPage} onClick={()=>{void transactions.fetchNextPage()}} className="mt-5 w-full rounded-xl bg-[#213d33] px-5 py-3 text-sm text-white disabled:opacity-50">{transactions.isFetchingNextPage?im("Loading…"):im("Load more transactions")}</button>}
      </>}
    </div>
  </MotionDialog>
}
