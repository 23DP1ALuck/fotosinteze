import { useState } from 'react'
import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, RefreshCw } from 'lucide-react'
import { ChartTransactionsDialog } from '@/features/insights/ChartTransactionsDialog'
import { chartTooltipStyle, dashboardChartRange, type ChartGroup, type ChartSelection } from '@/features/insights/chart-details'
import { ChartAction } from '@/features/insights/chart-interactions'
import type { SpendingGroup } from '@/features/transactions/api'
import type { WorkspaceFinance } from '@/features/transactions/use-workspace-finance'

const card = 'min-w-0 rounded-2xl bg-white p-6 max-sm:p-4'
const colors = ['#193f33', '#60815b', '#98a56c', '#b2ce82', '#d5f579', '#dce4d8']
const money = (value: number | string, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(Number(value))
const compactMoney = (value: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
const retryButton = 'mt-3 rounded-xl bg-[#eaf0e6] px-4 py-2 text-sm text-[#193f33] hover:bg-[#dce6d4]'

function SpendingChart({ dimension, groups, currency, onSelect }: { onSelect: (group: ChartGroup, amount: number) => void; dimension: 'category' | 'department' | 'project'; groups: SpendingGroup[]; currency: string }) {
  const { t } = useTranslation('finance')
  const title = t(dimension === 'category' ? 'spendingByCategory' : dimension === 'department' ? 'spendingByDepartment' : 'spendingByProject')
  const sorted = groups.filter(group => Number(group.amount) > 0).sort((left, right) => Number(right.amount) - Number(left.amount) || left.name.localeCompare(right.name))
  const head = sorted.slice(0, 5).map(group => ({ name: group.name, amount: Number(group.amount), key: String(group.id), ids: [group.id] }))
  const remainder = sorted.slice(5).reduce((cents, group) => cents + Math.round(Number(group.amount) * 100), 0) / 100
  const data = remainder > 0 ? [...head, { name: t(dimension === 'category' ? 'otherCategories' : dimension === 'department' ? 'otherDepartments' : 'otherProjects'), amount: remainder, key: 'remaining', ids: sorted.slice(5).map(group => group.id) }] : head
  function select(index: number) {
    const item = data[index]
    if (item) onSelect({ dimension, ids: item.ids, name: item.name }, item.amount)
  }
  const total = sorted.reduce((cents, group) => cents + Math.round(Number(group.amount) * 100), 0) / 100
  return <section className={card} aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold!">{title}</h2><p className="mt-2 text-xs text-[#627168]">{f('Current month')} · {currency}</p></div>{data.length > 0 && <span className="rounded-lg bg-[#eaf0e6] px-3 py-2 text-xs tabular-nums">{money(total, currency)}</span>}</div>
    {!data.length ? <div className="mt-6 grid min-h-[210px] place-items-center rounded-xl border border-dashed border-[#dce4d8] p-6 text-center"><p className="text-sm text-[#627168]">{t(dimension === 'category' ? 'noCategorySpending' : dimension === 'department' ? 'noDepartmentSpending' : 'noProjectSpending')}</p></div> : <>
      <div className="interactive-chart mt-5 h-[230px] min-w-0" role="img" aria-label={t('chartSummary', { title, count: sorted.length, total: money(total, currency) })}>
        <ResponsiveContainer width="100%" height="100%">
          {dimension === 'category' ? <PieChart accessibilityLayer={false}><Pie cursor="pointer" onClick={(_, index) => select(index)} data={data} dataKey="amount" nameKey="name" innerRadius="52%" outerRadius="85%" paddingAngle={3} stroke="none" isAnimationActive={false}>{data.map((item, index) => <Cell key={item.key} fill={colors[index % colors.length]} />)}</Pie><Tooltip cursor={false} shared={false} formatter={value => money(Number(value), currency)} contentStyle={chartTooltipStyle} /></PieChart> : <BarChart data={data} layout="vertical" accessibilityLayer={false} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e1e5df" /><XAxis type="number" axisLine={false} tickLine={false} tickFormatter={value => compactMoney(Number(value), currency)} tick={{ fill: '#7d877f', fontSize: 10 }} /><YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tickFormatter={value => String(value).length > 17 ? `${String(value).slice(0, 16)}…` : String(value)} tick={{ fill: '#68796e', fontSize: 11 }} /><Tooltip cursor={false} shared={false} formatter={value => money(Number(value), currency)} contentStyle={chartTooltipStyle} /><Bar cursor="pointer" activeBar={false} onClick={(_, index) => select(index)} dataKey="amount" name={f("Spending")} fill="#60815b" radius={[0, 6, 6, 0]} maxBarSize={24} isAnimationActive={false} /></BarChart>}
        </ResponsiveContainer>
      </div>
      <ul aria-label={t('chartValues', { title })} className="mt-4 grid gap-3">{data.map((item, index) => <li key={item.key}><button type="button" onClick={() => select(index)} aria-label={`View ${item.name} expenses`} className="flex w-full items-start justify-between gap-4 rounded-xl px-3 py-2 text-left text-xs hover:bg-[#eaf0e6]"><span className="flex min-w-0 items-start gap-2 text-[#526259]"><span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: dimension === 'category' ? colors[index % colors.length] : '#60815b' }} /><span className="wrap-anywhere">{item.name}</span></span><span className="shrink-0 font-medium tabular-nums">{money(item.amount, currency)} ↗</span></button></li>)}</ul>
      {sorted.length > 5 && <details className="mt-5 border-t border-[#e1e5df] pt-4 text-xs"><summary className="cursor-pointer text-[#526259]">{t(dimension === 'category' ? 'viewAllCategories' : dimension === 'department' ? 'viewAllDepartments' : 'viewAllProjects', { count: sorted.length })}</summary><div className="mt-3 overflow-x-auto"><table aria-label={t(dimension === 'category' ? 'allCategorySpending' : dimension === 'department' ? 'allDepartmentSpending' : 'allProjectSpending')} className="w-full text-left"><thead><tr><th className="py-2 font-medium">{f(dimension === 'category' ? 'Category' : dimension === 'department' ? 'Department' : 'Project')}</th><th className="py-2 text-right font-medium">{f("Spent")}</th></tr></thead><tbody>{sorted.map(item => <tr key={item.id ?? 'unassigned'} className="border-t border-[#e1e5df]"><td className="py-2 pr-4 wrap-anywhere"><button type="button" onClick={() => onSelect({ dimension, ids: [item.id], name: item.name }, Number(item.amount))} className="rounded-lg p-2 text-left underline decoration-[#dce4d8] underline-offset-4 hover:bg-[#eaf0e6]">{item.name} ↗</button></td><td className="py-2 text-right tabular-nums">{money(item.amount, currency)}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>
}

export function BusinessDashboard({ finance, workspaceName, role, onViewTransactions, onExploreExpenses, showRecent = true }: {
  finance: WorkspaceFinance; workspaceName: string; role: 'OWNER' | 'EMPLOYEE'; onViewTransactions: () => void; onExploreExpenses?: () => void; showRecent?: boolean
}) {
  const { t } = useTranslation('finance')
  const [selection, setSelection] = useState<ChartSelection | null>(null)
  const data = finance.dashboard && 'revenue' in finance.dashboard ? finance.dashboard : undefined
  function openComparison(index: number) {
    if (data) setSelection({ type: index === 0 ? 'INCOME' : 'EXPENSE', range: dashboardChartRange(data.period_start, data.period_end), amount: Number(index === 0 ? data.revenue : data.expenses), currency: data.currency })
  }
  function openSpending(group: ChartGroup, amount: number) {
    if (data) setSelection({ type: 'EXPENSE', range: dashboardChartRange(data.period_start, data.period_end), amount, currency: data.currency, group })
  }
  const error = finance.dashboardError || (finance.dashboard && !data ? 'The server returned unexpected business dashboard data. Please retry.' : '')
  const recent = finance.transactions.slice(0, 5)
  const period = data ? new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(new Date(`${data.period_start}T12:00:00`)) : f('Current month')
  const empty = data && Number(data.revenue) === 0 && Number(data.expenses) === 0 && Number(data.profit) === 0 && !data.spending_by_category.some(item => Number(item.amount) > 0) && !data.spending_by_department.some(item => Number(item.amount) > 0) && !data.spending_by_project.some(item => Number(item.amount) > 0)
  return <div aria-label={t('businessDashboard', { name: workspaceName })} className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3 text-xs text-[#526259]"><span>{period}{data ? ` · ${data.currency}` : ''}</span><span className="rounded-full bg-[#eaf0e6] px-3 py-1">{role === 'EMPLOYEE' ? f("Your department") : f("Workspace overview")}</span></div><button type="button" disabled={finance.dashboardRefreshing} onClick={finance.refresh} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs disabled:opacity-50"><RefreshCw size={14} className={finance.dashboardRefreshing ? 'animate-spin motion-reduce:animate-none' : ''} />{f("Refresh dashboard")}</button></div>
    {role === 'EMPLOYEE' && <p className="text-xs text-[#526259]">{f("Figures reflect your assigned department.")}</p>}
    {finance.dashboardLoading ? <div role="status" aria-label={f("Loading business dashboard")}><p className="mb-4 text-sm text-[#526259]">{f("Loading your business overview…")}</p><div aria-hidden className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">{[1, 2, 3].map(item => <div key={item} className="h-36 animate-pulse rounded-2xl bg-white motion-reduce:animate-none" />)}</div></div> : error ? <div className="rounded-2xl bg-[#fcf0ed] p-6"><p role="alert" className="text-sm text-[#a43b32]">{f(error, true)}</p><button type="button" onClick={finance.retryDashboard} className={retryButton}>{f("Retry dashboard")}</button></div> : data && <>
      <section aria-label={f("Business monthly overview")} className="grid grid-cols-3 gap-5 max-[900px]:grid-cols-1">
        {[
          { label: 'Revenue', value: data.revenue, note: f("Income recorded this month"), icon: ArrowUpRight },
          { label: 'Expenses', value: data.expenses, note: f("Spending recorded this month"), icon: ArrowDownLeft },
          { label: 'Profit', value: data.profit, note: Number(data.revenue) > 0 ? t('profitMargin', { percent: new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(Number(data.profit) / Number(data.revenue)) }) : f("Revenue less expenses"), icon: ChartNoAxesCombined },
        ].map(item => <article key={item.label} aria-label={f(item.label)} className={`min-w-0 rounded-2xl px-6 py-5 ${item.label === 'Profit' ? Number(data.profit) < 0 ? 'bg-[#fae8e5]' : 'bg-[#d5f579]' : 'bg-white'}`}><div className="flex items-center justify-between gap-3"><p className="text-sm text-[#526259]">{f(item.label)}</p><item.icon size={18} className="shrink-0 text-[#60815b]" /></div><strong className={`mt-4 block wrap-anywhere text-[clamp(25px,2.4vw,38px)] font-semibold tracking-tight tabular-nums ${item.label === 'Profit' && Number(data.profit) < 0 ? 'text-[#a43b32]' : ''}`}>{item.label === 'Expenses' && onExploreExpenses ? <button type="button" aria-label={f("Explore business expenses")} onClick={onExploreExpenses} className="text-left underline decoration-[#dce4d8] underline-offset-8 hover:decoration-[#213d33]">{money(item.value, data.currency)}<span aria-hidden className="ml-2 text-base">↗</span></button> : money(item.value, data.currency)}</strong><p className="mt-3 text-xs text-[#526259]">{f(item.note)}</p></article>)}
      </section>
      {empty && <div className="rounded-2xl border border-[#dce4d8] bg-[#eaf0e6] p-6"><h2 className="text-lg font-semibold!">{f("No financial activity this month")}</h2><p className="mt-2 text-sm text-[#526259]">{t('startBusinessActivity', { name: workspaceName })}</p></div>}
      <div className="grid grid-cols-2 items-start gap-6 max-[1100px]:grid-cols-1">
        <section className={card} aria-label={f("Revenue and expenses comparison")}><h2 className="text-lg font-semibold!">{f("Revenue & expenses")}</h2><p className="mt-2 text-xs text-[#627168]">{period} · {data.currency}</p>
          {Number(data.revenue) === 0 && Number(data.expenses) === 0 ? <div className="mt-6 grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[#dce4d8] p-6 text-center text-sm text-[#627168]">{f("No revenue or expenses recorded this period.")}</div> : <div className="interactive-chart mt-6 h-[280px] min-w-0" role="img" aria-label={t('revenueComparison', { revenue: money(data.revenue, data.currency), expenses: money(data.expenses, data.currency), period })}><ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer={false} data={[{ name: f("Revenue"), amount: Number(data.revenue) }, { name: f("Expenses"), amount: Number(data.expenses) }]} margin={{ left: 0, right: 12 }}><CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#68796e', fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} width={66} tickFormatter={value => compactMoney(Number(value), data.currency)} tick={{ fill: '#7d877f', fontSize: 10 }} /><Tooltip cursor={false} shared={false} formatter={(value, _name, item) => [money(Number(value), data.currency), String(item.payload.name)]} contentStyle={chartTooltipStyle} /><Bar cursor="pointer" activeBar={false} onClick={(_, index) => openComparison(index)} dataKey="amount" name={f("Amount")} radius={[8, 8, 0, 0]} maxBarSize={72} isAnimationActive={false}><Cell fill="#193f33" /><Cell fill="#98a56c" /></Bar></BarChart></ResponsiveContainer></div>}
          <div className="mt-3 flex flex-wrap gap-2"><ChartAction label="View revenue transactions" onClick={() => openComparison(0)} /><ChartAction label="View expense transactions" onClick={() => openComparison(1)} /></div>
        </section>
        <SpendingChart dimension="category" groups={data.spending_by_category} currency={data.currency} onSelect={openSpending} />
        <SpendingChart dimension="department" groups={data.spending_by_department} currency={data.currency} onSelect={openSpending} />
        <SpendingChart dimension="project" groups={data.spending_by_project} currency={data.currency} onSelect={openSpending} />
      </div>
    </>}
    {showRecent && <section className={card} aria-label={f("Recent business transactions")} aria-busy={finance.transactionsRefreshing}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold!">{f("Recent transactions")}</h2><button type="button" onClick={onViewTransactions} className="text-xs text-[#193f33] hover:underline">{f("View all transactions")}</button></div>
      <p className="mt-2 text-xs text-[#627168]">{f("The latest five transactions in this workspace, across all dates and account currencies.")}</p>
      {finance.transactionsLoading ? <p role="status" className="mt-6 text-sm text-[#526259]">{f("Loading recent transactions…")}</p> : finance.transactionsError ? <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{f(finance.transactionsError, true)}</p><button type="button" onClick={finance.retryTransactions} className={retryButton}>{f("Retry transactions")}</button></div> : <>
        {finance.metadataError && <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#526259]"><p>{f("Some transaction labels are unavailable.")}</p><button type="button" onClick={finance.retryMetadata} className="underline">{f("Retry transaction labels")}</button></div>}
        {!recent.length ? <p className="mt-6 rounded-xl border border-dashed border-[#dce4d8] p-8 text-center text-sm text-[#627168]">{f("No transactions yet.")}</p> : <div className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left whitespace-nowrap text-xs [&_th]:border-b [&_th]:border-[#dce4d8] [&_th]:pb-3 [&_th]:pr-5 [&_th]:text-[10px] [&_th]:font-medium [&_th]:text-[#627168] [&_th]:uppercase [&_td]:border-b [&_td]:border-[#e1e5df] [&_td]:py-4 [&_td]:pr-5"><thead><tr>{[f("Transaction"), f("Category"), f("Department"), f("Project"), f("Date"), f("Amount")].map(label => <th key={f(label)} scope="col">{f(label)}</th>)}</tr></thead><tbody>{recent.map(item => <tr key={item.id}><td className="font-medium">{item.name}</td><td className="text-[#526259]">{item.category}</td><td className="text-[#526259]">{item.department || (item.departmentId ? t('departmentId', { id: item.departmentId }) : f("Unassigned"))}</td><td className="text-[#526259]">{item.project || (item.projectId ? t('projectId', { id: item.projectId }) : f("Unassigned"))}</td><td className="text-[#526259]">{new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${item.date}T12:00:00`))}</td><td className="text-right font-medium tabular-nums">{item.type === 'income' ? '+' : ''}{money(item.amount, item.currency ?? data?.currency ?? 'EUR')}</td></tr>)}</tbody></table></div>}
      </>}
    </section>}
    {data && selection && <ChartTransactionsDialog key={JSON.stringify(selection)} workspaceId={data.workspace_id} selection={selection} onClose={() => setSelection(null)} />}
  </div>
}
