import type { DateRange } from '@/features/statistics/api'
export type ReviewExport = { month: string; workspaceName: string; currency: string; income: number; expenses: number; kind: 'personal'|'business'; showAmounts: boolean; showName: boolean }
export function monthRange(month: string): DateRange|null {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1000)return null
  const [year,index]=month.split('-').map(Number)
  return {from:`${month}-01`,to:`${month}-${new Date(year,index,0).getDate()}`}
}
export const reviewMoney=(amount:number,currency:string)=>new Intl.NumberFormat('en-IE',{style:'currency',currency}).format(amount)
export function reviewLines(data: ReviewExport) {
  const net=(Math.round(data.income*100)-Math.round(data.expenses*100))/100
  const rate=data.income>0?`${(net/data.income*100).toFixed(1)}%`:null
  return ['Fotosinteze',data.month,...(data.showName?[data.workspaceName]:[]),
    data.kind==='personal'?'Your month, in perspective.':'Your business, in perspective.',
    ...(data.showAmounts?[`Income: ${reviewMoney(data.income,data.currency)}`,`Expenses: ${reviewMoney(data.expenses,data.currency)}`,`${data.kind==='personal'?'Saved / net change':'Net result'}: ${reviewMoney(net,data.currency)}`]:[]),
    rate?`${data.kind==='personal'?'Savings rate':'Net margin'}: ${rate}`:'No income recorded for this month.',
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
  ctx.fillStyle='#627168';ctx.font='24px system-ui, sans-serif';ctx.fillText('A little clarity goes a long way.',90,canvas.height-70)
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'))
  if(!blob)throw new Error('Could not create the image. Please try again.')
  downloadBlob(blob,'fotosinteze-monthly-review.png')
}
function escapeHtml(text:string){return text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}
export function printReview(data:ReviewExport) {
  const frame=document.createElement('iframe')
  frame.title='Monthly review print preview';frame.style.cssText='position:fixed;width:0;height:0;border:0;'
  frame.onload=()=>{const win=frame.contentWindow;if(!win){frame.remove();return}win.onafterprint=()=>frame.remove();win.focus();win.print();setTimeout(()=>frame.remove(),60_000)}
  frame.srcdoc=`<!doctype html><html><head><title>Fotosinteze monthly review</title><style>@page{size:A4;margin:24mm}body{font:18px/1.6 system-ui,sans-serif;color:#213d33;background:#f6f5ee}main{padding:32px}h1{font-size:42px;line-height:1.2}p{overflow-wrap:anywhere}footer{margin-top:64px;border-top:3px solid #213d33;padding-top:20px;color:#526259}</style></head><body><main>${reviewLines(data).map((line,i)=>i===1?`<h1>${escapeHtml(line)}</h1>`:`<p>${escapeHtml(line)}</p>`).join('')}<footer>A little clarity goes a long way.</footer></main></body></html>`
  document.body.append(frame)
}
