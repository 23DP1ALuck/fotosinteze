import { useTranslation } from 'react-i18next'
import { commonMessage as cm } from '@/i18n/common'
import { useCallback, useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { Popover } from '@base-ui/react/popover'
import { CalendarDays, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CalendarPanel } from './CalendarPanel'
import { dateError, dateValue, parseDateValue, type DatePrecision } from './date-utils'

type Props = Omit<ComponentProps<'input'>, 'type'> & { type?: DatePrecision; calendarLabel?: string; nextCalendarId?: string }

/** A real ISO-valued input, with a branded calendar instead of the OS date picker. */
export function DateInput({ type = 'date', calendarLabel, nextCalendarId, ref, className, value, defaultValue, min, max, disabled, readOnly, required, onChange, onBlur, onKeyDown, onInvalid, ...props }: Props) {
  const { t, i18n } = useTranslation('common')
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const returnFocus = useRef(true)
  const id = useId()
  const triggerId = `${id}-trigger`
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [initial, setInitial] = useState(() => new Date())
  const [selection, setSelection] = useState('')
  const [session, setSession] = useState(0)
  const [error, setError] = useState('')
  const lower = min === undefined ? undefined : String(min)
  const upper = max === undefined ? undefined : String(max)
  const label = calendarLabel ?? props['aria-label'] ?? props.name?.replaceAll('_', ' ') ?? (type === 'month' ? t('month') : t('date'))
  const validate = useCallback((element: HTMLInputElement) => {
    const message = dateError(element.value, type, lower, upper)
    element.setCustomValidity(cm(message))
    element.lang = i18n.resolvedLanguage ?? 'en'
    return message
  }, [type, lower, upper, i18n])
  const inputRef = useCallback((element: HTMLInputElement | null) => {
    input.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
    if (element) validate(element)
  }, [ref, validate])
  useEffect(() => { if (input.current) validate(input.current) }, [value, validate, i18n.language])

  function openCalendar() {
    if (disabled || readOnly) return
    const current = input.current?.value ?? ''
    let date = parseDateValue(current, type) ?? new Date()
    let iso = dateValue(date, type)
    if (lower && parseDateValue(lower, type) && iso < lower) { date = parseDateValue(lower, type)!; iso = lower }
    if (upper && parseDateValue(upper, type) && iso > upper) date = parseDateValue(upper, type)!
    setInitial(date); setSelection(current); setSession(previous => previous + 1)
    setContainer(input.current?.closest('dialog') ?? document.body)
    returnFocus.current = true
    setOpen(true)
  }
  function choose(next: string) {
    const element = input.current
    if (!element) return
    // Native events keep controlled inputs, RHF registration and FormData in sync.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next)
    validate(element)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    const following = next && nextCalendarId ? document.getElementById(nextCalendarId) : null
    const handoff = following instanceof HTMLInputElement && !following.disabled && following.dataset.dateInput !== undefined
    setSelection(next); setError(''); returnFocus.current = !handoff; setOpen(false)
    if (handoff) requestAnimationFrame(() => { if (following.isConnected) { following.focus({ preventScroll: true }); following.click() } })
  }
  return <Popover.Root open={open} triggerId={triggerId} onOpenChange={(next, details) => {
    if (next) openCalendar()
    else { returnFocus.current = !['outside-press', 'focus-out'].includes(details.reason); setOpen(false) }
  }}>
    <span ref={anchor} className="date-input relative inline-grid w-full min-w-0 align-bottom">
      <input {...props} ref={inputRef} type="text" data-date-input={type} size={type === 'month' ? 9 : 12} value={value} defaultValue={defaultValue} min={min} max={max} disabled={disabled} readOnly required={required} autoComplete={props.autoComplete ?? 'off'} placeholder={props.placeholder ?? (type === 'month' ? t('chooseMonth') : t('chooseDate'))} pattern={props.pattern ?? (type === 'month' ? '[0-9]{4}-[0-9]{2}' : '[0-9]{4}-[0-9]{2}-[0-9]{2}')} aria-invalid={props['aria-invalid'] === true || props['aria-invalid'] === 'true' || Boolean(error)} aria-describedby={[props['aria-describedby'], error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} onChange={event => {
        const message = validate(event.currentTarget)
        if (!message || error) setError(message)
        onChange?.(event)
      }} onBlur={event => { setError(validate(event.currentTarget)); onBlur?.(event) }} onInvalid={event => { setError(validate(event.currentTarget)); onInvalid?.(event) }} onKeyDown={event => {
        onKeyDown?.(event)
        if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openCalendar() }
        if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openCalendar() }
      }} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) openCalendar() }} aria-haspopup="dialog" aria-expanded={open} className={cn('cursor-pointer h-11 w-full min-w-0 rounded-xl border border-[#dce4d8] bg-[#f7f8f2] px-3 py-2 text-sm text-[#213d33] outline-none placeholder:text-[#627168] focus:border-[#82965b] focus:ring-2 focus:ring-[#193f33]/10 disabled:opacity-50 aria-invalid:border-[#a43b32]', className, 'pr-12')} />
      <Popover.Trigger id={triggerId} disabled={disabled || readOnly} type="button" aria-label={t('openCalendar', { label })} className="date-input-trigger absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-lg text-[#526259] hover:bg-[#dce4d8] hover:text-[#213d33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#82965b] disabled:opacity-40"><CalendarDays size={17}/></Popover.Trigger>
    </span>
    {error && <span id={`${id}-error`} className="mt-1 block text-xs text-[#a43b32]">{cm(error)}</span>}
    <Popover.Portal container={container}>
      <Popover.Positioner anchor={anchor} align="start" sideOffset={8} collisionPadding={12} positionMethod="fixed" className="z-[100]">
        <Popover.Popup initialFocus={() => panel.current?.querySelector<HTMLElement>('[data-roving="true"]:not(:disabled)') ?? true} finalFocus={() => returnFocus.current ? input.current : false} className="calendar-popup w-[min(340px,calc(100vw_-_24px))] max-h-[var(--available-height)] overflow-y-auto rounded-[24px] border border-[#e1e5df] bg-white p-5 font-sans text-[#213d33] shadow-[0_20px_70px_-20px_#193f334d] outline-none scheme-light" onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); returnFocus.current = false; setOpen(false)
            const element = input.current
            element?.focus({ preventScroll: true })
            element?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, bubbles: true, cancelable: true }))
          } else if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
        }}>
          <div className="mb-3 flex items-center justify-between gap-3"><Popover.Title className="text-[10px] font-medium tracking-[.14em] text-[#627168] uppercase">{type === 'month' ? t('chooseMonth') : t('chooseDate')}</Popover.Title><Popover.Close type="button" aria-label={t('closeCalendar')} className="rounded-full p-1.5 text-[#627168] hover:bg-[#eaf0e6]"><X size={15}/></Popover.Close></div>
          <CalendarPanel key={session} initial={initial} selected={selection} precision={type} min={lower} max={upper} required={required} onChoose={choose} panelRef={panel}/>
          <p className="mt-3 text-[10px] leading-relaxed text-[#627168]">{type === 'date' ? t('calendarHelp') : ''}{t('closeHelp')}</p>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
}
