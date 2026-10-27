import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { getLocale } from '@/i18n'
import { pageText, pageError } from '@/i18n/pages'
import { useTranslation } from 'react-i18next'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronRight, LogOut, Menu, Plus, X } from 'lucide-react'

import { ExpenseExplorer } from '@/features/insights/ExpenseExplorer'
import { MonthlyReview } from '@/features/insights/MonthlyReview'
import { BrandMark } from '@/components/brand/BrandMark'
import { useAuth } from '@/features/auth/use-auth'
import { AccountManager } from '@/features/accounts/AccountManager'
import { CategoryManager } from '@/features/categories/CategoryManager'
import { CreateBusinessDialog, WorkspaceSwitcher, type Workspace } from '@/features/workspaces/WorkspaceControls'
import { DepartmentManager } from '@/features/departments/DepartmentManager'
import { EmployeeManager } from '@/features/employees/EmployeeManager'
import { ProjectManager } from '@/features/projects/ProjectManager'
import { useProjectCatalog } from '@/features/projects/use-project-catalog'
import { WorkspaceNavigation } from '@/features/workspaces/WorkspaceNavigation'
import { WorkspaceProvider } from '@/features/workspaces/WorkspaceProvider'
import { WorkspaceSettingsDialog } from '@/features/workspaces/WorkspaceSettingsDialog'
import { useWorkspace } from '@/features/workspaces/use-workspace'
import { TransactionsView } from '@/features/workspaces/TransactionsView'
import { Statistics } from '@/features/statistics/Statistics'
import { BusinessDashboard } from '@/features/dashboard/BusinessDashboard'
import { BusinessBudgets } from '@/features/budgets/BusinessBudgets'
import { PersonalBudgetSummary } from '@/features/budgets/PersonalBudgetSummary'
import { ExpenseRequests } from '@/features/expenses/ExpenseRequests'
import { EnableBankingConnect } from '@/features/enable-banking/EnableBankingConnect'
import { RevolutConnect } from '@/features/revolut/RevolutConnect'
import { DeleteTransactionDialog } from '@/features/transactions/DeleteTransactionDialog'
import { TransactionForm } from '@/features/transactions/TransactionForm'
import { useWorkspaceFinance } from '@/features/transactions/use-workspace-finance'
import type { ApiTransaction, TransactionFilters } from '@/features/transactions/api'

const percent = (value: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

const navigation = ['Dashboard', 'Accounts', 'Transactions', 'Budgets', 'Monthly review', 'Categories', 'Statistics'] as const
const formatDate = (date: string) => new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))

const cardClasses =
  'rounded-2xl bg-white px-[26px] py-[22px] max-[1200px]:p-5 max-sm:px-[18px] max-sm:py-5 min-[1600px]:px-[30px] min-[1600px]:py-[26px] [&_h2]:m-0 [&_h2]:text-[22px] [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-[-.025em] max-[1200px]:[&_h2]:text-[19px]'
const primaryButtonClasses =
  'inline-flex min-h-12 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] border-0 bg-[#193f33] px-[18px] py-3 text-white hover:bg-[#285947]'
const formClasses =
  'mt-[22px] grid gap-[17px] [&_label]:grid [&_label]:gap-[6px] [&_label]:text-[13px] [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dbe2d7] [&_input]:bg-[#fcfdf9] [&_input]:px-3 [&_input]:py-[10px] [&_input]:text-[#193f33] [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-[#dbe2d7] [&_select]:bg-[#fcfdf9] [&_select]:px-3 [&_select]:py-[10px] [&_select]:text-[#193f33] [&_input:focus]:outline-2 [&_input:focus]:outline-offset-1 [&_input:focus]:outline-[#82965b] [&_select:focus]:outline-2 [&_select:focus]:outline-offset-1 [&_select:focus]:outline-[#82965b]'

