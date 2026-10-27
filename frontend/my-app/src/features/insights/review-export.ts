import i18n, { getLocale } from '@/i18n'
import { insightMessage as im } from '@/i18n/insight-message'
import type { DateRange } from '@/features/statistics/api'
export type ReviewExport = { month: string; workspaceName: string; currency: string; income: number; expenses: number; kind: 'personal'|'business'; details?: string[] }
export function monthRange(month: string): DateRange|null {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1000)return null
  const [year,index]=month.split('-').map(Number)
  return {from:`${month}-01`,to:`${month}-${new Date(year,index,0).getDate()}`}
}
export const reviewMoney=(amount:number,currency:string)=>new Intl.NumberFormat(getLocale(),{style:'currency',currency}).format(amount)
export function reviewLines(data: ReviewExport) {
  const net=(Math.round(data.income*100)-Math.round(data.expenses*100))/100
  const rate=data.income>0?new Intl.NumberFormat(getLocale(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(net / data.income):null
  return ['Fotosinteze',data.month,data.workspaceName,
    data.kind==='personal'?im('Your month, in perspective.'):im('Your business, in perspective.'),
    ...[`${im('Income')}: ${reviewMoney(data.income,data.currency)}`,`${im('Expenses')}: ${reviewMoney(data.expenses,data.currency)}`,`${data.kind==='personal'?im('Saved / net change'):im('Net result')}: ${reviewMoney(net,data.currency)}`],
    ...(!data.income&&!data.expenses?[im('No financial activity recorded this month.')]:[]),
    rate?`${data.kind==='personal'?im('Savings rate'):im('Net margin')}: ${rate}`:`${data.kind==='personal'?im('Savings rate'):im('Net margin')}: —`,
    rate?im('Of income recorded this month.'):im('No income recorded this month.'),
    ...(data.details??[]),
  ]
}
export function downloadBlob(blob:Blob,filename:string) {
  const url=URL.createObjectURL(blob)
  const link=document.createElement('a');link.href=url;link.download=filename;link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export async function exportReviewPng(data:ReviewExport) {
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=Math.max(1000,reviewLines(data).length*100+400)
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable in this browser.')
  ctx.fillStyle='#f6f5ee';ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.fillStyle='#213d33';ctx.beginPath();ctx.arc(112,115,25,0,Math.PI*2);ctx.strokeStyle='#213d33';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(112,115,25,0,Math.PI);ctx.fill()
  let y=200
  for(const [i,line] of reviewLines(data).entries()) {
    ctx.fillStyle=i===0?'#213d33':'#526259'
    ctx.font=`${i<2?'600':'400'} ${i===1?58:i===0?34:30}px system-ui, sans-serif`
    // Wrap long workspace names without truncating the exported identity.
    const words=line.split(' ');let part=''
    for(const word of words){const next=part?`${part} ${word}`:word;if(ctx.measureText(next).width>1080&&part){ctx.fillText(part,90,y,1080);y+=48;part=word}else part=next}
    ctx.fillText(part,90,y,1080);y+=i<2?110:78
  }
  ctx.fillStyle='#d9f27a';ctx.fillRect(90,canvas.height-160,1100,8)
  ctx.fillStyle='#627168';ctx.font='24px system-ui, sans-serif';ctx.fillText(im('A little clarity goes a long way.'),90,canvas.height-70)
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'))
  if(!blob)throw new Error('Could not create the image. Please try again.')
  downloadBlob(blob,'fotosinteze-monthly-review.png')
}
function escapeHtml(text:string){return text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}
export function printReview(data:ReviewExport) {
  const frame=document.createElement('iframe')
  frame.title=im('Monthly review print preview');frame.style.cssText='position:fixed;width:0;height:0;border:0;'
  frame.onload=()=>{const win=frame.contentWindow;if(!win){frame.remove();return}win.onafterprint=()=>frame.remove();win.focus();win.print();setTimeout(()=>frame.remove(),60_000)}
  frame.srcdoc=`<!doctype html><html lang="${i18n.resolvedLanguage ?? 'en'}"><head><title>${escapeHtml(im('Fotosinteze monthly review'))}</title><style>@page{size:A4;margin:24mm}body{font:18px/1.6 system-ui,sans-serif;color:#213d33;background:#f6f5ee}main{padding:32px}h1{font-size:42px;line-height:1.2}p{overflow-wrap:anywhere}footer{margin-top:64px;border-top:3px solid #213d33;padding-top:20px;color:#526259}</style></head><body><main>${reviewLines(data).map((line,i)=>i===1?`<h1>${escapeHtml(line)}</h1>`:`<p>${escapeHtml(line)}</p>`).join('')}<footer>${escapeHtml(im('A little clarity goes a long way.'))}</footer></main></body></html>`
  document.body.append(frame)
}
