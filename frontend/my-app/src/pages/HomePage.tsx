import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Menu, Plus, X } from 'lucide-react'

import { BrandMark } from '@/components/brand/BrandMark'
import { useAuth } from '@/features/auth/use-auth'
import { CategoryManager } from '@/features/categories/CategoryManager'
import { CreateBusinessDialog, WorkspaceSwitcher, type Workspace } from '@/features/workspaces/WorkspaceControls'
import { DepartmentManager } from '@/features/departments/DepartmentManager'
import { TeamManager } from '@/features/workspaces/TeamManager'
import { ProjectManager, ProjectFields } from '@/features/projects/ProjectManager'
import { useProjectCatalog } from '@/features/projects/use-project-catalog'
import { WorkspaceProvider } from '@/features/workspaces/WorkspaceProvider'
import { useWorkspace } from '@/features/workspaces/use-workspace'
import type { TeamData } from '@/features/workspaces/team-types'
import { TransactionsView } from '@/features/workspaces/TransactionsView'
import { BusinessDashboard } from '@/features/dashboard/BusinessDashboard'
import { BusinessBudgets } from '@/features/budgets/BusinessBudgets'
import { ExpenseRequests } from '@/features/expenses/ExpenseRequests'
import { RevolutConnect } from '@/features/revolut/RevolutConnect'
import { DeleteTransactionDialog } from '@/features/transactions/DeleteTransactionDialog'
import { TransactionForm } from '@/features/transactions/TransactionForm'
import { useWorkspaceFinance } from '@/features/transactions/use-workspace-finance'
import type { ApiTransaction, TransactionFilters } from '@/features/transactions/api'

const navigation = ['Dashboard', 'Transactions', 'Budgets', 'Categories', 'Statistics', 'Revolut'] as const
const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))

const cardClasses =
  'rounded-2xl bg-white px-[26px] py-[22px] max-[1200px]:p-5 max-sm:px-[18px] max-sm:py-5 min-[1600px]:px-[30px] min-[1600px]:py-[26px] [&_h2]:m-0 [&_h2]:text-[22px] [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-[-.025em] max-[1200px]:[&_h2]:text-[19px]'
const primaryButtonClasses =
  'inline-flex min-h-12 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] border-0 bg-[#193f33] px-[18px] py-3 text-white hover:bg-[#285947]'
const formClasses =
  'mt-[22px] grid gap-[17px] [&_label]:grid [&_label]:gap-[6px] [&_label]:text-[13px] [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dbe2d7] [&_input]:bg-[#fcfdf9] [&_input]:px-3 [&_input]:py-[10px] [&_input]:text-[#193f33] [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-[#dbe2d7] [&_select]:bg-[#fcfdf9] [&_select]:px-3 [&_select]:py-[10px] [&_select]:text-[#193f33] [&_input:focus]:outline-2 [&_input:focus]:outline-offset-1 [&_input:focus]:outline-[#82965b] [&_select:focus]:outline-2 [&_select:focus]:outline-offset-1 [&_select:focus]:outline-[#82965b]'

