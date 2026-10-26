import type { MouseEvent } from 'react'

// Use the same cancellation path as Escape so forms retain their save guards.
export function dismissDialogOnBackdropClick(event: MouseEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget
  if (event.target !== dialog || !dialog.open) return

  const bounds = dialog.getBoundingClientRect()
  const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  if (!outside) return

  const cancel = new Event('cancel', { cancelable: true })
  if (dialog.dispatchEvent(cancel)) dialog.close()
}
