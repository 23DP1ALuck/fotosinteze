import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NavigationShortcuts } from './NavigationShortcuts'

afterEach(cleanup)
function press(target: EventTarget, key: string, modifiers: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
it('blocks modified horizontal history navigation on the page and calendar fields', () => {
  const { getByRole } = render(<><NavigationShortcuts/><button>Workspace</button><input aria-label="Date" readOnly /></>)
  for (const target of [document.body, getByRole('button'), getByRole('textbox')]) {
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      expect(press(target, key, { metaKey: true }).defaultPrevented).toBe(true)
      expect(press(target, key, { ctrlKey: true }).defaultPrevented).toBe(true)
    }
  }
})
it('preserves text editing, ordinary arrows and the existing form shortcuts', () => {
  const { getByRole } = render(<><NavigationShortcuts/><input aria-label="Name"/><textarea aria-label="Notes"/><div contentEditable role="textbox" aria-label="Editor"/></>)
  for (const name of ['Name', 'Notes', 'Editor']) {
    expect(press(getByRole('textbox', { name }), 'ArrowLeft', { metaKey: true }).defaultPrevented).toBe(false)
    expect(press(getByRole('textbox', { name }), 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false)
  }
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter']) {
    expect(press(document.body, key, {}).defaultPrevented).toBe(false)
  }
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) {
    expect(press(document.body, key, { ctrlKey: true }).defaultPrevented).toBe(false)
  }
})
it('removes its listener when unmounted', () => {
  const { unmount } = render(<NavigationShortcuts/>)
  unmount()
  expect(press(document.body, 'ArrowLeft', { metaKey: true }).defaultPrevented).toBe(false)
})
