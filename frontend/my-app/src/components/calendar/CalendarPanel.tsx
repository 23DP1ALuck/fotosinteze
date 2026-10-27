import { useTranslation } from 'react-i18next'
import { getLocale } from '@/i18n'
import { commonMessage as cm } from '@/i18n/common'
import { useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { dateError, dateValue, localDate, monthDays, parseDateValue, shiftMonth, type DatePrecision } from './date-utils'

const getMonthNames = () => Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(localDate(2026, index)))
const getWeekdays = () => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(localDate(2026, 0, 5 + index)))
const dayLabel = (date: Date) => new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(date)

export function CalendarPanel({ initial, selected, precision, min, max, required, onChoose, panelRef }: {
  initial: Date; selected: string; precision: DatePrecision; min?: string; max?: string; required?: boolean; onChoose: (value: string) => void; panelRef: RefObject<HTMLDivElement | null>
}) {
  useTranslation('common')
  const monthNames = getMonthNames()
  const [anchor, setAnchor] = useState(initial)
  const [view, setView] = useState<'days' | 'months' | 'years'>(precision === 'month' ? 'months' : 'days')
  const [focused, setFocused] = useState(dateValue(initial, 'date'))
  const [direction, setDirection] = useState(1)
  const hover = useRef<HTMLSpanElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const year = anchor.getFullYear()
  const firstYear = Math.max(1, Math.min(9988, Math.floor(year / 12) * 12))
  const today = dateValue(new Date(), precision)
  const allowed = (value: string) => !dateError(value, precision, min, max)
  function moveHover(button: HTMLButtonElement | null) {
    const indicator = hover.current
    if (!indicator || !grid.current) return
    if (!button || button.disabled) { indicator.style.opacity = '0'; return }
    const rect = button.getBoundingClientRect(), parent = grid.current.getBoundingClientRect()
    indicator.style.width = `${rect.width}px`; indicator.style.height = `${rect.height}px`
    indicator.style.transform = `translate(${rect.left - parent.left}px, ${rect.top - parent.top}px)`
    indicator.style.opacity = '1'
  }
  function clamp(date: Date) {
    const value = dateValue(date, precision)
    if (min && value < min) return parseDateValue(min, precision) ?? date
    if (max && value > max) return parseDateValue(max, precision) ?? date
    return date
  }
  function drillInto(date: Date, nextView: 'days' | 'months' | 'years') {
    const next = clamp(date)
    setAnchor(next); setFocused(dateValue(next, 'date')); setView(nextView); moveHover(null)
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[data-roving="true"]:not(:disabled)')?.focus())
  }
  function navigate(amount: number) {
    setDirection(Math.sign(amount))
    const next = shiftMonth(anchor, amount * (view === 'years' ? 144 : view === 'months' ? 12 : 1))
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
    setAnchor(next)
    setFocused(dateValue(clamp(next), 'date'))
    moveHover(null)
  }
  function keyboardDay(event: React.KeyboardEvent<HTMLButtonElement>, date: Date) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((date.getDay() + 6) % 7), End: 6 - ((date.getDay() + 6) % 7) } as Record<string, number>)[event.key]
    let next = event.key === 'PageUp' || event.key === 'PageDown' ? shiftMonth(date, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)) : localDate(date.getFullYear(), date.getMonth(), date.getDate() + offset)
    if (min && dateValue(next, 'date') < min) next = parseDateValue(min, 'date') ?? next
    if (max && dateValue(next, 'date') > max) next = parseDateValue(max, 'date') ?? next
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
    const value = dateValue(next, 'date')
    setDirection(next < date ? -1 : 1); setAnchor(next); setFocused(value)
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus())
  }
  const cells = view === 'days' ? monthDays(anchor) : []
  const canPrevious = view === 'days' ? year > 1 || anchor.getMonth() > 0 : view === 'years' ? firstYear > 1 : year > 1
  const canNext = view === 'days' ? year < 9999 || anchor.getMonth() < 11 : view === 'years' ? firstYear + 11 < 9999 : year < 9999
  return <div ref={panelRef}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <button type="button" disabled={!canPrevious} aria-label={view === 'days' ? cm('Previous month') : view === 'months' ? cm('Previous year') : cm('Previous years')} onClick={() => navigate(-1)} className="calendar-nav"><ChevronLeft size={18}/></button>
      <button type="button" aria-label={view === 'days' ? cm('Choose month and year') : cm('Choose year')} onClick={() => { setView(view === 'days' ? 'months' : 'years'); moveHover(null) }} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-[#eaf0e6]"><span aria-live="polite">{view === 'days' ? `${monthNames[anchor.getMonth()]} ${year}` : view === 'months' ? year : `${firstYear} – ${firstYear + 11}`}</span>{view !== 'years' && <ChevronDown size={14}/>}</button>
      <button type="button" disabled={!canNext} aria-label={view === 'days' ? cm('Next month') : view === 'months' ? cm('Next year') : cm('Next years')} onClick={() => navigate(1)} className="calendar-nav"><ChevronRight size={18}/></button>
    </div>
    <div key={`${view}-${year}-${anchor.getMonth()}`} ref={grid} data-direction={direction < 0 ? 'back' : 'forward'} className="calendar-grid relative isolate" onMouseLeave={() => moveHover(null)}>
      <span ref={hover} aria-hidden className="calendar-hover pointer-events-none absolute top-0 left-0 rounded-xl bg-[#eaf0e6] opacity-0" />
      {view === 'days' ? <div role="grid" aria-label={`${monthNames[anchor.getMonth()]} ${year}`}>
        <div role="row" className="mb-2 grid grid-cols-7">{getWeekdays().map(day => <span role="columnheader" key={day} aria-label={day} className="py-2 text-center text-[10px] font-medium text-[#627168]">{day.slice(0,2)}</span>)}</div>
        {Array.from({length:6},(_,week)=><div role="row" className="grid grid-cols-7 gap-1" key={week}>{cells.slice(week*7,week*7+7).map(date=>{
          const value=dateValue(date,'date'), current=value===selected
          return <div role="gridcell" aria-selected={current} key={value}><button type="button" data-date={value} data-roving={value===focused || undefined} aria-label={dayLabel(date)} aria-current={value===today?'date':undefined} disabled={!allowed(value)} tabIndex={value===focused?0:-1} onMouseEnter={event=>moveHover(event.currentTarget)} onFocus={event=>{setFocused(value);moveHover(event.currentTarget)}} onKeyDown={event=>keyboardDay(event,date)} onClick={()=>onChoose(value)} className={`calendar-day relative z-10 aspect-square w-full rounded-xl text-xs ${current?'bg-[#193f33] font-semibold text-white shadow-sm':date.getMonth()!==anchor.getMonth()?'text-[#94a197]':'text-[#213d33]'} ${value===today&&!current?'ring-1 ring-inset ring-[#98a56c]':''}`}>{date.getDate()}</button></div>
        })}</div>)}
      </div> : <div className="grid grid-cols-3 gap-2" role="group" aria-label={view==='months'?cm('Choose month'):cm('Choose year')}>
        {(view==='months'?Array.from({length:12},(_,index)=>index):Array.from({length:12},(_,index)=>firstYear+index)).map(value=>{
          const date=view==='months'?localDate(year,value):localDate(value,anchor.getMonth())
          const monthValue=dateValue(date,'month')
          const current=view==='months'?selected.slice(0,7)===monthValue:selected.slice(0,4)===String(value).padStart(4,'0')
          const start=view==='months'?dateValue(date,'date'):`${String(value).padStart(4,'0')}-01-01`
          const end=view==='months'?dateValue(localDate(year,value+1,0),'date'):`${String(value).padStart(4,'0')}-12-31`
          const disabled=precision==='month'&&view==='months'?!allowed(monthValue):Boolean(min&&(precision==='month'?end.slice(0,7):end)<min||max&&(precision==='month'?start.slice(0,7):start)>max)
          return <button type="button" key={value} data-roving={(view==='months'?value===anchor.getMonth():value===year)||undefined} disabled={disabled} aria-label={view==='months'?`${monthNames[value]} ${year}`:String(value)} aria-pressed={current} onMouseEnter={event=>moveHover(event.currentTarget)} onFocus={event=>moveHover(event.currentTarget)} onClick={()=>{moveHover(null);if(view==='months'&&precision==='month'){onChoose(monthValue);return}drillInto(date,view==='years'?'months':'days')}} className={`relative z-10 rounded-xl py-4 text-xs ${current?'bg-[#193f33] font-semibold text-white':'text-[#213d33]'}`}>{view==='months'?monthNames[value].slice(0,3):value}</button>
        })}
      </div>}
    </div>
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#e1e5df] pt-3 text-xs"><button type="button" disabled={!allowed(today)} onClick={()=>onChoose(today)} className="rounded-lg px-3 py-2 font-medium text-[#213d33] hover:bg-[#eaf0e6]">{precision==='month'?cm('This month'):cm('Today')}</button>{!required&&<button type="button" onClick={()=>onChoose('')} className="rounded-lg px-3 py-2 text-[#526259] hover:bg-[#eaf0e6]">{cm('Clear')}</button>}</div>
  </div>
}