function WorkspaceDashboard({ workspace, workspaces, active, onSwitch, onCreate, onSettings }: {
  workspace: Workspace; workspaces: Workspace[]; active: boolean; onSwitch: (id: string) => void; onCreate: () => void; onSettings: () => void
}) {
  const { t } = useTranslation('pages')
  const isBusiness = workspace.kind === 'business'
  const workspaceNavigation = isBusiness ? workspace.role === 'EMPLOYEE' ? ['Dashboard', 'Transactions', 'Expense requests', 'Budgets', 'Monthly review', 'Categories', 'Departments', 'Projects', 'Statistics'] : ['Dashboard', 'Accounts', 'Transactions', 'Expense requests', 'Budgets', 'Monthly review', 'Categories', 'Departments', 'Projects', 'Employees', 'Statistics'] : navigation
  const { user, logout } = useAuth()
  const backendWorkspaceId = Number(workspace.id)
  const projectCatalog = useProjectCatalog(backendWorkspaceId, isBusiness && active, workspace.role)
  const canManageProjects = workspace.role !== 'EMPLOYEE'
  const [transactionFilters, setTransactionFilters] = useState<TransactionFilters>({})
  const finance = useWorkspaceFinance(backendWorkspaceId, active, projectCatalog, transactionFilters)
  const [deletingTransaction, setDeletingTransaction] = useState<ApiTransaction | null>(null)
  const [transactionAction, setTransactionAction] = useState<{ type: 'income' | 'expense'; transaction?: ApiTransaction } | null>(null)
  const [selectedView, setView] = useState<string | null>(null)
  const view = selectedView ?? 'Dashboard'
  if (active && selectedView === null && finance.accountsReady) {
    setView(finance.accounts.length === 0 && (!isBusiness || workspace.role === 'OWNER') ? 'Accounts' : 'Dashboard')
  }
  const [mobileMenu, setMobileMenu] = useState(false)
  const transactions = finance.transactions
  const [dialogType, setDialogType] = useState<'profile' | null>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [exploringExpenses, setExploringExpenses] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const summary = finance.dashboard
  const currency = summary?.currency ?? 'EUR'
  const euro = (value: number, code = currency) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency: code }).format(value)
  const income = summary ? Number('income' in summary ? summary.income : summary.revenue) : 0
  const expenses = summary ? Number(summary.expenses) : 0
  const balance = summary && 'balance' in summary ? Number(summary.balance) : finance.accounts.filter(item => item.currency === currency).reduce((sum, item) => sum + Number(item.balance), 0)
  const displayName = user?.displayName || t('yourAccount')
  const initials = displayName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()
  const periodLabel = new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(summary ? new Date(`${summary.period_start}T12:00:00`) : new Date())

  function navigate(next: string) { setExploringExpenses(false); if (next !== 'Transactions') setTransactionFilters({}); setView(next); setMobileMenu(false) }
  function connectBackendWorkspace() { setNotice('Use the workspace switcher to choose another accessible workspace.') }
  function openDialog(type: 'profile' | 'transaction', entry: 'income' | 'expense' = 'income') {
    if (type === 'transaction') { setTransactionAction({ type: entry }); return }
    setDialogType(type)
    dialog.current?.showModal()
  }
  function editTransaction(id: number) {
    const transaction = finance.rows.find(item => item.transaction_id === id)
    if (!transaction) return
    if (transaction.expense_id !== null) { setNotice('Approved expense transactions cannot be edited.'); return }
    const category = finance.options.categories.find(item => item.id === transaction.category_id)
    setTransactionAction({ type: category?.type ?? 'expense', transaction })
  }
  async function handleLogout() {
    setLogoutError(null)
    try { await logout() } catch { setLogoutError('Could not log out. Please try again.') }
  }

  function renderTransactions(all = false) {
    return <section className={`${cardClasses} mt-6 !pb-[17px]`}>
      <div className="flex items-center justify-between gap-[15px]"><h2>{all ? t('yourTransactions') : t('recentTransactions')}</h2>{!all && <button className="border-0 bg-transparent p-0 text-[13px] text-[#193f33] hover:text-[#60815b]" onClick={() => navigate('Transactions')}>{t('viewAll')}</button>}</div>
      <div className="mt-[22px] overflow-x-auto"><table className="w-full border-collapse text-left whitespace-nowrap [&_th]:pt-0 [&_th]:pr-[18px] [&_th]:pb-3 [&_th]:text-[10px] [&_th]:font-normal [&_th]:text-[#627168] [&_th]:uppercase [&_td]:border-t [&_td]:border-[#e1e5df] [&_td]:py-[13px] [&_td]:pr-[18px] [&_td]:text-[13px] [&_td]:text-[#627168] [&_td:first-child]:w-[31%]"><thead><tr>{['Transaction', 'Category', isBusiness ? 'Department' : 'Source', 'Date', 'Amount'].map((label) => <th key={label}>{pageText(label, t)}</th>)}</tr></thead>
        <tbody>{(all ? transactions : transactions.slice(0, 3)).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{isBusiness ? item.department || '—' : pageText(item.source, t)}</td><td>{formatDate(item.date)}</td><td className="!text-[#193f33] tabular-nums">{item.type === 'unknown' ? '' : item.amount > 0 ? '+' : '−'} {euro(Math.abs(item.amount), item.currency)}</td></tr>)}</tbody>
      </table></div>{transactions.length === 0 && <p className="py-8 text-sm text-[#627168]">{t('noTransactionsYetAddIncomeOrAnExpenseToGetStarted')}</p>}
    </section>
  }
  function renderChart() {
    if (!active) return null
    return <section className={cardClasses}><div className="flex items-center justify-between gap-4"><h2>{isBusiness ? t('revenueExpenses') : t('moneyInMoneyOut')}</h2><span className="text-xs text-[#627168]">{periodLabel}</span></div>
      <div className="mt-6 h-[242px]" role="img" aria-label={t('chartDescription', { income: euro(income), expenses: euro(expenses), period: periodLabel })}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: t('income'), income }, { name: t('expenses'), expenses }]} margin={{ left: 4, right: 8 }}><CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="name" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} width={80} tickFormatter={(value: number) => euro(value)} /><Tooltip formatter={value => euro(Number(value))} /><Bar dataKey="income" name={t('income')} fill="#193f33" radius={[8, 8, 0, 0]} /><Bar dataKey="expenses" name={t('expenses')} fill="#98a56c" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>
    </section>
  }

  return <div className="workspace-surface flex min-h-svh bg-[#f7f8f2] font-sans text-[15px] leading-[1.5] tracking-[-.015em] text-[#193f33] scheme-light [&_h1]:font-sans! [&_h2]:font-sans! [&_h1]:font-semibold! [&_h2]:font-semibold! max-sm:block [&_button]:cursor-pointer [&_button]:transition-colors motion-reduce:[&_button]:transition-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#82965b] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-[#82965b]">
    <aside className={`h-svh min-h-0 w-[252px] shrink-0 self-start flex-col bg-white px-[21px] pt-8 pb-6 max-[1200px]:w-[220px] max-[1200px]:px-4 min-[1600px]:w-[294px] min-[1600px]:px-[25px] min-[1600px]:py-[38px] sm:sticky sm:top-0 sm:flex sm:shadow-none ${mobileMenu ? 'fixed inset-y-0 left-0 z-20 flex !w-[290px] max-w-[calc(100%_-_30px)] !px-5 !py-[25px] shadow-[15px_0_60px_#193f3326]' : 'hidden'}`}>
      {mobileMenu && <button className="mb-[10px] flex shrink-0 self-end border-0 bg-transparent p-1 sm:hidden" aria-label={t('closeWorkspaceNavigation')} onClick={() => setMobileMenu(false)}><X size={20} /></button>}
      <div className="shrink-0">
      <Link to="/" className="flex items-center gap-2.5 px-[5px] text-[25px] font-semibold tracking-tight"><BrandMark className="size-5" />Fotosinteze</Link>
      <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} onSwitch={(id) => { setExploringExpenses(false); setTransactionAction(null); setDeletingTransaction(null); setMobileMenu(false); onSwitch(id) }} onCreate={() => { setMobileMenu(false); onCreate() }} onSettings={() => { setMobileMenu(false); onSettings() }} />
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <p className="mx-[9px] mb-3 shrink-0 text-[10px] text-[#627168] uppercase">{t('workspace')}</p>
        <WorkspaceNavigation items={workspaceNavigation} activeItem={view} onSelect={navigate} />
      </div>
      <div className="mt-4 shrink-0 border-t border-[#e1e5df] pt-4">
        <button type="button" aria-label={t('profileAccount')} title={t('profileAccount')} onClick={() => { setMobileMenu(false); openDialog('profile') }} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-[#f1f4ec]">
          <span aria-hidden className="grid size-[39px] shrink-0 place-items-center rounded-full bg-[#ecf0e6] text-xs">{initials}</span>
          <span className="grid min-w-0 flex-1 gap-0.5"><strong className="truncate text-sm" title={displayName}>{displayName}</strong><span className="text-xs text-[#627168]">{isBusiness ? workspace.role === 'EMPLOYEE' ? t('workspaceEmployee') : t('workspaceOwner') : t('personalAccount')}</span></span>
          <ChevronRight aria-hidden size={16} className="shrink-0 text-[#627168]" />
        </button>
        <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#e9c9c2] bg-[#fbece8] px-4 py-3 text-sm font-semibold text-[#a43b32] hover:bg-[#f5ddd6]" onClick={handleLogout}><LogOut aria-hidden size={18} />{t('logOut')}</button>
        {logoutError && <p role="alert" className="mt-3 text-xs text-[#a43b32]">{pageError(logoutError, t)}</p>}
      </div>
    </aside>
    <main className="mx-auto min-w-0 max-w-[1800px] flex-1 px-[42px] pt-8 pb-11 max-[1200px]:px-[26px] max-[1200px]:py-[25px] max-sm:px-[18px] max-sm:pt-5 max-sm:pb-7 min-[1600px]:px-[50px] min-[1600px]:pt-10 min-[1600px]:pb-[50px]">
      <header className="flex flex-wrap gap-3 items-center justify-between border-b border-[#e1e5df] pb-[23px] max-sm:pb-[18px] [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&_div_span]:text-[11px] [&_div_span]:text-[#627168] [&_div_span]:uppercase max-sm:[&_div_span]:text-[9px] [&>span]:pr-[9%] [&>span]:text-sm max-sm:[&>span]:pr-0 max-sm:[&>span]:text-xs"><div><button className="inline-flex border-0 bg-transparent p-[3px] sm:hidden" aria-label={t('toggleWorkspaceNavigation')} aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button><span>{isBusiness ? t('businessWorkspaceRole', { role: workspace.role === 'EMPLOYEE' ? t('employee') : t('owner') }) : t('personalWorkspace')}</span></div><span>{view === 'Statistics' ? t('financialStatistics') : isBusiness && view === 'Budgets' ? t('budgetPlanning') : periodLabel}</span>{active && <LanguageSwitcher />}</header>
      <div className="mt-7 flex items-center justify-between gap-[22px] max-[1200px]:flex-col max-[1200px]:items-start max-sm:mt-[25px] [&_h1]:m-0 [&_h1]:text-[clamp(25px,2.45vw,40px)] [&_h1]:leading-[1.2] [&_h1]:font-semibold [&_h1]:tracking-[-.035em] max-sm:[&_h1]:max-w-[330px] max-sm:[&_h1]:text-[29px] [&_p]:mt-3 [&_p]:text-[15px] [&_p]:text-[#526259] max-sm:[&_p]:text-[13px]"><div><h1>{view === 'Dashboard' ? isBusiness ? t('yourBusinessAtAGlance') : t('aLittleClarityForYourEveryday') : view === 'Transactions' ? t('everyTransactionInItsPlace') : pageText(view, t)}</h1><p>{isBusiness ? view === 'Transactions' ? t('searchOrganiseAndFollowTheDetailsBehindYourBusiness') : t('trackTheMoneyGiveEveryPlanRoomToGrow') : view === 'Dashboard' ? t('yourBalanceSpendingAndGoalsAllInTheirOwnPlace') : t('aClearerPictureOfYourPersonalFinances')}</p></div>
        {view !== 'Budgets' && view !== 'Monthly review' && <div className="flex shrink-0 gap-[13px] max-sm:w-full max-sm:gap-[10px] max-sm:[&_button]:flex-1 max-sm:[&_button]:text-[13px]"><button className="inline-flex min-h-12 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] border-0 bg-[#eaf0e6] px-[18px] py-3 text-[#193f33] hover:bg-[#dce6d4]" onClick={() => openDialog('transaction', 'income')}><Plus size={18} />{t('addIncome')}</button><button className={primaryButtonClasses} onClick={() => openDialog('transaction', 'expense')}><span aria-hidden>−</span>{t('addExpense')}</button></div>}
      </div>
      <div className="mt-6 mb-[19px] flex flex-wrap items-center gap-4 text-xs text-[#627168]"><span>{view === 'Statistics' ? t('selectedWorkspace') : `${periodLabel} · ${currency}`}</span><span>{t('connectedToYourWorkspace')}</span></div>
      {finance.loading && ((!isBusiness && view === 'Dashboard') || view === 'Transactions') && <p role="status" className="mb-4 text-sm">{t('loadingYourFinancialData')}</p>}
      {finance.error && ((!isBusiness && view === 'Dashboard') || view === 'Transactions') && <div className="mb-4 rounded-xl bg-[#fcf0ed] p-4"><p role="alert">{pageError(finance.error, t)}</p><button type="button" onClick={finance.refresh} className="mt-3 underline">{t('retryFinancialData')}</button></div>}
      {notice && <p role="status" className="mb-[18px] flex items-center justify-between rounded-[10px] bg-[#eaf0e5] px-4 py-3 text-[13px] [&_button]:border-0 [&_button]:bg-transparent">{pageText(notice, t)}<button aria-label={t('dismissNotification')} onClick={() => setNotice('')}><X size={16} /></button></p>}
      {!isBusiness && view === 'Dashboard' && !finance.loading && !finance.error && <><section className="grid grid-cols-4 gap-[17px] max-[900px]:grid-cols-2 max-sm:gap-[10px]" aria-label={t('monthlyOverview')}>
        {(isBusiness ? [{ label: 'Revenue', value: income, note: 'Income across your business workspace' }, { label: 'Expenses', value: expenses, note: t('revenuePercent', { percent: percent(income ? expenses / income : 0) }) }, { label: 'Net profit', value: income - expenses, note: t('profitPercent', { percent: percent(income ? (income - expenses) / income : 0) }) }, { label: 'Current balance', value: balance, note: 'Across your business workspace' }] : [{ label: 'Current balance', value: balance, note: 'Opening balance + this month’s activity' }, { label: 'Income this month', value: income, note: 'Salary and other income' }, { label: 'Expenses this month', value: expenses, note: t('incomePercent', { percent: percent(income ? expenses / income : 0) }) }, { label: 'Saved this month', value: income - expenses, note: t('savingsPercent', { percent: percent(income ? (income - expenses) / income : 0) }) }]).map((item) => <article className={`min-w-0 rounded-2xl ${item.label === (isBusiness ? 'Net profit' : 'Saved this month') ? 'bg-[#d5f579]' : 'bg-white'} px-[23px] pt-5 pb-[23px] max-[1200px]:px-[15px] max-[1200px]:py-[18px] min-[1600px]:px-7 min-[1600px]:py-[25px]  [&_p]:text-sm [&_p]:text-[#526259] max-sm:[&_p]:text-xs [&_strong]:mt-3 [&_strong]:mb-[11px] [&_strong]:block [&_strong]:text-[clamp(24px,2.35vw,36px)] [&_strong]:leading-[1.3] [&_strong]:font-[650] [&_strong]:tracking-[-.035em] max-sm:[&_strong]:text-[25px] [&_span]:text-[11px] [&_span]:text-[#627168] max-sm:[&_span]:text-[10px] data-[highlight=true]:[&_p]:text-[#486c43] data-[highlight=true]:[&_span]:text-[#486c43]`} data-highlight={item.label === (isBusiness ? 'Net profit' : 'Saved this month')} key={item.label}><p>{pageText(item.label, t)}</p><strong>{item.label === 'Expenses this month' ? <button type="button" aria-label={t('exploreExpensesThisMonth')} onClick={()=>setExploringExpenses(true)} className="text-left underline decoration-[#dce4d8] underline-offset-8 hover:decoration-[#213d33]">{euro(item.value)}<span aria-hidden className="ml-2 !text-base">↗</span></button> : euro(item.value)}</strong><span>{pageText(item.note, t)}</span></article>)}
      </section><div className="my-[25px] grid grid-cols-[minmax(0,1.92fr)_minmax(270px,1fr)] gap-6 max-[1200px]:grid-cols-[minmax(0,1.6fr)_minmax(235px,1fr)] max-[1200px]:gap-[18px] max-[900px]:grid-cols-1 min-[1600px]:my-[30px] min-[1600px]:gap-[30px]">{renderChart()}{active && <PersonalBudgetSummary workspaceId={backendWorkspaceId} onManage={() => navigate('Budgets')} />}</div></>}
      {!isBusiness && view === 'Dashboard' && !finance.loading && !finance.error && renderTransactions()}
      {active && isBusiness && view === 'Dashboard' && <BusinessDashboard finance={finance} workspaceName={workspace.name} role={workspace.role ?? 'EMPLOYEE'} onExploreExpenses={()=>setExploringExpenses(true)} onViewTransactions={() => navigate('Transactions')} showRecent={view === 'Dashboard'} />}
      {active && view === 'Monthly review' && <MonthlyReview workspaceId={backendWorkspaceId} workspaceName={workspace.name} kind={workspace.kind} role={workspace.role} />}
      {active && view === 'Statistics' && <Statistics key={backendWorkspaceId} workspaceId={backendWorkspaceId} role={isBusiness ? workspace.role : undefined} />}
      {view === 'Transactions' && <TransactionsView transactions={transactions} income={income} expenses={expenses} workspaceName={workspace.name} workspaceKind={workspace.kind} currency={currency} onEdit={editTransaction} onDelete={id => { const transaction = finance.rows.find(item => item.transaction_id === id); if (transaction && transaction.expense_id === null && transaction.source !== 'BANK') setDeletingTransaction(transaction) }} loading={finance.transactionsLoading} error={finance.transactionsError} hasMore={finance.hasMore} filterOptions={{ categories: finance.options.categories, departments: projectCatalog.departments, projects: projectCatalog.projects }} onFilterChange={next => setTransactionFilters(previous => ({ ...previous, ...next }))} />}
      {view === 'Transactions' && finance.hasMore && <button type="button" disabled={finance.loadingMore} onClick={finance.loadMore} className="mt-5 rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm disabled:opacity-50">{finance.loadingMore ? t('loading') : t('loadMoreTransactions')}</button>}
      {isBusiness && view === 'Expense requests' && <ExpenseRequests key={backendWorkspaceId} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} catalog={projectCatalog} onApproved={() => finance.refresh()} />}
      {active && view === 'Budgets' && (isBusiness ? <BusinessBudgets key={backendWorkspaceId} workspaceId={backendWorkspaceId} catalog={projectCatalog} onConnect={connectBackendWorkspace} /> : <BusinessBudgets key={backendWorkspaceId} workspaceId={backendWorkspaceId} personal onConnect={connectBackendWorkspace} />)}
      {active && view === 'Accounts' && (!isBusiness || workspace.role === 'OWNER') && <AccountManager workspaceId={backendWorkspaceId} workspaceName={workspace.name} canCreate={!isBusiness || workspace.role === 'OWNER'} />}
      {active && view === 'Categories' && <CategoryManager canManage={!isBusiness || workspace.role === 'OWNER'} workspaceName={workspace.name} workspaceKind={workspace.kind} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} />}
      {active && !isBusiness && view === 'Accounts' && <EnableBankingConnect workspaceId={backendWorkspaceId} />}
      {active && !isBusiness && view === 'Accounts' && <RevolutConnect key={backendWorkspaceId} workspaceId={backendWorkspaceId} />}

      {active && isBusiness && view === 'Projects' && <ProjectManager catalog={projectCatalog} workspaceName={workspace.name} canManage={canManageProjects} canCreate={canManageProjects || projectCatalog.departments.length > 0} />}
      {active && isBusiness && view === 'Departments' && <DepartmentManager key={`${backendWorkspaceId}-${workspace.role}`} workspaceId={backendWorkspaceId} workspaceName={workspace.name} canManage={workspace.role === 'OWNER'} />}
      {active && isBusiness && workspace.role === 'OWNER' && view === 'Employees' && <EmployeeManager key={backendWorkspaceId} workspaceId={backendWorkspaceId} workspaceName={workspace.name} canManage={workspace.role === 'OWNER'} />}
    </main>
    {active && exploringExpenses && summary && <ExpenseExplorer workspaceId={backendWorkspaceId} range={{from:summary.period_start,to:new Date(Date.parse(`${summary.period_end}T00:00:00Z`)-86400000).toISOString().slice(0,10)}} onClose={()=>setExploringExpenses(false)} />}
    <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} className="m-auto max-h-[calc(100svh-40px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[18px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/35 backdrop:backdrop-blur-[3px] [&_h2]:m-0 [&_h2]:text-[23px] [&_h2]:font-semibold" aria-labelledby="dashboard-dialog-title">
    <div className="mb-4 flex justify-end"><LanguageSwitcher /></div>
      <div className="flex items-center justify-between gap-[15px]"><h2 id="dashboard-dialog-title">{t('yourAccount')}</h2><button className="rounded-full border-0 bg-[#eff2e9] p-[6px]" aria-label={t('closeDialog')} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {dialogType === 'profile' && <div className={formClasses}><strong>{displayName}</strong><p>{user?.email}</p><p className="text-xs text-[#627168]">{t('workspaceName', { name: workspace.name })}</p><button className={primaryButtonClasses} onClick={handleLogout}>{t('logOut')}</button>{logoutError && <p role="alert">{pageError(logoutError, t)}</p>}</div>}
    </dialog>
    {active && deletingTransaction && <DeleteTransactionDialog key={`${backendWorkspaceId}-${deletingTransaction.transaction_id}`} workspaceId={backendWorkspaceId} transaction={deletingTransaction} onClose={() => setDeletingTransaction(null)} onDeleted={() => { setDeletingTransaction(null); setNotice('Transaction deleted.') }} />}
    {active && transactionAction && <TransactionForm key={`${backendWorkspaceId}-${transactionAction.transaction?.transaction_id ?? transactionAction.type}`} workspaceId={backendWorkspaceId} type={transactionAction.type} transaction={transactionAction.transaction} options={finance.options} role={workspace.role} catalog={isBusiness ? projectCatalog : undefined} onClose={() => setTransactionAction(null)} onSaved={() => { setTransactionAction(null); setNotice(transactionAction.transaction ? 'Transaction updated.' : 'Transaction saved.') }} />}
  </div>
}

