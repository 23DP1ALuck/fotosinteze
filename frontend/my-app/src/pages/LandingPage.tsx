import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/brand/BrandMark'
import { HeroPreview } from '@/components/landing/HeroPreview'
import { useAuth } from '@/features/auth/auth-context'

const navLinks = [
  { href: '#personal', label: 'Personal' },
  { href: '#business', label: 'Business' },
  { href: '#how', label: 'How it works' },
]

function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'authenticated'

  return (
    <div className="landing-page min-h-svh bg-[#f6f5ee] text-[#1a2e2a]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-[15px] tracking-tight">
          fFotosinteze
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[#6d756f] md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-[#1a2e2a]">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <Link
              to="/app"
              className="rounded-full bg-[#1a3c34] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163329]"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="px-3 py-2 text-sm text-[#6d756f] transition-colors hover:text-[#1a2e2a]"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="rounded-full bg-[#1a3c34] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163329]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-5 pb-8 pt-10 text-center sm:px-8 sm:pt-16">
          <p className="mb-7 inline-flex rounded-full bg-[#ecebe3] px-4 py-1.5 text-[11px] tracking-[0.16em] text-[#6d756f] uppercase">
            One login. Room for every ambition.
          </p>
          <h1 className="m-0 text-[2.6rem] leading-[1.08] font-medium tracking-[-0.04em] text-[#1a2e2a] sm:text-6xl lg:text-[4.25rem]">
            Your money. Your business.
            <span className="mt-1 block">A clearer picture.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-[#6d756f] sm:text-base">
            Find your balance at home. Keep your business moving.
            <br className="hidden sm:block" />
            Manage both with workspaces that keep everything in its place.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to={signedIn ? '/app' : '/register'}
              className="inline-flex h-11 items-center rounded-full bg-[#1a3c34] px-5 text-sm font-medium text-white transition-colors hover:bg-[#163329]"
            >
              {signedIn ? 'Open your workspace' : 'Create your workspace'}
            </Link>
            <a
              href="#product"
              className="inline-flex h-11 items-center rounded-full bg-[#ecebe3] px-5 text-sm font-medium text-[#1a2e2a] transition-colors hover:bg-[#e4e2d8]"
            >
              Explore the product
            </a>
          </div>
          <p className="mt-5 text-sm text-[#8b928c]">
            Personal clarity. Business control. One place to start.
          </p>
        </section>

        <section id="product" className="mx-auto max-w-[1080px] px-4 pb-6 sm:px-8">
          <HeroPreview />
          <p className="mt-6 text-center text-sm text-[#8b928c]">
            An illustrative business workspace. Your personal finances stay separate.
          </p>
        </section>

        <section id="personal" className="mx-auto grid max-w-5xl gap-8 px-5 py-20 sm:px-8 md:grid-cols-3">
          <article>
            <p className="text-xs tracking-[0.16em] text-[#8b928c] uppercase">Personal</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              See what you actually have left.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#6d756f]">
              Track spending, savings, and the month ahead without mixing it with
              invoices or payroll.
            </p>
          </article>


          <article id="business">
            <p className="text-xs tracking-[0.16em] text-[#8b928c] uppercase">Business</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              Revenue, costs, and room to plan.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#6d756f]">
              Keep a live view of profit, budgets, and the work that still needs
              funding — without another spreadsheet.
            </p>
          </article>
          <article id="how">
            <p className="text-xs tracking-[0.16em] text-[#8b928c] uppercase">How it works</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight text-[#1a2e2a]">
              One login. Separate workspaces.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#6d756f]">
              Switch between personal and business views in a click. Each one stays
              clean, so the numbers never blur.
            </p>
          </article>
        </section>
      </main>
    </div>
  )
}

export default LandingPage
