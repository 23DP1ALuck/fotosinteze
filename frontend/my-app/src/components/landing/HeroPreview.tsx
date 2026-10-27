import { pageText } from '@/i18n/pages'
import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { useId, useState } from 'react'
import { BrandMark } from '@/components/brand/BrandMark'

const money = (value: number) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'EUR' }).format(value)
const demoMoney = (value: string) => `${value.startsWith('+') ? '+ ' : value.startsWith('−') ? '− ' : ''}${money(Number(value.replace(/[^0-9.]/g, '')))}`

function toPoints(values: number[], width: number, height: number) {
  const max = 100
  const min = 20
  const range = max - min
  const step = width / (values.length - 1)

  return values.map((value, index) => ({
    x: index * step,
    y: height - ((value - min) / range) * height,
  }))
}

function toSmoothPath(values: number[], width: number, height: number) {
  const points = toPoints(values, width, height)
  if (points.length === 0) return ''

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

const revenue = [38, 42, 40, 48, 72, 68, 78, 70, 76, 84, 82, 92]
const expenses = [36, 40, 41, 44, 48, 50, 49, 52, 51, 58, 62, 68]
const chartWidth = 560
const chartHeight = 168
const revenuePath = toSmoothPath(revenue, chartWidth, chartHeight)
const expensesPath = toSmoothPath(expenses, chartWidth, chartHeight)
const areaPath = `${revenuePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`

const budgets = [
  {
    name: 'Marketing',
    spent: '€2,340',
    total: '€3,000',
    progress: 78,
    remaining: '€660 left to put your plans in motion.',
  },
  { name: 'Software', spent: '€780', total: '€1,500', progress: 52 },
  { name: 'Travel', spent: '€420', total: '€2,000', progress: 21 },
]

function HeroPreview() {
  const { t } = useTranslation('pages')
  const [kind, setKind] = useState<'personal'|'business'>('business')
  const [tab, setTab] = useState('Overview')
  const id = useId()
  const personal = kind === 'personal'
  const demoBudgets = personal ? [
    {name:'Groceries', spent:'€320', total:'€450', progress:71, remaining:'€130 left this month.'},
    {name:'Transport', spent:'€85', total:'€150', progress:57},
    {name:'Entertainment', spent:'€140', total:'€200', progress:70},
  ] : budgets
  const demoTransactions = personal ? [['Monthly salary','Income','+ €3,200.00'],['Rimi','Groceries','− €28.54'],['Spotify Premium','Subscriptions','− €10.99']] : [['Client project','Services','+ €8,400.00'],['Office rent','Office','− €1,200.00'],['Figma','Software','− €59.00']]
  function switchDemo(next:'personal'|'business') { if(next===kind)return; setKind(next); setTab('Overview') }
  return (
    <section aria-label={t('interactiveProductDemo')} className="demo-surface">
      <div className="mb-5 flex flex-wrap items-center justify-center gap-4">
        <div className="relative inline-flex rounded-full bg-[#e6ebe3] p-1" role="group" aria-label={t('demoWorkspace')}>
          <span aria-hidden className="demo-switch-indicator pointer-events-none absolute inset-y-1 left-1 w-[calc(50%_-_4px)] rounded-full bg-[#213d33] shadow-sm" style={{transform:`translateX(${personal?'0':'100'}%)`}}/>
          {(['personal','business'] as const).map(value=><button key={value} type="button" aria-label={t(value === 'personal' ? 'personalDemo' : 'businessDemo')} aria-pressed={kind===value} onClick={()=>switchDemo(value)} className={`relative z-10 rounded-full px-5 py-2 text-sm font-medium ${kind===value?'text-white':'text-[#526259]'}`}>{value==='personal'?t('personal'):t('business')}</button>)}
        </div><span className="text-xs text-[#526259]">{t('interactiveDemoSampleData')}</span>
      </div>
    <div className="overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_28px_80px_-28px_rgba(26,60,52,0.22)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eeeae0] px-5 py-4 sm:px-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#f3f2ea] px-3 py-1.5 text-sm text-[#1a2e2a]">
          <BrandMark />
          {personal ? t('personal') : 'Acme Studio'}
          <span className="text-[#627168]">/</span>
          <span>{personal ? t('personal') : t('business')}</span>
          <span className="text-[10px] text-[#627168]" aria-hidden>
            ▾
          </span>
        </div>
        <div className="flex items-center gap-4 overflow-x-auto text-sm text-[#627168] max-sm:w-full max-sm:order-3" role="tablist" aria-label={t('demoSections')}>
          {['Overview','Transactions','Budgets'].map((label,index)=><button key={label} type="button" role="tab" id={`${id}-${label}`} aria-controls={`${id}-panel`} aria-selected={tab===label} tabIndex={tab===label?0:-1} onClick={()=>setTab(label)} onKeyDown={event=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;setTab(['Overview','Transactions','Budgets'][next]);(event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus()}} className={`whitespace-nowrap border-b-2 py-2 ${tab===label?'border-[#213d33] font-medium text-[#213d33]':'border-transparent'}`}>{pageText(label, t)}</button>)}
        </div>
        <p className="hidden text-sm text-[#627168] sm:block">{t('september2026')}</p>
      </div>

      <div key={`${kind}-${tab}`} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="motion-content flex min-h-[480px] flex-col gap-6 px-5 py-8 sm:px-6">
        {tab === 'Overview' ? <>
        <h2 className="m-0 text-[1.65rem] leading-snug font-medium tracking-tight text-[#1a2e2a]">
          {personal ? t('aLittleClarityForYourEveryday') : t('aLittleClarityGoesALongWay')}
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-sm text-[#627168]">{personal ? t('incomeThisMonth') : t('totalRevenue')}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              {personal ? money(3200) : money(12450)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-sm text-[#627168]">{personal ? t('expensesThisMonth') : t('totalExpenses')}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              {personal ? money(1842.35) : money(7820)}
            </p>
          </div>
          <div className="rounded-2xl bg-[#d8ee63] px-5 py-4">
            <p className="text-sm text-[#3d4a28]">{personal ? t('saved424SavingsRate') : t('netProfit372Margin')}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              {personal ? money(1357.65) : money(4630)}
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-2xl border border-[#f0eee6] px-5 py-4">
            <p className="text-lg font-medium tracking-tight text-[#1a2e2a]">
              {t('moneyInMoneyOut')}
            </p>
            <div className="mt-3 flex items-center gap-4 text-xs text-[#627168]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#1a3c34]" />
                {personal ? t('income') : t('revenue')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#c5c07a]" />
                {t('expenses')}
              </span>
            </div>
            <div className="mt-4" aria-hidden>
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="h-40 w-full overflow-visible sm:h-44"
                preserveAspectRatio="none"
              >
                {[0.25, 0.5, 0.75].map((line) => (
                  <line
                    key={line}
                    x1="0"
                    x2={chartWidth}
                    y1={chartHeight * line}
                    y2={chartHeight * line}
                    stroke="#ece9df"
                    strokeWidth="1"
                  />
                ))}
                <path d={areaPath} fill="#1a3c34" opacity="0.08" />
                <path
                  d={revenuePath}
                  fill="none"
                  stroke="#1a3c34"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={expensesPath}
                  fill="none"
                  stroke="#b7b36a"
                  strokeWidth="2"
                  strokeDasharray="5 6"
                  strokeLinecap="round"
                />
              </svg>
              <div className="mt-2 flex justify-between text-[11px] tracking-wide text-[#627168] uppercase">
                <span>{t('jun')}</span>
                <span>{t('jul')}</span>
                <span>{t('aug')}</span>
                <span>{t('sep')}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#f3f2ea] px-5 py-4">
            <p className="text-lg font-medium tracking-tight text-[#1a2e2a]">
              {t('everyBudgetInView')}
            </p>
            <ul className="mt-5 space-y-4">
              {demoBudgets.map((budget) => (
                <li key={budget.name}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-[#1a2e2a]">{pageText(budget.name, t)}</span>
                    <span className="text-[#627168]">
                      {demoMoney(budget.spent)} / {demoMoney(budget.total)}
                    </span>
                  </div>
                  {budget.remaining ? (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e2d8]">
                        <div
                          className="h-full rounded-full bg-[#1a3c34]"
                          style={{ width: `${budget.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[#627168]">{pageText(budget.remaining, t)}</p>
                    </>
                  ) : (
                    <div className="mt-3 h-px bg-[#e6e3d8]" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        </> : tab === 'Transactions' ? <>
          <h2 className="text-2xl font-medium tracking-tight text-[#213d33]">{t('everyTransactionInItsPlace')}</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-[#526259]"><tr><th className="py-4">{t('transaction')}</th><th className="py-4">{t('category')}</th><th className="py-4 text-right">{t('amount')}</th></tr></thead><tbody>{demoTransactions.map(row=><tr key={row[0]} className="border-t border-[#e6ebe3]"><td className="py-5 pr-4 font-medium">{pageText(row[0], t)}</td><td className="py-5 pr-4 text-[#526259]">{pageText(row[1], t)}</td><td className="py-5 text-right whitespace-nowrap tabular-nums">{demoMoney(row[2])}</td></tr>)}</tbody></table></div><p className="mt-auto text-xs text-[#526259]">{t('illustrativeTransactionsYourActualFinancesStayInYourWorkspace')}</p>
        </> : <>
          <h2 className="text-2xl font-medium tracking-tight text-[#213d33]">{t('everyBudgetInView')}</h2>
          <ul className="space-y-4">{demoBudgets.map(budget=><li key={budget.name} className="rounded-2xl bg-[#f3f2ea] p-5"><div className="flex flex-wrap justify-between gap-3 text-sm"><span className="font-medium">{pageText(budget.name, t)}</span><span className="text-[#526259]">{demoMoney(budget.spent)} / {demoMoney(budget.total)}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e4e2d8]"><div className="h-full rounded-full bg-[#213d33]" style={{width:`${budget.progress}%`}}/></div><p className="mt-3 text-xs text-[#526259]">{t('usedPercent', { percent: new Intl.NumberFormat(getLocale(), { style: 'percent' }).format(budget.progress / 100) })}</p></li>)}</ul>
        </>}
      </div>
    </div>
    </section>
  )
}

export { HeroPreview }
