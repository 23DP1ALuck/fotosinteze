import type { KeyboardEvent } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { chartDate, chartMoney } from './chart-details'

export const chartActionClass = 'inline-flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs text-[#526259] hover:bg-[#eaf0e6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#82965b]'
export function ChartAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={chartActionClass}>{label}<ArrowUpRight size={14} aria-hidden="true" /></button>
}
export function SpendingPoint({ cx, cy, payload, currency, onSelect }: { cx?: number; cy?: number; payload?: { date: string; amount: number }; currency: string; onSelect: (row: { date: string; amount: number }) => void }) {
  if (cx === undefined || cy === undefined || !payload) return <g />
  const activate = () => onSelect(payload)
  function keyDown(event: KeyboardEvent<SVGCircleElement>) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate() } }
  return <g className="recharts-line-dot chart-spending-point">
    <circle cx={cx} cy={cy} r={12} fill="transparent" role="button" tabIndex={0} aria-label={`View expenses for ${chartDate(payload.date)}`} onClick={event => { event.stopPropagation(); activate() }} onKeyDown={keyDown} className="cursor-pointer focus-visible:outline-none">
      <title>{chartDate(payload.date)} · {chartMoney(payload.amount, currency)} · Click to view expenses</title>
    </circle>
    <circle cx={cx} cy={cy} r={4} fill="#193f33" stroke="white" strokeWidth={2} pointerEvents="none" />
  </g>
}