function WorkspaceDashboard({ workspace, workspaces, active, onSwitch, onCreate }: {
  workspace: Workspace; workspaces: Workspace[]; active: boolean; onSwitch: (id: string) => void; onCreate: () => void
}) {
  const isBusiness = workspace.kind === 'business'
  const workspaceNavigation = isBusiness ? workspace.role === 'EMPLOYEE' ? ['Dashboard', 'Transactions', 'Expense requests', 'Budgets', 'Categories', 'Departments', 'Projects', 'Statistics'] : ['Dashboard', 'Transactions', 'Expense requests', 'Budgets', 'Categories', 'Departments', 'Projects', 'Employees', 'Statistics', 'Settings'] : navigation
  const { user, logout } = useAuth()
  const [team, setTeam] = useState<TeamData>({ departments: [], employees: [], projects: [] })
  const backendWorkspaceId = Number(workspace.id)
  const projectCatalog = useProjectCatalog(backendWorkspaceId, isBusiness && active)
  const canManageProjects = workspace.role !== 'EMPLOYEE'
  const [transactionFilters, setTransactionFilters] = useState<TransactionFilters>({})
  const finance = useWorkspaceFinance(backendWorkspaceId, active, projectCatalog, transactionFilters)
  const [deletingTransaction, setDeletingTransaction] = useState<ApiTransaction | null>(null)
  const [transactionAction, setTransactionAction] = useState<{ type: 'income' | 'expense'; transaction?: ApiTransaction } | null>(null)
  const [budgetTargets, setBudgetTargets] = useState<Record<string, { departmentId: string; projectId: string }>>({})
  const [budgetDraft, setBudgetDraft] = useState<typeof budgetTargets>({})
  const [view, setView] = useState<string>('Dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const transactions = finance.transactions
  const [dialogType, setDialogType] = useState<'profile' | 'budget' | null>(null)
  const [budgets, setBudgets] = useState<Record<string, number>>(isBusiness ? { Marketing: 3000, Software: 1500 } : { Groceries: 300, Transport: 150 })
  const [newBudgetName, setNewBudgetName] = useState('')
  const [budgetAmountDraft, setBudgetAmountDraft] = useState<Record<string, number>>({})
  const [budgetPeriods, setBudgetPeriods] = useState<Record<string, 'MONTHLY' | 'WEEKLY' | 'CUSTOM'>>(Object.fromEntries(Object.keys(isBusiness ? { Marketing: 1, Software: 1 } : { Groceries: 1, Transport: 1 }).map(name => [name, 'MONTHLY'])))
  const [budgetPeriodDraft, setBudgetPeriodDraft] = useState<Record<string, 'MONTHLY' | 'WEEKLY' | 'CUSTOM'>>({})
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const additions = transactions.filter(item => item.type === 'expense' && (!finance.dashboard || (item.currency === finance.dashboard.currency && item.date >= finance.dashboard.period_start && item.date < finance.dashboard.period_end)))
  const summary = finance.dashboard
  const currency = summary?.currency ?? 'EUR'
  const euro = (value: number, code = currency) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: code }).format(value)
  const income = summary ? Number('income' in summary ? summary.income : summary.revenue) : 0
  const expenses = summary ? Number(summary.expenses) : 0
  const balance = summary && 'balance' in summary ? Number(summary.balance) : finance.accounts.filter(item => item.currency === currency).reduce((sum, item) => sum + Number(item.balance), 0)
  const displayName = user?.displayName || 'Your account'
  const initials = displayName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()
  const periodLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(summary ? new Date(`${summary.period_start}T12:00:00`) : new Date())

  function navigate(next: string) { if (next !== 'Transactions') setTransactionFilters({}); setView(next); setMobileMenu(false) }
  function connectBackendWorkspace() { setNotice('Use the workspace switcher to choose another accessible workspace.') }
  function openDialog(type: 'profile' | 'budget' | 'transaction', entry: 'income' | 'expense' = 'income') {
    if (type === 'transaction') { setTransactionAction({ type: entry }); return }
    setDialogType(type)
    if (type === 'budget') { setBudgetDraft(budgetTargets); setBudgetAmountDraft(budgets); setBudgetPeriodDraft(budgetPeriods); setNewBudgetName('') }
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
      <div className="flex items-center justify-between gap-[15px]"><h2>{all ? 'Your transactions' : 'Recent transactions'}</h2>{!all && <button className="border-0 bg-transparent p-0 text-[13px] text-[#193f33] hover:text-[#60815b]" onClick={() => navigate('Transactions')}>View all</button>}</div>
      <div className="mt-[22px] overflow-x-auto"><table className="w-full border-collapse text-left whitespace-nowrap [&_th]:pt-0 [&_th]:pr-[18px] [&_th]:pb-3 [&_th]:text-[10px] [&_th]:font-normal [&_th]:text-[#7d877f] [&_th]:uppercase [&_td]:border-t [&_td]:border-[#e1e5df] [&_td]:py-[13px] [&_td]:pr-[18px] [&_td]:text-[13px] [&_td]:text-[#7d877f] [&_td:first-child]:w-[31%]"><thead><tr>{['Transaction', 'Category', isBusiness ? 'Department' : 'Source', 'Date', 'Amount'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{(all ? transactions : transactions.slice(0, 3)).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{isBusiness ? item.department || '—' : item.source}</td><td>{formatDate(item.date)}</td><td className="!text-[#193f33] tabular-nums">{item.type === 'unknown' ? '' : item.amount > 0 ? '+' : '−'} {euro(Math.abs(item.amount), item.currency)}</td></tr>)}</tbody>
      </table></div>{transactions.length === 0 && <p className="py-8 text-sm text-[#7d877f]">No transactions yet. Add income or an expense to get started.</p>}
    </section>
  }
  function renderBudgets() {
    if (isBusiness) return <section className={cardClasses}><h2>Business spending plans</h2><p className="mt-3 text-sm text-[#7d877f]">View saved budgets and progress by category, department or project.</p><button className="mt-6 rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white" onClick={() => navigate('Budgets')}>Manage budgets</button></section>
    return <section className={`${cardClasses} min-w-0 [&>p]:mt-2`}><h2>{isBusiness ? 'Every budget, in view.' : 'Stay within your plans.'}</h2><p className="text-xs text-[#7d877f]">{periodLabel} spending · session budget limits</p>
      {finance.hasMore && <p className="mt-3 rounded-xl bg-[#eaf0e6] p-3 text-xs text-[#68796e]">Spending is based on loaded transactions in {currency}. Load more in Transactions to include older entries.</p>}
      {Object.keys(budgets).map((category) => {
        const spent = additions.filter((item) => item.category === category && (!budgetTargets[category]?.projectId || String(item.projectId) === budgetTargets[category].projectId) && (!budgetTargets[category]?.departmentId || String(item.departmentId) === budgetTargets[category].departmentId)).reduce((sum, item) => sum + Math.round(Math.max(-item.amount, 0) * 100), 0) / 100
        const limit = budgets[category]
        const percent = limit > 0 ? spent / limit * 100 : 0
        const exceeded = spent > limit
        const warning = !exceeded && percent >= 80
        return <article className="mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mt-1 [&_p]:text-[13px] [&_p]:text-[#7d877f]" key={category}><div className="flex items-start justify-between gap-3"><div><h3>{category === 'Groceries' ? 'Food & groceries' : category}</h3><p>{finance.hasMore ? `${euro(spent)} loaded spending · ${euro(limit)} limit` : `${euro(spent)} spent · ${euro(Math.max(0, limit - spent))} remaining of ${euro(limit)}`}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${exceeded ? 'bg-[#fae8e5] text-[#a43b32]' : warning ? 'bg-[#fff3d6] text-[#8a6200]' : 'bg-[#eaf0e6] text-[#486c43]'}`}>{exceeded ? 'Exceeded' : finance.hasMore ? 'Partial data' : warning ? 'Almost there' : 'On track'}</span></div>{isBusiness && budgetTargets[category]?.projectId && <p className="text-xs!">Project: {projectCatalog.projects.find(item => String(item.id) === budgetTargets[category].projectId)?.name || `Project ${budgetTargets[category].projectId}`}</p>}<progress className={`mt-[10px] block h-[7px] w-full appearance-none overflow-hidden rounded-md border-0 bg-[#dce4d8] [&::-webkit-progress-bar]:rounded-md [&::-webkit-progress-bar]:bg-[#dce4d8] [&::-webkit-progress-value]:rounded-md [&::-moz-progress-bar]:rounded-md ${exceeded ? '[&::-webkit-progress-value]:bg-[#b54f43] [&::-moz-progress-bar]:bg-[#b54f43]' : warning ? '[&::-webkit-progress-value]:bg-[#c38a19] [&::-moz-progress-bar]:bg-[#c38a19]' : '[&::-webkit-progress-value]:bg-[#193f33] [&::-moz-progress-bar]:bg-[#193f33]'}`} aria-label={`${category} budget used`} value={Math.min(spent, limit)} max={limit} /><span className="sr-only">{Math.round(percent)}% used</span></article>
      })}
      <button className="mt-10 border-0 bg-transparent p-0 text-[13px] text-[#193f33] hover:text-[#60815b]" onClick={() => openDialog('budget')}>Manage budgets</button>
    </section>
  }
  function renderChart() {
    if (!active) return null
    return <section className={cardClasses}><div className="flex items-center justify-between gap-4"><h2>{isBusiness ? 'Revenue & expenses' : 'Money in. Money out.'}</h2><span className="text-xs text-[#7d877f]">{periodLabel}</span></div>
      <div className="mt-6 h-[242px]" role="img" aria-label={`Income ${euro(income)}, expenses ${euro(expenses)} for ${periodLabel}.`}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Income', income }, { name: 'Expenses', expenses }]} margin={{ left: 4, right: 8 }}><CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="name" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} width={80} tickFormatter={(value: number) => euro(value)} /><Tooltip formatter={value => euro(Number(value))} /><Bar dataKey="income" name="Income" fill="#193f33" radius={[8, 8, 0, 0]} /><Bar dataKey="expenses" name="Expenses" fill="#98a56c" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>
    </section>
  }

  return <div className="flex min-h-svh bg-[#f7f8f2] font-sans text-[15px] leading-[1.5] tracking-[-.015em] text-[#193f33] scheme-light [&_h1]:font-sans! [&_h2]:font-sans! [&_h1]:font-semibold! [&_h2]:font-semibold! max-sm:block [&_button]:cursor-pointer [&_button]:transition-colors motion-reduce:[&_button]:transition-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#82965b] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-[#82965b]">
    <aside className={`min-h-svh w-[252px] shrink-0 flex-col bg-white px-[21px] pt-8 pb-6 max-[1200px]:w-[220px] max-[1200px]:px-4 min-[1600px]:w-[294px] min-[1600px]:px-[25px] min-[1600px]:py-[38px] sm:static sm:flex sm:shadow-none ${mobileMenu ? 'fixed inset-y-0 left-0 z-20 flex max-h-svh !w-[290px] max-w-[calc(100%_-_30px)] overflow-y-auto !px-5 !py-[25px] shadow-[15px_0_60px_#193f3326]' : 'hidden'}`}>
      {mobileMenu && <button className="mb-[10px] flex self-end border-0 bg-transparent p-1 sm:hidden" aria-label="Close workspace navigation" onClick={() => setMobileMenu(false)}><X size={20} /></button>}
      <Link to="/" className="flex items-center gap-[7px] px-[5px] text-[25px] font-semibold tracking-[-.04em]"><BrandMark className="size-5" />Fotosinteze</Link>
      <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} onSwitch={(id) => { setTransactionAction(null); setDeletingTransaction(null); setMobileMenu(false); onSwitch(id) }} onCreate={() => { setMobileMenu(false); onCreate() }} />
      <p className="mx-[9px] mt-[33px] mb-4 text-[10px] text-[#7d877f] uppercase">Workspace</p>
      <nav aria-label="Workspace" className="grid gap-2">{workspaceNavigation.map((item) => <button key={item} className={`rounded-[10px] border-0 px-[19px] py-[13px] text-left ${view === item ? 'bg-[#193f33] text-white' : 'bg-transparent text-[#7d877f] hover:bg-[#f1f4ec] hover:text-[#193f33]'}`} aria-current={view === item ? 'page' : undefined} onClick={() => navigate(item)}>{item}</button>)}</nav>
      <div className="mt-auto pt-[100px] max-[900px]:pt-[50px] max-sm:pt-6"><button className="flex w-full items-center gap-1 whitespace-nowrap border-t border-[#e1e5df] bg-transparent px-1 py-[21px] text-xs text-[#193f33] hover:text-[#60815b]" onClick={() => { setMobileMenu(false); onCreate() }}><Plus size={16} />Create business workspace</button>
        <div className="mx-1 mt-[35px] mb-[23px] flex items-center gap-3 max-sm:mt-3 [&>div]:grid [&>div]:min-w-0 [&_strong]:text-sm [&_strong]:wrap-anywhere [&_div_span]:text-xs [&_div_span]:text-[#7d877f]"><span className="grid size-[39px] shrink-0 place-items-center rounded-full bg-[#ecf0e6] text-xs">{initials}</span><div><strong>{displayName}</strong><span>{isBusiness ? workspace.role === 'EMPLOYEE' ? 'Workspace employee' : 'Workspace owner' : 'Personal account'}</span></div></div>
        <button className="mx-[7px] block border-0 bg-transparent p-0 text-[13px] text-[#7d877f] hover:text-[#60815b]" onClick={() => openDialog('profile')}>Profile & account</button>
        <button className="mx-[7px] mt-[14px] border-0 bg-transparent p-0 text-[11px] text-[#7d877f] hover:text-[#60815b]" onClick={handleLogout}>Log out</button>
        {logoutError && <p role="alert" className="mt-3 text-xs text-[#a43b32]">{logoutError}</p>}
      </div>
    </aside>
    <main className="mx-auto min-w-0 max-w-[1800px] flex-1 px-[42px] pt-8 pb-11 max-[1200px]:px-[26px] max-[1200px]:py-[25px] max-sm:px-[18px] max-sm:pt-5 max-sm:pb-7 min-[1600px]:px-[50px] min-[1600px]:pt-10 min-[1600px]:pb-[50px]">
      <header className="flex items-center justify-between border-b border-[#e1e5df] pb-[23px] max-sm:pb-[18px] [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&_div_span]:text-[11px] [&_div_span]:text-[#7d877f] [&_div_span]:uppercase max-sm:[&_div_span]:text-[9px] [&>span]:pr-[9%] [&>span]:text-sm max-sm:[&>span]:pr-0 max-sm:[&>span]:text-xs"><div><button className="inline-flex border-0 bg-transparent p-[3px] sm:hidden" aria-label="Toggle workspace navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button><span>{isBusiness ? `Business workspace / ${workspace.role === 'EMPLOYEE' ? 'Employee' : 'Owner'}` : 'Personal workspace'}</span></div><span>{isBusiness && view === 'Budgets' ? 'Budget planning' : periodLabel}</span></header>
      <div className="mt-7 flex items-center justify-between gap-[22px] max-[1200px]:flex-col max-[1200px]:items-start max-sm:mt-[25px] [&_h1]:m-0 [&_h1]:text-[clamp(25px,2.45vw,40px)] [&_h1]:leading-[1.2] [&_h1]:font-semibold [&_h1]:tracking-[-.035em] max-sm:[&_h1]:max-w-[330px] max-sm:[&_h1]:text-[29px] [&_p]:mt-3 [&_p]:text-[15px] [&_p]:text-[#7d877f] max-sm:[&_p]:text-[13px]"><div><h1>{view === 'Dashboard' ? isBusiness ? 'Your business, at a glance.' : 'A little clarity for your everyday.' : view === 'Transactions' ? 'Every transaction, in its place.' : view}</h1><p>{isBusiness ? view === 'Transactions' ? 'Search, organise and follow the details behind your business.' : 'Track the money. Give every plan room to grow.' : view === 'Dashboard' ? 'Your balance, spending and goals — all in their own place.' : 'A clearer picture of your personal finances.'}</p></div>
        {!(isBusiness && view === 'Budgets') && <div className="flex shrink-0 gap-[13px] max-sm:w-full max-sm:gap-[10px] max-sm:[&_button]:flex-1 max-sm:[&_button]:text-[13px]"><button className="inline-flex min-h-12 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] border-0 bg-[#eaf0e6] px-[18px] py-3 text-[#193f33] hover:bg-[#dce6d4]" onClick={() => openDialog('transaction', 'income')}><Plus size={18} />Add income</button><button className={primaryButtonClasses} onClick={() => openDialog('transaction', 'expense')}><span aria-hidden>−</span>Add expense</button></div>}
      </div>
      <div className="mt-6 mb-[19px] flex flex-wrap items-center gap-4 text-xs text-[#7d877f]"><span>{periodLabel} · {currency}</span><span>{view === 'Budgets' && !isBusiness ? 'Budget limits are saved for this session.' : 'Connected to your workspace'}</span></div>
      {finance.loading && ((!isBusiness && view === 'Dashboard') || view === 'Transactions') && <p role="status" className="mb-4 text-sm">Loading your financial data…</p>}
      {finance.error && ((!isBusiness && view === 'Dashboard') || view === 'Transactions') && <div className="mb-4 rounded-xl bg-[#fcf0ed] p-4"><p role="alert">{finance.error}</p><button type="button" onClick={finance.refresh} className="mt-3 underline">Retry financial data</button></div>}
      {notice && <p role="status" className="mb-[18px] flex items-center justify-between rounded-[10px] bg-[#eaf0e5] px-4 py-3 text-[13px] [&_button]:border-0 [&_button]:bg-transparent">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></p>}
      {!isBusiness && (view === 'Dashboard' || view === 'Statistics') && !finance.loading && !finance.error && <><section className="grid grid-cols-4 gap-[17px] max-[900px]:grid-cols-2 max-sm:gap-[10px]" aria-label="Monthly overview">
        {(isBusiness ? [{ label: 'Revenue', value: income, note: 'Income across your business workspace' }, { label: 'Expenses', value: expenses, note: `${income ? (expenses / income * 100).toFixed(1) : '0.0'}% of revenue` }, { label: 'Net profit', value: income - expenses, note: `${income ? ((income - expenses) / income * 100).toFixed(1) : '0.0'}% profit margin` }, { label: 'Current balance', value: balance, note: 'Across your business workspace' }] : [{ label: 'Current balance', value: balance, note: 'Opening balance + this month’s activity' }, { label: 'Income this month', value: income, note: 'Salary and other income' }, { label: 'Expenses this month', value: expenses, note: `${income ? (expenses / income * 100).toFixed(1) : '0.0'}% of monthly income` }, { label: 'Saved this month', value: income - expenses, note: `${income ? ((income - expenses) / income * 100).toFixed(1) : '0.0'}% savings rate` }]).map((item) => <article className={`min-w-0 rounded-2xl ${item.label === (isBusiness ? 'Net profit' : 'Saved this month') ? 'bg-[#d5f579]' : 'bg-white'} px-[23px] pt-5 pb-[23px] max-[1200px]:px-[15px] max-[1200px]:py-[18px] min-[1600px]:px-7 min-[1600px]:py-[25px]  [&_p]:text-sm [&_p]:text-[#7d877f] max-sm:[&_p]:text-xs [&_strong]:mt-3 [&_strong]:mb-[11px] [&_strong]:block [&_strong]:text-[clamp(24px,2.35vw,36px)] [&_strong]:leading-[1.3] [&_strong]:font-[650] [&_strong]:tracking-[-.035em] max-sm:[&_strong]:text-[25px] [&_span]:text-[11px] [&_span]:text-[#7d877f] max-sm:[&_span]:text-[10px] data-[highlight=true]:[&_p]:text-[#688044] data-[highlight=true]:[&_span]:text-[#688044]`} data-highlight={item.label === (isBusiness ? 'Net profit' : 'Saved this month')} key={item.label}><p>{item.label}</p><strong>{euro(item.value)}</strong><span>{item.note}</span></article>)}
      </section><div className="my-[25px] grid grid-cols-[minmax(0,1.92fr)_minmax(270px,1fr)] gap-6 max-[1200px]:grid-cols-[minmax(0,1.6fr)_minmax(235px,1fr)] max-[1200px]:gap-[18px] max-[900px]:grid-cols-1 min-[1600px]:my-[30px] min-[1600px]:gap-[30px]">{renderChart()}{renderBudgets()}</div></>}
      {!isBusiness && view === 'Dashboard' && !finance.loading && !finance.error && renderTransactions()}
      {active && isBusiness && (view === 'Dashboard' || view === 'Statistics') && <BusinessDashboard finance={finance} workspaceName={workspace.name} role={workspace.role ?? 'EMPLOYEE'} onViewTransactions={() => navigate('Transactions')} showRecent={view === 'Dashboard'} />}
      {view === 'Transactions' && <TransactionsView transactions={transactions} income={income} expenses={expenses} workspaceName={workspace.name} workspaceKind={workspace.kind} currency={currency} onEdit={editTransaction} onDelete={id => { const transaction = finance.rows.find(item => item.transaction_id === id); if (transaction && transaction.expense_id === null) setDeletingTransaction(transaction) }} loading={finance.transactionsLoading} error={finance.transactionsError} hasMore={finance.hasMore} filterOptions={{ categories: finance.options.categories, departments: projectCatalog.departments, projects: projectCatalog.projects }} onFilterChange={next => setTransactionFilters(previous => ({ ...previous, ...next }))} />}
      {view === 'Transactions' && finance.hasMore && <button type="button" disabled={finance.loadingMore} onClick={finance.loadMore} className="mt-5 rounded-xl bg-[#eaf0e6] px-5 py-3 text-sm disabled:opacity-50">{finance.loadingMore ? 'Loading…' : 'Load more transactions'}</button>}
      {isBusiness && view === 'Expense requests' && <ExpenseRequests key={backendWorkspaceId} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} catalog={projectCatalog} onApproved={() => finance.refresh()} />}
      {active && view === 'Budgets' && (isBusiness ? <BusinessBudgets key={backendWorkspaceId} workspaceId={backendWorkspaceId} catalog={projectCatalog} onConnect={connectBackendWorkspace} /> : renderBudgets())}
      {active && view === 'Categories' && <CategoryManager canManage={!isBusiness || workspace.role === 'OWNER'} workspaceName={workspace.name} workspaceKind={workspace.kind} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} />}
      {active && !isBusiness && (view === 'Dashboard' || view === 'Revolut') && <RevolutConnect key={backendWorkspaceId} workspaceId={backendWorkspaceId} />}

      {active && isBusiness && view === 'Projects' && <ProjectManager catalog={projectCatalog} workspaceName={workspace.name} canManage={canManageProjects} />}
      {active && isBusiness && view === 'Departments' && <DepartmentManager key={backendWorkspaceId} workspaceId={backendWorkspaceId} workspaceName={workspace.name} canManage={workspace.role === 'OWNER'} />}
      {active && isBusiness && workspace.role === 'OWNER' && view === 'Employees' && <TeamManager section="Employees" data={team} onChange={setTeam} ownerName={displayName} />}
      {isBusiness && view === 'Settings' && <section className={cardClasses}><h2>{workspace.name}</h2><p className="mt-3 text-sm text-[#68796e]">Business workspace · {workspace.role === 'EMPLOYEE' ? 'Employee' : 'Owner'} · Currency: EUR</p></section>}
    </main>
    <dialog ref={dialog} className="m-auto max-h-[calc(100svh-40px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[18px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/35 backdrop:backdrop-blur-[3px] [&_h2]:m-0 [&_h2]:text-[23px] [&_h2]:font-semibold" aria-labelledby="dashboard-dialog-title">
      <div className="flex items-center justify-between gap-[15px]"><h2 id="dashboard-dialog-title">{dialogType === 'budget' ? 'Manage your budgets' : 'Your account'}</h2><button className="rounded-full border-0 bg-[#eff2e9] p-[6px]" aria-label="Close dialog" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {dialogType === 'budget' && <form className={formClasses} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = Object.fromEntries(Object.keys(budgetAmountDraft).map(name => [name, Number(data.get(`amount-${name}`))])); setBudgets(next); setBudgetPeriods(Object.fromEntries(Object.keys(next).map(name => [name, budgetPeriodDraft[name] || 'MONTHLY']))); setBudgetTargets(Object.fromEntries(Object.keys(next).map((name, index) => [name, { departmentId: String(data.get(`budget-${index}-department_id`) || ''), projectId: String(data.get(`budget-${index}-project_id`) || '') }]))); setNotice('Budgets updated for this sample workspace.'); dialog.current?.close() }}><p className="text-xs text-[#7d877f]">Set a spending limit and period for each budget.</p>{Object.keys(budgetAmountDraft).map((category, index) => <fieldset key={category} className="grid gap-4 rounded-xl border border-[#dce4d8] p-4"><legend className="px-1 text-sm font-medium">{category}</legend><label>Limit (€)<input aria-label={`${category} (€)`} name={`amount-${category}`} type="number" min="0.01" max="999999999" step="0.01" value={budgetAmountDraft[category]} onChange={event => setBudgetAmountDraft(previous => ({ ...previous, [category]: Number(event.target.value) }))} required /></label><label>Period<select aria-label={`Period ${category}`} value={budgetPeriodDraft[category] || 'MONTHLY'} onChange={event => setBudgetPeriodDraft(previous => ({ ...previous, [category]: event.target.value as 'MONTHLY' | 'WEEKLY' | 'CUSTOM' }))}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="CUSTOM">Custom</option></select></label><button type="button" className="justify-self-start border-0 bg-transparent p-0 text-xs text-[#a43b32]" onClick={() => { setBudgetAmountDraft(previous => { const updated = { ...previous }; delete updated[category]; return updated }); setBudgetPeriodDraft(previous => { const updated = { ...previous }; delete updated[category]; return updated }) }}>Delete {category}</button>{isBusiness && <ProjectFields catalog={projectCatalog} namePrefix={`budget-${index}-`} departmentId={budgetDraft[category]?.departmentId || ''} projectId={budgetDraft[category]?.projectId || ''} onDepartmentChange={departmentId => setBudgetDraft(previous => ({ ...previous, [category]: { ...previous[category], departmentId, projectId: previous[category]?.projectId || '' } }))} onProjectChange={projectId => setBudgetDraft(previous => ({ ...previous, [category]: { departmentId: previous[category]?.departmentId || '', projectId } }))} />}</fieldset>)}<div className="grid gap-2 rounded-xl bg-[#f7f8f2] p-4"><label>New budget name<input value={newBudgetName} onChange={event => setNewBudgetName(event.target.value)} maxLength={100} placeholder="e.g. Travel" /></label><button type="button" className="justify-self-start border-0 bg-transparent p-0 text-sm font-medium text-[#193f33]" onClick={() => { const name = newBudgetName.trim(); if (!name || Object.keys(budgetAmountDraft).some(item => item.toLowerCase() === name.toLowerCase())) return; setBudgetAmountDraft(previous => ({ ...previous, [name]: 100 })); setBudgetPeriodDraft(previous => ({ ...previous, [name]: 'MONTHLY' })); setNewBudgetName('') }}>+ Add budget</button></div><button className={primaryButtonClasses} type="submit">Save budgets</button></form>}
      {dialogType === 'profile' && <div className={formClasses}><strong>{displayName}</strong><p>{user?.email}</p><p className="text-xs text-[#7d877f]">{workspace.name} workspace</p><button className={primaryButtonClasses} onClick={handleLogout}>Log out</button>{logoutError && <p role="alert">{logoutError}</p>}</div>}
    </dialog>
    {active && deletingTransaction && <DeleteTransactionDialog key={`${backendWorkspaceId}-${deletingTransaction.transaction_id}`} workspaceId={backendWorkspaceId} transaction={deletingTransaction} onClose={() => setDeletingTransaction(null)} onDeleted={() => { setDeletingTransaction(null); setNotice('Transaction deleted.') }} />}
    {active && transactionAction && <TransactionForm key={`${backendWorkspaceId}-${transactionAction.transaction?.transaction_id ?? transactionAction.type}`} workspaceId={backendWorkspaceId} type={transactionAction.type} transaction={transactionAction.transaction} options={finance.options} role={workspace.role} catalog={isBusiness ? projectCatalog : undefined} onClose={() => setTransactionAction(null)} onSaved={() => { setTransactionAction(null); setNotice(transactionAction.transaction ? 'Transaction updated.' : 'Transaction saved.') }} />}
  </div>
}

