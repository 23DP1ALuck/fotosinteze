import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full rounded-lg border border-[#d8d8d0] bg-white px-3 py-2 text-base text-[#1a2e2a] shadow-none transition-colors outline-none placeholder:text-[#9ca3af] focus-visible:border-[#1a3c34] focus-visible:ring-2 focus-visible:ring-[#1a3c34]/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-red-500/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
