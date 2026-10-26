import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function MotionDialog({ title, closeLabel = 'Close expense exploration', onClose, children }: { title: string; closeLabel?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const closing = useRef(false)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => { dialog.getAnimations?.().forEach(animation => animation.cancel()); dialog.close() }
  }, [])
  function close() {
    if (closing.current) return
    closing.current = true
    const dialog = ref.current!
    const finish = () => { dialog.close(); onClose() }
    if (!dialog.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return }
    void dialog.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(18px)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(finish, () => {})
  }
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); close() }} onClick={dismissDialogOnBackdropClick} className="insight-dialog fixed inset-y-0 right-0 left-auto m-0 h-svh max-h-svh w-[min(600px,100%)] max-w-full overflow-y-auto border-0 bg-[#f7f8f2] p-7 text-[#193f33] shadow-2xl backdrop:bg-[#102c23]/30 backdrop:backdrop-blur-[4px] max-sm:p-5">
    <div className="mb-7 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold! tracking-tight">{title}</h2><button type="button" autoFocus aria-label={closeLabel} onClick={close} className="rounded-full bg-[#eaf0e6] p-2"><X size={20} /></button></div>
    {children}
  </dialog>
}
