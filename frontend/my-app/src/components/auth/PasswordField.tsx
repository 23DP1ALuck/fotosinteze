import { useState, type ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PasswordFieldProps = Omit<ComponentProps<'input'>, 'type'>

function PasswordField({ className, disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={cn('pr-16', className)}
        {...props}
      />
      <button
        type="button"
        className={cn(
          'absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[#6b7280] hover:text-[#1a3c34]',
          disabled && 'pointer-events-none opacity-50',
        )}
        onClick={() => setVisible((current) => !current)}
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export { PasswordField }
