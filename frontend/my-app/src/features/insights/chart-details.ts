import type { DateRange } from '@/features/statistics/api'

export type ChartGroup = { dimension: 'category' | 'department' | 'project'; ids: (number | null)[]; name: string }
export type ChartSelection = { type: 'INCOME' | 'EXPENSE'; range: DateRange; amount: number; currency: string; group?: ChartGroup }
export const chartMoney = (amount: number, currency: string) => new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount)
export const chartDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
export function dashboardChartRange(start: string, exclusiveEnd: string): DateRange {
  return { from: start, to: new Date(Date.parse(`${exclusiveEnd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) }
}

export const chartTooltipStyle = { borderRadius: 14, border: '1px solid #dce4d8', boxShadow: '0 8px 24px #193f3312', padding: '12px 16px', fontSize: 13 }
