import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { DateInput } from '@/components/calendar/DateInput'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RefreshCw } from 'lucide-react'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { currentMonth, loadMetric, rangeError, type DateRange, type MetricKind } from './api'

const colors = ['#193f33', '#60815b', '#98a56c', '#b2ce82', '#d5f579', '#a8b9a5']
const button = 'rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const money = (amount: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amount)
const shortMoney = (amount: number, currency: string) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount)
const dateLabel = (date: string) => new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
const tooltipStyle = { borderRadius: 12, borderColor: '#dce4d8' }
function useMetric<K extends MetricKind>(kind: K, workspaceId: number, range: DateRange) {
  return useQuery({ queryKey: [...workspaceQueryKey('statistics', workspaceId), kind, range.from, range.to], queryFn: ({ signal }) => loadMetric(kind, workspaceId, range, signal) })
}
function ChartCard({ title, loading, error, retry, empty, children, wide }: { title: string; loading: boolean; error: string; retry: () => void; empty?: string; children?: ReactNode; wide?: boolean }) {
  const { t } = useTranslation('finance')
  return <section aria-label={f(title)} className={`min-w-0 rounded-2xl bg-white p-6 max-sm:p-4 ${wide ? 'lg:col-span-2' : ''}`}>
    <h2 className="text-lg font-semibold!">{f(title)}</h2>
    {loading ? <div role="status" className="mt-6 grid min-h-[260px] place-items-center rounded-xl bg-[#f7f8f2] text-sm text-[#526259]">{t('loadingChart', { title })}</div> : error ? <div className="mt-6 rounded-xl bg-[#fcf0ed] p-5"><p role="alert" className="text-sm text-[#a43b32]">{f(error, true)}</p><button type="button" onClick={retry} className="mt-3 rounded-xl bg-[#eaf0e6] px-4 py-2 text-sm" aria-label={t('retryChart', { title: title.toLocaleLowerCase(getLocale()) })}>{f("Retry")}</button></div> : empty ? <div className="mt-6 grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[#dce4d8] p-6 text-center text-sm text-[#526259]">{f(empty)}</div> : children}
  </section>
}
export function Statistics({ workspaceId, role }: { workspaceId: number; role?: 'OWNER' | 'EMPLOYEE' }) {
  const { t } = useTranslation('finance')
  const calendarId = useId()
  const [range, setRange] = useState(currentMonth)
  const [draft, setDraft] = useState(range)
  const [validation, setValidation] = useState('')
  const summary = useMetric('summary', workspaceId, range)
  const categories = useMetric('categories', workspaceId, range)
  const timeseries = useMetric('timeseries', workspaceId, range)
  const queries = [summary, categories, timeseries]
  const totals = summary.data
  const breakdown = categories.data
  const daily = timeseries.data
  const categoryRows = breakdown?.items.filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount) ?? []
  const pieRows = categoryRows.length > 6 ? [...categoryRows.slice(0, 5), { id: null, name: f('Other categories'), amount: categoryRows.slice(5).reduce((sum, row) => sum + row.amount, 0) }] : categoryRows
  const comparison = totals ? [{ name: f('Income'), amount: totals.income }, { name: f('Expenses'), amount: totals.expenses }] : []
  const errorText = (query: typeof summary | typeof categories | typeof timeseries) => query.error instanceof Error ? query.error.message : ''
  return <div aria-label={f("Workspace statistics")} className="space-y-6 text-[#193f33]">
    <KeyboardForm aria-label={f("Statistics period")} onSubmit={event => { event.preventDefault(); const error = rangeError(draft); setValidation(error); if (!error) setRange({ ...draft }) }} noValidate className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-5">
      <div className="mr-auto"><p className="text-sm font-medium">{f("Explore your finances")}</p><p className="mt-2 text-xs text-[#526259]">{t('inclusiveRange', { from: dateLabel(range.from), to: dateLabel(range.to) })}</p></div>
      {(['from', 'to'] as const).map(key => <label key={key} className="text-xs text-[#526259]">{key === 'from' ? f("From") : f("To")}<DateInput id={`${calendarId}-${key}`} nextCalendarId={key === 'from' ? `${calendarId}-to` : undefined} calendarLabel={key === 'from' ? f("From") : f("To")} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className="mt-2 block rounded-xl border border-[#dce4d8] bg-[#f7f8f2] px-3 py-3 text-sm text-[#193f33]" /></label>)}
      <button className={button}>{f("Apply dates")}</button><button type="button" aria-label={f("Refresh statistics")} disabled={queries.some(query => query.isFetching)} onClick={() => queries.forEach(query => { void query.refetch() })} className="rounded-xl bg-[#eaf0e6] p-3.5 disabled:opacity-50"><RefreshCw size={18} /></button>
      {validation && <p role="alert" className="w-full text-sm text-[#a43b32]">{f(validation, true)}</p>}
    </KeyboardForm>
    <p className="text-xs text-[#526259]">{role === 'EMPLOYEE' ? f("Figures reflect your assigned department.") : f("Figures use your workspace’s base currency.")}</p>
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title={f("Income vs expenses")} loading={summary.isPending} error={errorText(summary)} retry={() => { void summary.refetch() }} empty={totals && !totals.income && !totals.expenses ? f("No income or expenses in this period.") : undefined}>
        {totals && <><div className="mt-6 h-[280px]" role="img" aria-label={t('incomeComparison', { income: money(totals.income, totals.currency), expenses: money(totals.expenses, totals.currency) })}><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison} accessibilityLayer={false}><CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#68796e', fontSize: 12 }} /><YAxis width={72} axisLine={false} tickLine={false} tickFormatter={value => shortMoney(Number(value), totals.currency)} tick={{ fill: '#68796e', fontSize: 11 }} /><Tooltip formatter={value => money(Number(value), totals.currency)} contentStyle={tooltipStyle} cursor={{ fill: '#f3f6ed' }} /><Bar dataKey="amount" name={f("Amount")} radius={[8, 8, 0, 0]} maxBarSize={80} isAnimationActive={false}>{comparison.map((row, i) => <Cell key={row.name} fill={colors[i * 2]} />)}</Bar></BarChart></ResponsiveContainer></div><dl className="mt-5 grid grid-cols-2 gap-4">{comparison.map((row, i) => <div key={row.name} className="rounded-xl bg-[#f7f8f2] p-4"><dt className="text-xs text-[#526259]"><span aria-hidden className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: colors[i * 2] }} />{row.name}</dt><dd className="mt-2 wrap-anywhere text-xl font-semibold! tabular-nums">{money(row.amount, totals.currency)}</dd></div>)}</dl></>}
      </ChartCard>
      <ChartCard title={f("Spending by category")} loading={categories.isPending} error={errorText(categories)} retry={() => { void categories.refetch() }} empty={breakdown && !categoryRows.length ? f("No category spending in this period.") : undefined}>
        {breakdown && <><div className="mt-6 h-[280px]" role="img" aria-label={t('categoryChartSummary', { count: categoryRows.length, currency: breakdown.currency })}><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer={false}><Pie data={pieRows} dataKey="amount" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={3} stroke="none" isAnimationActive={false}>{pieRows.map((_, i) => <Cell key={i} fill={colors[i]} />)}</Pie><Tooltip formatter={value => money(Number(value), breakdown.currency)} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer></div><ul aria-label={f("Category spending values")} className="mt-5 grid gap-3">{pieRows.map((row, i) => <li key={i} className="flex justify-between gap-4 text-xs"><span className="min-w-0 wrap-anywhere text-[#526259]"><span aria-hidden className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: colors[i] }} />{row.name}</span><span className="shrink-0 tabular-nums">{money(row.amount, breakdown.currency)}</span></li>)}</ul>{categoryRows.length > 6 && <details className="mt-5 text-xs"><summary className="cursor-pointer">{f("View all categories")}</summary><ul className="mt-3 space-y-2">{categoryRows.map((row, i) => <li key={i} className="flex justify-between gap-4"><span className="wrap-anywhere">{row.name}</span><span>{money(row.amount, breakdown.currency)}</span></li>)}</ul></details>}</>}
      </ChartCard>
      <ChartCard title={f("Spending over time")} wide loading={timeseries.isPending} error={errorText(timeseries)} retry={() => { void timeseries.refetch() }} empty={daily && !daily.items.some(item => item.amount > 0) ? f("No spending in this period.") : undefined}>
        {daily && <><p className="mt-2 text-xs text-[#526259]">{t('dailyExpenses', { currency: daily.currency })}</p><div className="mt-6 h-[300px]" role="img" aria-label={t('dailySpendingRange', { from: dateLabel(range.from), to: dateLabel(range.to) })}><ResponsiveContainer width="100%" height="100%"><LineChart data={daily.items} accessibilityLayer={false} margin={{ right: 16 }}><CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="date" minTickGap={40} axisLine={false} tickLine={false} tickFormatter={value => dateLabel(String(value))} tick={{ fill: '#68796e', fontSize: 11 }} /><YAxis width={72} axisLine={false} tickLine={false} tickFormatter={value => shortMoney(Number(value), daily.currency)} tick={{ fill: '#68796e', fontSize: 11 }} /><Tooltip labelFormatter={value => dateLabel(String(value))} formatter={value => money(Number(value), daily.currency)} contentStyle={tooltipStyle} /><Line type="linear" dataKey="amount" name={f("Spending")} stroke="#193f33" strokeWidth={3} dot={daily.items.length === 1} activeDot={{ r: 5 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><details className="mt-5 text-xs"><summary className="cursor-pointer">{f("View daily spending values")}</summary><div className="mt-3 max-h-64 overflow-auto"><table aria-label={f("Daily spending values")} className="w-full text-left"><thead><tr><th scope="col" className="py-2">{f("Date")}</th><th scope="col" className="py-2 text-right">{f("Spending")}</th></tr></thead><tbody>{daily.items.map(row => <tr key={row.date} className="border-t border-[#e1e5df]"><td className="py-2">{dateLabel(row.date)}</td><td className="py-2 text-right tabular-nums">{money(row.amount, daily.currency)}</td></tr>)}</tbody></table></div></details></>}
      </ChartCard>
    </div>
  </div>
}