function WorkspaceHome() {
  const { t } = useTranslation('pages')
  const state = useWorkspace()
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{ userId: number; workspaceId: number } | null>(null)
  const workspaces: Workspace[] = state.workspaces.map(item => ({ id: String(item.id), name: item.name, kind: item.type === 'PERSONAL' ? 'personal' : 'business', role: item.role }))
  const createDialog = creating && <CreateBusinessDialog key={user?.id} workspaces={workspaces} onCreate={state.createBusiness} onClose={() => setCreating(false)} />
  const settingsWorkspace = editing?.userId === user?.id && state.activeWorkspace?.id === editing?.workspaceId && state.activeWorkspace?.type === 'BUSINESS' && state.activeWorkspace?.role === 'OWNER' ? state.activeWorkspace : null
  const settingsDialog = settingsWorkspace && <WorkspaceSettingsDialog key={`${user?.id}-${settingsWorkspace.id}`} workspaceId={settingsWorkspace.id} onSave={input => state.updateBusiness(settingsWorkspace.id, input)} onClose={() => setEditing(null)} />
  const languageControl = <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
  if (state.status === 'unauthenticated') return null
  if (state.status === 'loading') return <main className="grid min-h-svh place-items-center bg-[#f7f8f2] text-[#193f33]">{languageControl}<p role="status">{t('loadingYourWorkspaces')}</p></main>
  if (state.status === 'error') return <main className="grid min-h-svh place-items-center bg-[#f7f8f2] p-6 text-[#193f33]"><div className="rounded-2xl bg-white p-6">{languageControl}<p role="alert">{pageError(state.error, t)}</p><button onClick={state.retry} className="mt-4 rounded-xl bg-[#193f33] px-5 py-3 text-white">{t('retry')}</button></div></main>
  if (!state.activeWorkspace) return <><main className="grid min-h-svh place-items-center bg-[#f7f8f2] p-6 text-[#193f33]"><div>{languageControl}<h1 className="text-xl font-semibold">{t('noAccessibleWorkspaces')}</h1><p className="mt-2">{t('refreshYourMembershipsOrCreateABusinessWorkspaceToGetStarted')}</p><div className="mt-4 flex flex-wrap gap-4"><button onClick={() => setCreating(true)} className="rounded-xl bg-[#193f33] px-5 py-3 text-white">{t('createBusinessWorkspace')}</button><button onClick={state.retry} className="underline">{t('refreshWorkspaces')}</button></div></div></main>{createDialog}</>
  return <>{workspaces.map(workspace => <div key={`${user?.id}-${workspace.id}`} hidden={workspace.id !== String(state.activeWorkspace!.id)}><WorkspaceDashboard workspace={workspace} workspaces={workspaces} active={workspace.id === String(state.activeWorkspace!.id)} onSwitch={id => { setEditing(null); state.selectWorkspace(Number(id)) }} onCreate={() => setCreating(true)} onSettings={() => { if (user) setEditing({ userId: user.id, workspaceId: Number(workspace.id) }) }} /></div>)}{createDialog}{settingsDialog}</>
}

function HomePage() { return <WorkspaceProvider><WorkspaceHome /></WorkspaceProvider> }
export default HomePage
