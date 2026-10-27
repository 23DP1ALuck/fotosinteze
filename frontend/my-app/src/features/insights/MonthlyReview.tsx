import { useTranslation } from 'react-i18next'
import { getLocale } from '@/i18n'
import { insightMessage as im, insightError } from '@/i18n/insight-message'
import { DateInput } from '@/components/calendar/DateInput'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, Printer } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { currentMonth, loadMetric, type DateRange, type MetricKind } from '@/features/statistics/api'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { exportReviewPng, monthRange, printReview, reviewLines, reviewMoney, type ReviewExport } from './review-export'
function useReviewMetric<K extends MetricKind>(workspaceId:number,kind:K,range:DateRange|null){return useQuery({queryKey:[...workspaceQueryKey('statistics',workspaceId),kind,range?.from,range?.to],queryFn:({signal})=>loadMetric(kind,workspaceId,range!,signal),enabled:range!==null})}
export function MonthlyReview(props:{workspaceId:number;workspaceName:string;kind:'personal'|'business';role?:'OWNER'|'EMPLOYEE';initialMonth?:string}) {
  return <Review key={`${props.workspaceId}:${props.role}`} {...props}/>
}
function Review({workspaceId,workspaceName,kind,role,initialMonth}:{workspaceId:number;workspaceName:string;kind:'personal'|'business';role?:'OWNER'|'EMPLOYEE';initialMonth?:string}) {
  const { t } = useTranslation('insights')
  const [month,setMonth]=useState(initialMonth??currentMonth().from.slice(0,7))
  const [showAmounts,setShowAmounts]=useState(false)
  const [showName,setShowName]=useState(false)
  const [exporting,setExporting]=useState(false)
  const [message,setMessage]=useState('')
  const range=monthRange(month)
  const previous=range?new Date(`${range.from}T12:00:00`):null
  previous?.setMonth(previous.getMonth()-1)
  const previousRange=previous?monthRange(`${previous.getFullYear()}-${String(previous.getMonth()+1).padStart(2,'0')}`):null
  const summary=useReviewMetric(workspaceId,'summary',range)
  const categories=useReviewMetric(workspaceId,'categories',range)
  const comparison=useReviewMetric(workspaceId,'summary',previousRange)
  const data=summary.data
  const title=range?new Intl.DateTimeFormat(getLocale(),{month:'long',year:'numeric'}).format(new Date(`${range.from}T12:00:00`)):im("Choose a month")
  const net=data?(Math.round(data.income*100)-Math.round(data.expenses*100))/100:0
  const rate=data&&data.income>0?net/data.income*100:null
  const payload:ReviewExport|undefined=data&&range?{month:title,workspaceName,currency:data.currency,income:data.income,expenses:data.expenses,kind,showAmounts,showName}:undefined
  const top=categories.data?.currency===data?.currency?categories.data?.items.filter(row=>row.amount>0).sort((a,b)=>b.amount-a.amount)[0]:undefined
  async function download(){if(!payload)return;setExporting(true);setMessage('');try{await exportReviewPng(payload);setMessage('Your review image is ready.')}catch(error){setMessage(error instanceof Error?error.message:'Could not export review.')}finally{setExporting(false)}}
  return <section aria-label={im("Monthly review")} className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-6"><div><h2 className="text-xl font-semibold!">{im("Your month, clearly told.")}</h2><p className="mt-2 text-sm text-[#526259]">{role==='EMPLOYEE'?im("Figures reflect your assigned department."):im("A quiet moment to see the whole picture.")}{' '}{im("Figures use your workspace base currency.")}</p></div><label className="grid gap-2 text-xs text-[#526259]">{im("Review month")}<DateInput calendarLabel={im("Review month")} type="month" min="1000-01" max="9999-12" value={month} onChange={event=>{setMonth(event.target.value);setMessage('')}} className="rounded-xl border border-[#dce4d8] bg-[#f7f8f2] px-3 py-3 text-sm text-[#213d33]"/></label></div>
    {!range?<p role="alert">{im("Choose a valid review month.")}</p>:summary.isPending?<p role="status">{im("Preparing your monthly review…")}</p>:summary.error?<div className="rounded-2xl bg-white p-6" role="alert"><p>{insightError(summary.error.message)}</p><button type="button" onClick={()=>{void summary.refetch()}} className="mt-3 underline">{im("Retry monthly review")}</button></div>:data&&payload?<div className="grid items-start gap-6 min-[1250px]:grid-cols-[1.4fr_1fr]">
      <article key={month} className="motion-content min-w-0 rounded-2xl bg-white p-7 max-sm:p-5"><p className="text-xs tracking-[.14em] text-[#526259] uppercase">{im("Monthly review")}</p><h3 className="mt-5 text-4xl font-semibold tracking-tight max-sm:text-3xl">{title}</h3><p className="mt-3 text-sm text-[#526259]">{kind==='personal'?(net>=0?im("A little more room for your plans."):im("A month to review and understand.")):im("Your business, in perspective.")}</p>
        <dl className="my-8 grid grid-cols-3 gap-4 border-y border-[#e6ebe3] py-7 max-sm:grid-cols-1">{[[im("Income"),data.income],[im("Expenses"),data.expenses],[kind==='personal'?im("Saved / net change"):im("Net result"),net]].map(([label,value])=><div key={label}><dt className="text-xs text-[#526259]">{label}</dt><dd className="mt-3 wrap-anywhere text-[clamp(20px,1.8vw,30px)] font-semibold tabular-nums">{reviewMoney(Number(value),data.currency)}</dd></div>)}</dl>
        {!data.income&&!data.expenses&&<p className="mb-6 text-sm text-[#526259]">{im("No financial activity recorded this month.")}</p>}
        <div className="rounded-2xl bg-[#f3f5ee] p-5"><p className="text-sm text-[#526259]">{kind==='personal'?im("Savings rate"):im("Net margin")}</p><p className="mt-3 text-3xl font-semibold">{rate===null?'—':new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(rate / 100)}</p><p className="mt-2 text-xs text-[#526259]">{rate===null?im("No income recorded this month."):im("Of income recorded this month.")}</p></div>
        <h4 className="mt-7 font-medium">{im("The details that matter")}</h4>
        {categories.isPending?<p role="status" className="mt-3 text-sm">{im("Loading category details…")}</p>:categories.error?<div className="mt-3 text-sm" role="alert"><p>{im("Category details are unavailable.")}</p><button className="mt-2 underline" onClick={()=>{void categories.refetch()}}>{im("Retry review categories")}</button></div>:top?<p className="mt-3 text-sm text-[#526259]">{t('topCategory', { name: top.name, amount: reviewMoney(top.amount,data.currency) })}</p>:<p className="mt-3 text-sm text-[#526259]">{im("No category spending to show.")}</p>}
        {comparison.data&&comparison.data.currency===data.currency?<p className="mt-3 text-sm text-[#526259]">{t(data.expenses>=comparison.data.expenses?'moreExpenses':'lessExpenses', { amount: reviewMoney(Math.abs(data.expenses-comparison.data.expenses),data.currency) })}</p>:<p className="mt-3 text-xs text-[#627168]">{comparison.isPending?im("Loading previous month comparison…"):im("Previous month comparison unavailable.")}</p>}
      </article>
      <aside className="min-w-0 rounded-2xl bg-white p-6"><h3 className="text-sm font-medium">{im("Your export preview")}</h3><div role="region" aria-label={im("Export preview")} className="my-5 rounded-2xl border border-[#e6e3d8] bg-[#f6f5ee] p-6"><div className="mb-7 flex items-center gap-2 text-sm font-semibold"><BrandMark/>Fotosinteze</div>{reviewLines(payload).slice(1).map((line,i)=><p key={i} className={i===0?'mb-6 text-3xl font-semibold tracking-tight':'mt-4 wrap-anywhere text-sm text-[#526259]'}>{line}</p>)}<div className="mt-8 h-1.5 rounded-full bg-[#d9f27a]" aria-hidden/></div>
        <div className="space-y-4 border-t border-[#e6ebe3] pt-5">{[{label:im("Show exact amounts"),value:showAmounts,set:setShowAmounts},{label:im("Include workspace name"),value:showName,set:setShowName}].map(option=><label key={option.label} className="flex items-center justify-between gap-4 text-sm"><span>{option.label}</span><span className="relative inline-flex shrink-0"><input type="checkbox" checked={option.value} onChange={event=>option.set(event.target.checked)} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"/><span aria-hidden className="review-toggle block h-6 w-11 rounded-full bg-[#dce4d8] peer-checked:bg-[#213d33] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[#213d33]"><span className={`review-toggle-thumb absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm ${option.value?'translate-x-5':'translate-x-0'}`}/></span></span></label>)}</div>
        <button type="button" onClick={()=>{void download()}} disabled={exporting} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#213d33] px-4 py-3 text-sm text-white disabled:opacity-50"><ArrowDownToLine size={16}/>{exporting?im("Preparing image…"):im("Download image")}</button><button type="button" onClick={()=>printReview(payload)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dce4d8] px-4 py-3 text-sm"><Printer size={16}/>{im("Print / save PDF")}</button>
        <p className="mt-4 text-xs leading-relaxed text-[#526259]">{im("Only the previewed information is exported. Nothing is published automatically.")}</p>{message&&<p role="status" className="mt-4 text-sm">{insightError(message)}</p>}
      </aside>
    </div>:null}
  </section>
}
