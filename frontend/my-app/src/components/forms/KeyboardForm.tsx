import { useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent } from 'react'
import type { FieldPath, FieldValues, UseFormTrigger } from 'react-hook-form'
import { cn } from '@/lib/utils'

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
const selector = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea'
function fieldsIn(form: HTMLFormElement): Field[] {
  const fields = Array.from(form.querySelectorAll<Field>(selector)).filter(field => {
    if (field.matches(':disabled, [readonly]:not([data-date-input])') || field.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (let node: HTMLElement | null = field; node && node !== form; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
  return fields.filter(field => !(field instanceof HTMLInputElement && field.type === 'radio' && field.name) ||
    field === (fields.find(other => other instanceof HTMLInputElement && other.type === 'radio' && other.name === field.name && other.checked) ?? fields.find(other => other instanceof HTMLInputElement && other.type === 'radio' && other.name === field.name)))
}
function focusField(field: Field) {
  field.focus({ preventScroll: true })
  field.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
function busy(form: HTMLFormElement) { return Boolean(form.closest('[aria-busy="true"]')) }

/** Enter confirms fields; Ctrl/Command arrows navigate; only the save shortcut submits. */
export function KeyboardForm<T extends FieldValues = FieldValues>({ validateField, children, className, onKeyDown, onFocusCapture, ...props }: ComponentPropsWithoutRef<'form'> & { validateField?: UseFormTrigger<T> }) {
  const visited = useRef(new Set<Field>())
  const pending = useRef(false)
  const [hint, setHint] = useState('Enter to continue · Ctrl/⌘+↑/↓ to switch fields · Ctrl/⌘+Enter to save')

  function hintFor(form: HTMLFormElement, field: Field) {
    const shortcuts = 'Ctrl/⌘+↑/↓ to switch fields · Ctrl/⌘+Enter to save'
    if (field instanceof HTMLInputElement && field.dataset.dateInput) return `Enter to open calendar · ${shortcuts}`
    if (field instanceof HTMLTextAreaElement) return `Enter for a new line · ${shortcuts}`
    if (field instanceof HTMLInputElement && field.type === 'file') return `Enter to choose a file · ${shortcuts}`
    if (field instanceof HTMLSelectElement) return `Type or use ↑/↓ to choose · Enter to continue · ${shortcuts}`
    if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) return `Space to select · Enter to continue · ${shortcuts}`
    if (fieldsIn(form).every(other => visited.current.has(other))) return `Fields reviewed · ${shortcuts}`
    return `Enter to continue · ${shortcuts}`
  }

  function submit(form: HTMLFormElement) {
    if (!form.isConnected || busy(form)) return
    const button = Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')).find(element => element.type === 'submit' && !element.matches(':disabled'))
    if (!button) return
    form.requestSubmit(button)
    // Schema-based forms expose their own errors; native forms retain built-in validity.
    requestAnimationFrame(() => {
      if (!form.isConnected) return
      const invalid = fieldsIn(form).find(field => field.getAttribute('aria-invalid') === 'true' || (!form.noValidate && !field.validity.valid))
      if (invalid) focusField(invalid)
    })
  }
  async function advance(form: HTMLFormElement, field: Field) {
    if (pending.current || busy(form)) return
    pending.current = true
    const value = field.value
    try {
      const valid = validateField && field.name ? await validateField(field.name as FieldPath<T>) : field.checkValidity()
      if (!form.isConnected || !field.isConnected || document.activeElement !== field || field.value !== value) return
      if (!valid) {
        if (!validateField || !field.name) field.reportValidity()
        focusField(field)
        setHint('Check this field before continuing.')
        return
      }
      visited.current.add(field)
      const fields = fieldsIn(form)
      const index = fields.indexOf(field)
      const next = [...fields.slice(index + 1), ...fields.slice(0, index)].find(other => !visited.current.has(other))
      if (next) focusField(next)
      else setHint('Fields reviewed · Ctrl/⌘+Enter to save · Ctrl/⌘+↑/↓ to switch fields')
    } catch {
      setHint('Please check this field and try again.')
    } finally { pending.current = false }
  }
  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const form = event.currentTarget
    const target = event.target
    if (target instanceof HTMLElement && target.getAttribute('aria-expanded') === 'true' && !target.hasAttribute('data-date-input')) return
    const modified = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    if (event.key === 'Enter' && modified) {
      event.preventDefault()
      if (!event.repeat && !pending.current) submit(form)
      return
    }
    const fields = fieldsIn(form)
    if (modified && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (busy(form) || !fields.length) return
      const order = Array.from(form.querySelectorAll<Field>(selector))
      const index = order.indexOf(target as Field)
      const forward = event.key === 'ArrowDown'
      const candidates = index < 0 ? (forward ? order : [...order].reverse()) : forward
        ? [...order.slice(index + 1), ...order.slice(0, index + 1)]
        : [...order.slice(0, index).reverse(), ...order.slice(index).reverse()]
      const next = candidates.find(field => fields.includes(field))
      if (fields.includes(target as Field)) visited.current.add(target as Field)
      if (next) { focusField(next); setHint(hintFor(form, next)) }
      return
    }
    // Prevent native Enter activation of a focused save button. Clicking still saves.
    if (event.key === 'Enter' && (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) && ['submit', 'image'].includes(target.type)) {
      event.preventDefault()
      setHint('Ctrl/⌘+Enter to save, or click the save button.')
      return
    }
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return
    const field = target
    if (event.key !== 'Enter') return
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && field.type === 'file') return
    event.preventDefault()
    if (event.repeat || event.altKey || event.shiftKey || pending.current) return
    if (!fields.includes(field)) {
      if (field.matches('[readonly]')) {
        const order = Array.from(form.querySelectorAll<Field>(selector))
        const next = order.slice(order.indexOf(field) + 1).find(other => fields.includes(other)) ?? fields.find(other => !visited.current.has(other))
        if (next) focusField(next)
      }
      return
    }
    void advance(form, field)
  }

  return <form {...props} className={cn('keyboard-form', className)} onKeyDown={keyDown} onFocusCapture={event => {
    onFocusCapture?.(event)
    const field = event.target
    if (field instanceof HTMLButtonElement) { setHint(field.type === 'submit' ? 'Ctrl/⌘+Enter to save, or click the save button.' : 'Ctrl/⌘+↑/↓ to switch fields · Ctrl/⌘+Enter to save'); return }
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      setHint(hintFor(event.currentTarget, field))
      if (field instanceof HTMLInputElement) field.enterKeyHint = 'next'
    }
  }}>{children}<p className="keyboard-form-hint col-span-full mt-4 w-full text-xs leading-relaxed text-[#526259]" role="status" aria-live="polite">{hint}</p></form>
}
