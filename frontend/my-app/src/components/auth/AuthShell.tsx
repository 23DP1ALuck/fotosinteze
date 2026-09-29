import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

type AuthShellProps = {
  headline: string
  children: React.ReactNode
  className?: string
}

function BrandMark() {
  return (
    <span
      className="inline-block size-4 rounded-full border border-white/80 bg-[linear-gradient(180deg,#fff_50%,#1a3c34_50%)]"
      aria-hidden
    />
  )
}

function AuthShell({ headline, children, className }: AuthShellProps) {
  return (
    <div className={cn('flex min-h-svh w-full', className)}>
      <aside className="hidden w-1/2 flex-col justify-between bg-[#1a3c34] p-10 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg tracking-tight">
          <BrandMark />
          <span>finance manager</span>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">
            {headline}
          </h1>
          <p className="text-base text-white/80">
            Your personal goals and business ambitions, with space for both.
          </p>
        </div>
        <p className="text-xs tracking-[0.2em] text-white/50 uppercase">
          Personal clarity. Business control.
        </p>
      </aside>

      <main className="flex w-full flex-col bg-[#f9f9f6] lg:w-1/2">
        <div className="flex items-center gap-2 p-6 text-[#1a3c34] lg:hidden">
          <BrandMark />
          <span className="font-medium">finance manager</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  )
}

function AuthBackLink() {
  return (
    <Link
      to="/"
      className="mb-8 inline-flex items-center gap-1 text-sm text-[#6b7280] transition-colors hover:text-[#1a3c34]"
    >
      ← Back to home
    </Link>
  )
}

export { AuthBackLink, AuthShell }
