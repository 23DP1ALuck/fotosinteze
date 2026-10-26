import { useAdminTranslation } from '@/i18n/use-admin-translation'
import { useLayoutEffect, useRef } from 'react'

export function WorkspaceNavigation({ items, activeItem, onSelect }: {
  items: readonly string[]
  activeItem: string
  onSelect: (item: string) => void
}) {
  const { tr } = useAdminTranslation()
  const container = useRef<HTMLDivElement>(null)
  const selectedIndicator = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = container.current
    const indicator = selectedIndicator.current
    if (!element || !indicator) return
    let frame = 0
    function measure() {
      const button = element!.querySelector<HTMLButtonElement>('[aria-current="page"]')
      if (!button?.offsetHeight) return
      indicator!.style.height = `${button.offsetHeight}px`
      indicator!.style.transform = `translateY(${button.offsetTop}px)`
      indicator!.style.opacity = '1'
      // The initial position is immediate; later selections glide from that position.
      frame = requestAnimationFrame(() => { indicator!.dataset.ready = 'true' })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [activeItem, items])

  return <nav aria-label={tr("Workspace")} className="min-h-0 overflow-y-auto overscroll-contain pb-1 [scrollbar-width:thin]">
    <div ref={container} className="workspace-navigation relative isolate grid content-start gap-1">
      <span ref={selectedIndicator} aria-hidden className="workspace-nav-selection pointer-events-none absolute inset-x-0 top-0 rounded-[10px] bg-[#193f33] opacity-0" />
      {items.map(item => <button type="button" key={item} onClick={() => onSelect(item)} aria-current={activeItem === item ? 'page' : undefined} className={`relative z-10 rounded-[10px] border-0 bg-transparent px-[19px] py-2.5 text-left font-medium ${activeItem === item ? 'text-white' : 'text-[#213d33] hover:bg-[#f1f4ec] focus-visible:bg-[#f1f4ec]'}`}>{tr(item)}</button>)}
    </div>
  </nav>
}
