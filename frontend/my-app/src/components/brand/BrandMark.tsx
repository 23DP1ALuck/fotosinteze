import { cn } from '@/lib/utils'

type BrandMarkProps = {
  onDark?: boolean
  className?: string
}

function BrandMark({ onDark = false, className }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'inline-block size-4 shrink-0 rounded-full bg-[linear-gradient(180deg,#fff_50%,#1a3c34_50%)]',
        onDark ? 'border border-white/80' : 'border border-[#1a3c34]/80',
        className,
      )}
      aria-hidden
    />
  )
}

export { BrandMark }
