import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/brand/BrandMark'
import { HeroPreview } from '@/components/landing/HeroPreview'
import { useAuth } from '@/features/auth/use-auth'

const navLinks = [
  { href: '#personal', label: 'Personal' },
  { href: '#business', label: 'Business' },
  { href: '#how', label: 'How it works' },
]

const personalFeatures = ['Everyday spending', 'Monthly budgets', 'Savings goals', 'Subscription tracking']
const businessFeatures = ['Revenue & profit', 'Department budgets', 'Expense approvals', 'CSV reports']
const roles = ['Owner', 'Admin', 'Accountant', 'Employee']

const approvalSteps = [
  'Submit an expense and attach the receipt.',
  'A manager reviews and approves.',
  'Budgets and the dashboard update together.',
]

const faqs = [
  {
    question: 'Can I manage personal and business finances together?',
    answer:
      'Yes. Use one login and switch between separate workspaces, each with its own transactions, budgets, and members.',
  },
  {
    question: 'Is this a full accounting platform?',
    answer:
      'It focuses on financial clarity, budgets, team expenses, and reports. Tax filing, payroll, and VAT accounting are outside the planned scope.',
  },
]

function Eyebrow({ children, className = 'text-[#8b928c]' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-medium tracking-[0.16em] uppercase ${className}`}>{children}</p>
}

function FeatureList({ items, dark = false }: { items: string[]; dark?: boolean }) {
  return (
    <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((item) => (
        <li key={item} className={`flex items-center gap-2 text-sm ${dark ? 'text-white/90' : 'text-[#213d33]'}`}>
          <span className={dark ? 'text-[#d9f27a]' : 'text-[#213d33]'} aria-hidden>
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  )
}

function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'authenticated'

  return (
    <div className="landing-page min-h-svh bg-[#f6f5ee] text-[#213d33]">
      <header className="sticky top-0 z-20 border-b border-[#e6e3d8]/70 bg-[#f6f5ee]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-[15px] tracking-tight">
          <BrandMark />
          <span>fotosinteze</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[#6d756f] md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-[#213d33]">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <Link
              to="/app"
              className="rounded-lg bg-[#213d33] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="px-3 py-2 text-sm text-[#6d756f] transition-colors hover:text-[#213d33]"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-[#213d33] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-5 pb-8 pt-10 text-center sm:px-8 sm:pt-16">
          <p className="mb-7 inline-flex rounded-full bg-[#ecebe3] px-4 py-1.5 text-[11px] tracking-[0.16em] text-[#6d756f] uppercase">
            One login. Room for every ambition.
          </p>
          <h1 className="m-0 text-[2.6rem] leading-[1.08] font-medium tracking-[-0.04em] text-[#213d33] sm:text-6xl lg:text-[4.25rem]">
            <span className="block sm:whitespace-nowrap">Your money. Your business.</span>
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
              className="inline-flex h-11 items-center rounded-lg bg-[#213d33] px-5 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
            >
              {signedIn ? 'Open your workspace' : 'Create your workspace'}
            </Link>
            <a
              href="#product"
              className="inline-flex h-11 items-center rounded-lg bg-[#ecebe3] px-5 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#e4e2d8]"
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

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <div className="text-center">
              <Eyebrow>Built around the way you live and work</Eyebrow>
              <h2 className="mt-4 text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem]">
                Two worlds. One clear view.
              </h2>
              <p className="mt-4 text-[15px] text-[#6d756f]">
                Give your personal goals and business ambitions their own space.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2">
              <article id="personal" className="flex scroll-mt-24 flex-col rounded-2xl bg-[#f3f5ee] transition-transform duration-300 hover:-translate-y-1 p-7 sm:p-9">
                <Eyebrow>01 / Personal</Eyebrow>
                <h3 className="mt-4 text-2xl font-medium tracking-tight text-[#213d33]">
                  More life. Less money admin.
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[#6d756f]">
                  Know where your money goes, build better habits, and make room for what matters.
                </p>
                <div className="mt-7 rounded-xl bg-white px-5 py-5">
                  <p className="text-sm text-[#6d756f]">Your next adventure</p>
                  <p className="mt-2 text-3xl font-medium tracking-tight text-[#213d33]">
                    €1,800 <span className="text-[#9aa19c]">/ €3,000</span>
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e6ebe3]">
                    <div className="h-full w-[60%] rounded-full bg-[#213d33]" />
                  </div>
                  <p className="mt-2 text-xs text-[#8b928c]">Savings goal · 60% of the way there</p>
                </div>
                <FeatureList items={personalFeatures} />
                <div className="mt-auto pt-8">
                  <Link
                    to={signedIn ? '/app' : '/register'}
                    className="group inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#e6ebe3] px-5 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#dbe1d7]"
                  >
                    Explore personal <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
                  </Link>
                </div>
              </article>

              <article id="business" className="flex scroll-mt-24 flex-col rounded-2xl bg-[#213d33] transition-transform duration-300 hover:-translate-y-1 p-7 text-white sm:p-9">
                <Eyebrow className="text-[#d9f27a]">02 / Business</Eyebrow>
                <h3 className="mt-4 text-2xl font-medium tracking-tight text-white">
                  Big-picture control.
                  <span className="block">Down to the last expense.</span>
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/70">
                  Give your team the tools to spend responsibly, while you keep the whole business in view.
                </p>
                <div className="mt-7 rounded-xl bg-[#e6ebe3] px-5 py-5">
                  <p className="text-sm font-medium text-[#213d33]">The right access for every teammate</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roles.map((role) => (
                      <span key={role} className="rounded-md bg-white/70 px-2.5 py-1 text-xs text-[#6d756f]">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
                <FeatureList items={businessFeatures} dark />
                <div className="mt-auto pt-8">
                  <Link
                    to={signedIn ? '/app' : '/register'}
                    className="group inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#d9f27a] px-5 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#cfe86c]"
                  >
                    Explore business <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 bg-[#f3f5ee]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2">
            <div>
              <Eyebrow>From receipt to the big picture</Eyebrow>
              <h2 className="mt-4 text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem] sm:leading-tight">
                Less chasing.
                <span className="block">More moving forward.</span>
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#6d756f]">
                An expense shouldn&apos;t mean a trail of messages. Give your team one clear path from
                submission to approval.
              </p>
              <ol className="mt-8 space-y-4">
                {approvalSteps.map((step, index) => (
                  <li key={step} className="flex items-baseline gap-4 text-[15px] text-[#213d33]">
                    <span className="text-sm text-[#8b928c]">0{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl bg-[#e6ebe3] p-6 sm:p-8">
              <Eyebrow>One expense. Everything connected.</Eyebrow>
              <div className="mt-5 rounded-xl bg-white p-5 shadow-[0_16px_40px_-28px_rgba(33,61,51,0.35)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#213d33] text-xs font-medium text-white">
                    MK
                  </span>
                  <p className="text-sm text-[#213d33]">Mark submitted an expense</p>
                </div>
                <p className="mt-5 text-3xl font-medium tracking-tight text-[#213d33]">€120.00</p>
                <p className="mt-1 text-xs text-[#8b928c]">Client visit · Travel · Receipt attached</p>
                <div className="my-5 h-px bg-[#e6ebe3]" />
                <div className="flex items-center justify-between rounded-lg bg-[#f3f5ee] px-4 py-3 text-sm">
                  <span className="text-[#213d33]">✓ Approved by Anna</span>
                  <span className="text-xs text-[#8b928c]">Just now</span>
                </div>
              </div>
              <ul className="mt-5 space-y-2 text-sm text-[#6d756f]">
                <li>↓ Travel budget updated</li>
                <li>↓ Expense added to company overview</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-3xl px-5 py-24 sm:px-8">
            <h2 className="text-center text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem]">
              Good questions. Clear answers.
            </h2>
            <dl className="mt-12 divide-y divide-[#e6ebe3]">
              {faqs.map((faq) => (
                <div key={faq.question} className="py-6">
                  <dt className="text-lg font-medium tracking-tight text-[#213d33]">{faq.question}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-[#6d756f]">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="bg-[#213d33] text-white">
        <div className="mx-auto max-w-6xl px-5 pt-24 pb-10 text-center sm:px-8">
          <h2 className="m-0 text-3xl font-medium tracking-tight !text-white sm:text-5xl sm:leading-tight">
            Make room for a clearer
            <span className="block">financial future.</span>
          </h2>
          <p className="mt-5 text-[15px] text-white/70">
            Start with your life. Add your business. Keep moving forward.
          </p>
          <Link
            to={signedIn ? '/app' : '/register'}
            className="group mt-9 inline-flex h-12 items-center gap-1.5 rounded-lg bg-[#d9f27a] px-6 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#cfe86c]"
          >
            {signedIn ? 'Open your workspace' : 'Create your workspace'} <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
          </Link>

          <div className="mt-24 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm sm:flex-row">
            <Link to="/" className="flex items-center gap-2 text-white">
              <BrandMark onDark />
              <span>fotosinteze</span>
            </Link>
            <nav className="flex items-center gap-6 text-white/70">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="transition-colors hover:text-white">
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
