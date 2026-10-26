import { useEffect } from 'react'

/** Keep browser history shortcuts from unexpectedly leaving the current workspace. */
export function NavigationShortcuts() {
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const target = event.target
      if (target instanceof Element) {
        const field = target.closest('input, textarea')
        if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && !field.readOnly && !field.disabled && !field.matches('[type="button"], [type="submit"], [type="checkbox"], [type="radio"], [type="range"]')) return
        if (target.closest('[contenteditable]:not([contenteditable="false"])')) return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [])
  return null
}
