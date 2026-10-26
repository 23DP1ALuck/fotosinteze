import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { pageText } from '@/i18n/pages'
import { getLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/brand/BrandMark'
import { HeroPreview } from '@/components/landing/HeroPreview'
import { useAuth } from '@/features/auth/use-auth'

const money = (value: number) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'EUR' }).format(value)

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

function Eyebrow({ children, className = 'text-[#627168]' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-medium tracking-[0.16em] uppercase ${className}`}>{children}</p>
}

function FeatureList({ items, dark = false }: { items: string[]; dark?: boolean }) {
  const { t } = useTranslation('pages')
  return (
    <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((item) => (
        <li key={item} className={`flex items-center gap-2 text-sm ${dark ? 'text-white/90' : 'text-[#213d33]'}`}>
          <span className={dark ? 'text-[#d9f27a]' : 'text-[#213d33]'} aria-hidden>
            ✓
          </span>
          {pageText(item, t)}
        </li>
      ))}
    </ul>
  )
}

function LandingPage() {
  const { t } = useTranslation('pages')
  const { status } = useAuth()
  const signedIn = status === 'authenticated'

  return (
    <div className="landing-page min-h-svh bg-[#f6f5ee] text-[#213d33]">
      <header className="sticky top-0 z-20 border-b border-[#e6e3d8]/70 bg-[#f6f5ee]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-3 items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight sm:text-[22px]">
          <BrandMark className="size-5" />
          Fotosinteze
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-[#213d33] md:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-[#213d33]">
              {pageText(link.label, t)}
            </a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <LanguageSwitcher />
          {signedIn ? (
            <Link
              to="/app"
              className="rounded-lg bg-[#213d33] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
            >
              {t('openWorkspace')}
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="px-3 py-2 text-sm font-medium text-[#213d33] transition-colors hover:text-[#213d33]"
              >
                {t('logIn')}
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-[#213d33] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
              >
                {t('getStarted')}
              </Link>
            </>
          )}
        </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-5 pb-8 pt-10 text-center sm:px-8 sm:pt-16">
          <p className="mb-7 inline-flex rounded-full bg-[#ecebe3] px-4 py-1.5 text-[11px] tracking-[0.16em] text-[#526259] uppercase">
            {t('oneLoginRoomForEveryAmbition')}
          </p>
          <h1 className="m-0 text-[2.6rem] leading-[1.08] font-medium tracking-[-0.04em] text-[#213d33] sm:text-6xl lg:text-[4.25rem]">
            <span className="block">{t('yourMoneyYourBusiness')}</span>
            <span className="mt-1 block">{t('aClearerPicture')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-[#526259] sm:text-base">
            {t('findYourBalanceAtHomeKeepYourBusinessMoving')}
            <br className="hidden sm:block" />
            {t('manageBothWithWorkspacesThatKeepEverythingInItsPlace')}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to={signedIn ? '/app' : '/register'}
              className="inline-flex h-11 items-center rounded-lg bg-[#213d33] px-5 text-sm font-medium text-white transition-colors hover:bg-[#1a3229]"
            >
              {signedIn ? t('openYourWorkspace') : t('createYourWorkspace')}
            </Link>
            <a
              href="#product"
              className="inline-flex h-11 items-center rounded-lg bg-[#ecebe3] px-5 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#e4e2d8]"
            >
              {t('exploreTheProduct')}
            </a>
          </div>
          <p className="mt-5 text-sm text-[#627168]">
            {t('personalClarityBusinessControlOnePlaceToStart')}
          </p>
        </section>

        <section id="product" className="mx-auto max-w-[1080px] scroll-mt-24 px-4 pb-6 sm:px-8">
          <HeroPreview />
          <p className="mt-6 text-center text-sm text-[#627168]">
            {t('exploreSampleDataYourPersonalAndBusinessFinancesStaySeparate')}
          </p>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <div className="text-center">
              <Eyebrow>{t('builtAroundTheWayYouLiveAndWork')}</Eyebrow>
              <h2 className="mt-4 text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem]">
                {t('twoWorldsOneClearView')}
              </h2>
              <p className="mt-4 text-[15px] text-[#526259]">
                {t('giveYourPersonalGoalsAndBusinessAmbitionsTheirOwnSpace')}
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2">
              <article id="personal" className="flex scroll-mt-24 flex-col rounded-2xl bg-[#f3f5ee] transition-transform duration-300 hover:-translate-y-1 p-7 sm:p-9">
                <Eyebrow>{t('01Personal')}</Eyebrow>
                <h3 className="mt-4 text-2xl font-medium tracking-tight text-[#213d33]">
                  {t('moreLifeLessMoneyAdmin')}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[#526259]">
                  {t('knowWhereYourMoneyGoesBuildBetterHabitsAndMakeRoomForWhatMatters')}
                </p>
                <div className="mt-7 rounded-xl bg-white px-5 py-5">
                  <p className="text-sm text-[#526259]">{t('yourNextAdventure')}</p>
                  <p className="mt-2 text-3xl font-medium tracking-tight text-[#213d33]">
                    {money(1800)} <span className="text-[#627168]">/ {money(3000)}</span>
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e6ebe3]">
                    <div className="h-full w-[60%] rounded-full bg-[#213d33]" />
                  </div>
                  <p className="mt-2 text-xs text-[#627168]">{t('savingsGoal60OfTheWayThere')}</p>
                </div>
                <FeatureList items={personalFeatures} />
                <div className="mt-auto pt-8">
                  <Link
                    to={signedIn ? '/app' : '/register'}
                    className="group inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#e6ebe3] px-5 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#dbe1d7]"
                  >
                    {t('explorePersonal')} <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
                  </Link>
                </div>
              </article>

              <article id="business" className="flex scroll-mt-24 flex-col rounded-2xl bg-[#213d33] transition-transform duration-300 hover:-translate-y-1 p-7 text-white sm:p-9">
                <Eyebrow className="text-[#d9f27a]">{t('02Business')}</Eyebrow>
                <h3 className="mt-4 text-2xl font-medium tracking-tight text-white">
                  {t('bigpictureControl')}
                  <span className="block">{t('downToTheLastExpense')}</span>
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/85">
                  {t('giveYourTeamTheToolsToSpendResponsiblyWhileYouKeepTheWholeBusinessInView')}
                </p>
                <div className="mt-7 rounded-xl bg-[#e6ebe3] px-5 py-5">
                  <p className="text-sm font-medium text-[#213d33]">{t('theRightAccessForEveryTeammate')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roles.map((role) => (
                      <span key={role} className="rounded-md bg-white/70 px-2.5 py-1 text-xs text-[#526259]">
                        {pageText(role, t)}
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
                    {t('exploreBusiness')} <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 bg-[#f3f5ee]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2">
            <div>
              <Eyebrow>{t('fromReceiptToTheBigPicture')}</Eyebrow>
              <h2 className="mt-4 text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem] sm:leading-tight">
                {t('lessChasing')}
                <span className="block">{t('moreMovingForward')}</span>
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#526259]">
                {t('anExpenseShouldntMeanATrailOfMessagesGiveYourTeamOneClearPathFromSubmissionToApproval')}
              </p>
              <ol className="mt-8 space-y-4">
                {approvalSteps.map((step, index) => (
                  <li key={step} className="flex items-baseline gap-4 text-[15px] text-[#213d33]">
                    <span className="text-sm text-[#627168]">0{index + 1}</span>
                    {pageText(step, t)}
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl bg-[#e6ebe3] p-6 sm:p-8">
              <Eyebrow>{t('oneExpenseEverythingConnected')}</Eyebrow>
              <div className="mt-5 rounded-xl bg-white p-5 shadow-[0_16px_40px_-28px_rgba(33,61,51,0.35)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#213d33] text-xs font-medium text-white">
                    MK
                  </span>
                  <p className="text-sm text-[#213d33]">{t('markSubmittedAnExpense')}</p>
                </div>
                <p className="mt-5 text-3xl font-medium tracking-tight text-[#213d33]">{money(120)}</p>
                <p className="mt-1 text-xs text-[#627168]">{t('clientVisitTravelReceiptAttached')}</p>
                <div className="my-5 h-px bg-[#e6ebe3]" />
                <div className="flex items-center justify-between rounded-lg bg-[#f3f5ee] px-4 py-3 text-sm">
                  <span className="text-[#213d33]">{t('approvedByAnna')}</span>
                  <span className="text-xs text-[#627168]">{t('justNow')}</span>
                </div>
              </div>
              <ul className="mt-5 space-y-2 text-sm text-[#526259]">
                <li>{t('travelBudgetUpdated')}</li>
                <li>{t('expenseAddedToCompanyOverview')}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-3xl px-5 py-24 sm:px-8">
            <h2 className="text-center text-3xl font-medium tracking-tight !text-[#213d33] sm:text-[2.6rem]">
              {t('goodQuestionsClearAnswers')}
            </h2>
            <dl className="mt-12 divide-y divide-[#e6ebe3]">
              {faqs.map((faq) => (
                <div key={faq.question} className="py-6">
                  <dt className="text-lg font-medium tracking-tight text-[#213d33]">{pageText(faq.question, t)}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-[#526259]">{pageText(faq.answer, t)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="bg-[#213d33] text-white">
        <div className="mx-auto max-w-6xl px-5 pt-24 pb-10 text-center sm:px-8">
          <h2 className="m-0 text-3xl font-medium tracking-tight !text-white sm:text-5xl sm:leading-tight">
            {t('financialFutureTitle')}
          </h2>
          <p className="mt-5 text-[15px] text-white/85">
            {t('startWithYourLifeAddYourBusinessKeepMovingForward')}
          </p>
          <Link
            to={signedIn ? '/app' : '/register'}
            className="group mt-9 inline-flex h-12 items-center gap-1.5 rounded-lg bg-[#d9f27a] px-6 text-sm font-medium text-[#213d33] transition-colors hover:bg-[#cfe86c]"
          >
            {signedIn ? t('openYourWorkspace') : t('createYourWorkspace')} <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
          </Link>

          <div className="mt-24 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm sm:flex-row">
            <Link to="/" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-white">
              <BrandMark onDark className="size-5" />
              <span>fotosinteze</span>
            </Link>
            <nav className="flex items-center gap-6 font-medium text-white/85">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="transition-colors hover:text-white">
                  {pageText(link.label, t)}
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