function WorkspaceHome() {
  const state = useWorkspace()
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const workspaces: Workspace[] = state.workspaces.map(item => ({ id: String(item.id), name: item.name, kind: item.type === 'PERSONAL' ? 'personal' : 'business', role: item.role }))
  const createDialog = creating && <CreateBusinessDialog key={user?.id} workspaces={workspaces} onCreate={state.createBusiness} onClose={() => setCreating(false)} />
  if (state.status === 'unauthenticated') return null
  if (state.status === 'loading') return <main className="grid min-h-svh place-items-center bg-[#f7f8f2] text-[#193f33]"><p role="status">Loading your workspaces…</p></main>
  if (state.status === 'error') return <main className="grid min-h-svh place-items-center bg-[#f7f8f2] p-6 text-[#193f33]"><div className="rounded-2xl bg-white p-6"><p role="alert">{state.error}</p><button onClick={state.retry} className="mt-4 rounded-xl bg-[#193f33] px-5 py-3 text-white">Retry</button></div></main>
  if (!state.activeWorkspace) return <><main className="grid min-h-svh place-items-center bg-[#f7f8f2] p-6 text-[#193f33]"><div><h1 className="text-xl font-semibold">No accessible workspaces</h1><p className="mt-2">Refresh your memberships or create a business workspace to get started.</p><div className="mt-4 flex flex-wrap gap-4"><button onClick={() => setCreating(true)} className="rounded-xl bg-[#193f33] px-5 py-3 text-white">Create business workspace</button><button onClick={state.retry} className="underline">Refresh workspaces</button></div></div></main>{createDialog}</>
  return <>{workspaces.map(workspace => <div key={`${user?.id}-${workspace.id}`} hidden={workspace.id !== String(state.activeWorkspace!.id)}><WorkspaceDashboard workspace={workspace} workspaces={workspaces} active={workspace.id === String(state.activeWorkspace!.id)} onSwitch={id => state.selectWorkspace(Number(id))} onCreate={() => setCreating(true)} /></div>)}{createDialog}</>
}

function HomePage() { return <WorkspaceProvider><WorkspaceHome /></WorkspaceProvider> }
export default HomePage
