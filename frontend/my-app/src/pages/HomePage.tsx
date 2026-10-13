import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Menu, Plus, X } from 'lucide-react'

import { BrandMark } from '@/components/brand/BrandMark'
import { useAuth } from '@/features/auth/use-auth'
import { CategoryManager } from '@/features/categories/CategoryManager'
import { WorkspaceSwitcher, CreateBusinessDialog, type Workspace } from '@/features/workspaces/WorkspaceControls'
import { TeamManager } from '@/features/workspaces/TeamManager'
import { ProjectManager, ProjectFields } from '@/features/projects/ProjectManager'
import { useProjectCatalog } from '@/features/projects/use-project-catalog'
import type { TeamData, TeamSection } from '@/features/workspaces/team-types'
import { TransactionsView, type WorkspaceTransaction } from '@/features/workspaces/TransactionsView'

type Transaction = WorkspaceTransaction
const initialTransactions: Transaction[] = [
  { id: 1, name: 'Monthly salary', category: 'Salary', source: 'Manual', date: '2026-09-22', amount: 3200 },
  { id: 2, name: 'Rimi', category: 'Groceries', source: 'Revolut', date: '2026-09-21', amount: -28.54 },
  { id: 3, name: 'Spotify Premium', category: 'Subscriptions', source: 'Revolut', date: '2026-09-20', amount: -10.99 },
]
const history = [
  { month: 'Apr', income: 1300, expenses: 1100 }, { month: 'May', income: 2000, expenses: 1450 },
  { month: 'Jun', income: 2450, expenses: 1600 }, { month: 'Jul', income: 2900, expenses: 1850 },
  { month: 'Aug', income: 3150, expenses: 2100 }, { month: 'Sep', income: 3200, expenses: 1842.35 },
]
const navigation = ['Dashboard', 'Transactions', 'Budgets', 'Categories', 'Statistics', 'Revolut'] as const
const euro = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value)
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
  const workspaceNavigation = isBusiness ? ['Dashboard', 'Transactions', 'Budgets', 'Categories', 'Departments', 'Projects', 'Employees', 'Statistics', 'Settings'] : navigation
  const { user, logout } = useAuth()
  const [team, setTeam] = useState<TeamData>({ departments: [], employees: [], projects: [] })
  const [backendWorkspaceId, setBackendWorkspaceId] = useState<number>()
  const projectCatalog = useProjectCatalog(backendWorkspaceId, isBusiness && active)
  const canManageProjects = workspace.role !== 'EMPLOYEE'
  const [transactionDepartmentId, setTransactionDepartmentId] = useState('')
  const [transactionProjectId, setTransactionProjectId] = useState('')
  const [budgetTargets, setBudgetTargets] = useState<Record<string, { departmentId: string; projectId: string }>>({})
  const [budgetDraft, setBudgetDraft] = useState<typeof budgetTargets>({})
  const [view, setView] = useState<string>('Dashboard')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>(isBusiness ? [] : initialTransactions)
  const [entryType, setEntryType] = useState<'income' | 'expense'>('income')
  const [dialogType, setDialogType] = useState<'transaction' | 'profile' | 'budget'>('transaction')
  const [budgets, setBudgets] = useState<Record<string, number>>(isBusiness ? { Marketing: 3000, Software: 1500 } : { Groceries: 300, Transport: 150 })
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const additions = transactions.filter((item) => item.id > 3)
  const income = (isBusiness ? 0 : 3200) + additions.reduce((sum, item) => sum + Math.max(item.amount, 0), 0)
  const expenses = (isBusiness ? 0 : 1842.35) + additions.reduce((sum, item) => sum + Math.max(-item.amount, 0), 0)
  const balance = (isBusiness ? 0 : 4820.5) + additions.reduce((sum, item) => sum + item.amount, 0)
  const displayName = user?.displayName || 'Your account'
  const initials = displayName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()
  const chartData = history.map((item) => item.month === 'Sep' ? { ...item, income, expenses } : isBusiness ? { ...item, income: 0, expenses: 0 } : item)

  function navigate(next: string) { setView(next); setMobileMenu(false) }
  function connectBackendWorkspace(id: number | undefined) {
    setBackendWorkspaceId(id)
    setTransactionDepartmentId('')
    setTransactionProjectId('')
    setBudgetTargets({})
    setBudgetDraft({})
  }
  function openDialog(type: typeof dialogType, entry: typeof entryType = 'income') {
    setDialogType(type); setEntryType(entry)
    if (type === 'transaction') { setTransactionDepartmentId(''); setTransactionProjectId('') }
    if (type === 'budget') setBudgetDraft(budgetTargets)
    dialog.current?.showModal()
  }
  function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const amount = Number(data.get('amount'))
    if (!Number.isFinite(amount) || amount <= 0) return
    const item: Transaction = {
      id: Date.now(), createdBy: displayName, name: String(data.get('name')).trim(), category: String(data.get('category')),
      source: 'Manual', department: projectCatalog.departments.find(item => String(item.id) === data.get('department_id'))?.name || '', project: projectCatalog.projects.find(item => String(item.id) === data.get('project_id'))?.name || '', departmentId: Number(data.get('department_id')) || undefined, projectId: Number(data.get('project_id')) || undefined, date: String(data.get('date')), amount: entryType === 'income' ? amount : -amount,
    }
    if (!item.name) return
    setTransactions((current) => [item, ...current].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id))
    setNotice(`${entryType === 'income' ? 'Income' : 'Expense'} added to your sample workspace.`)
    dialog.current?.close()
  }
  async function handleLogout() {
    setLogoutError(null)
    try { await logout() } catch { setLogoutError('Could not log out. Please try again.') }
  }

  function renderTransactions(all = false) {
    return <section className={`${cardClasses} mt-6 !pb-[17px]`}>
      <div className="flex items-center justify-between gap-[15px]"><h2>{all ? 'Your transactions' : 'Recent transactions'}</h2>{!all && <button className="border-0 bg-transparent p-0 text-[13px] text-[#193f33] hover:text-[#60815b]" onClick={() => navigate('Transactions')}>View all</button>}</div>
      <div className="mt-[22px] overflow-x-auto"><table className="w-full border-collapse text-left whitespace-nowrap [&_th]:pt-0 [&_th]:pr-[18px] [&_th]:pb-3 [&_th]:text-[10px] [&_th]:font-normal [&_th]:text-[#7d877f] [&_th]:uppercase [&_td]:border-t [&_td]:border-[#e1e5df] [&_td]:py-[13px] [&_td]:pr-[18px] [&_td]:text-[13px] [&_td]:text-[#7d877f] [&_td:first-child]:w-[31%]"><thead><tr>{['Transaction', 'Category', isBusiness ? 'Department' : 'Source', 'Date', 'Amount'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{(all ? transactions : transactions.slice(0, 3)).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{isBusiness ? item.department || '—' : item.source}</td><td>{formatDate(item.date)}</td><td className="!text-[#193f33] tabular-nums">{item.amount > 0 ? '+' : '−'} {euro(Math.abs(item.amount))}</td></tr>)}</tbody>
      </table></div>{transactions.length === 0 && <p className="py-8 text-sm text-[#7d877f]">No transactions yet. Add income or an expense to get started.</p>}
    </section>
  }
  function renderBudgets() {
    return <section className={`${cardClasses} min-w-0 [&>p]:mt-2`}><h2>{isBusiness ? 'Every budget, in view.' : 'Stay within your plans.'}</h2><p className="text-xs text-[#7d877f]">September budget progress</p>
      {Object.keys(budgets).map((category) => {
        const spent = (isBusiness ? 0 : category === 'Groceries' ? 217 : 92) + additions.filter((item) => item.category === category && (!budgetTargets[category]?.projectId || String(item.projectId) === budgetTargets[category].projectId) && (!budgetTargets[category]?.departmentId || String(item.departmentId) === budgetTargets[category].departmentId)).reduce((sum, item) => sum + Math.max(-item.amount, 0), 0)
        return <div className="mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mt-1 [&_p]:text-[13px] [&_p]:text-[#7d877f]" key={category}><h3>{category === 'Groceries' ? 'Food & groceries' : category}</h3><p>{euro(spent)} of {euro(budgets[category])}</p>{isBusiness && budgetTargets[category]?.projectId && <p className="text-xs!">Project: {projectCatalog.projects.find(item => String(item.id) === budgetTargets[category].projectId)?.name || `Project ${budgetTargets[category].projectId}`}</p>}<progress className="mt-[10px] block h-[7px] w-full appearance-none overflow-hidden rounded-md border-0 bg-[#dce4d8] [&::-webkit-progress-bar]:rounded-md [&::-webkit-progress-bar]:bg-[#dce4d8] [&::-webkit-progress-value]:rounded-md [&::-webkit-progress-value]:bg-[#193f33] [&::-moz-progress-bar]:rounded-md [&::-moz-progress-bar]:bg-[#193f33]" aria-label={`${category} budget used`} value={spent} max={budgets[category]} /><span className="sr-only">{Math.round(spent / budgets[category] * 100)}% used</span></div>
      })}
      <button className="mt-10 border-0 bg-transparent p-0 text-[13px] text-[#193f33] hover:text-[#60815b]" onClick={() => openDialog('budget')}>Manage budgets</button>
    </section>
  }
  function renderChart() {
    if (!active) return null
    return <section className={cardClasses}><div className="flex items-center justify-between gap-[15px]"><h2>{isBusiness ? 'Revenue & expenses' : 'Money in. Money out.'}</h2><span className="text-xs text-[#7d877f]">6 months</span></div>
      <div className="mt-2 flex gap-[54px] text-xs text-[#68796e] [&_span]:flex [&_span]:items-center [&_span]:gap-[5px] [&_i]:size-[10px] [&_i]:rounded-full [&_i]:bg-[#193f33] [&_span:last-child_i]:bg-[#98a56c]"><span><i />{isBusiness ? 'Revenue' : 'Income'}</span><span><i />Expenses</span></div>
      <div className="mt-[14px] h-[242px] max-sm:h-[220px] min-[1600px]:h-[285px]" role="img" aria-label={`Income and expenses from April to September 2026. September income ${euro(income)}, expenses ${euro(expenses)}.`}>
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 20, right: 8, left: -18, bottom: 12 }}>
          <CartesianGrid vertical={false} stroke="#e1e5df" /><XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={12} height={40} tick={{ fill: '#7a847e', fontSize: 12 }} />
          <YAxis domain={isBusiness ? [0, (dataMax: number) => Math.max(15000, dataMax)] : [0, 'auto']} ticks={isBusiness ? [0, 5000, 10000, 15000] : [1000, 2000, 3000, 4000]} interval={0} axisLine={false} tickLine={false} tickFormatter={(value: number) => `€${value / 1000}k`} tick={{ fill: '#7a847e', fontSize: 12 }} />
          <Tooltip formatter={(value) => euro(Number(value))} contentStyle={{ borderRadius: 10, borderColor: '#e1e5df' }} />
          <Area name="Income" type="monotone" dataKey="income" stroke="#193f33" strokeWidth={3} fill="#eaf0e5" fillOpacity={1} />
          <Line name="Expenses" type="monotone" dataKey="expenses" stroke="#98a56c" strokeWidth={2} strokeDasharray="5 6" dot={false} />
        </ComposedChart></ResponsiveContainer>
      </div>
    </section>
  }

  return <div className="flex min-h-svh bg-[#f7f8f2] font-sans text-[15px] leading-[1.5] tracking-[-.015em] text-[#193f33] scheme-light [&_h1]:font-sans! [&_h2]:font-sans! [&_h1]:font-semibold! [&_h2]:font-semibold! max-sm:block [&_button]:cursor-pointer [&_button]:transition-colors motion-reduce:[&_button]:transition-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#82965b] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-[#82965b]">
    <aside className={`min-h-svh w-[252px] shrink-0 flex-col bg-white px-[21px] pt-8 pb-6 max-[1200px]:w-[220px] max-[1200px]:px-4 min-[1600px]:w-[294px] min-[1600px]:px-[25px] min-[1600px]:py-[38px] sm:static sm:flex sm:shadow-none ${mobileMenu ? 'fixed inset-y-0 left-0 z-20 flex max-h-svh !w-[290px] max-w-[calc(100%_-_30px)] overflow-y-auto !px-5 !py-[25px] shadow-[15px_0_60px_#193f3326]' : 'hidden'}`}>
      {mobileMenu && <button className="mb-[10px] flex self-end border-0 bg-transparent p-1 sm:hidden" aria-label="Close workspace navigation" onClick={() => setMobileMenu(false)}><X size={20} /></button>}
      <Link to="/" className="flex items-center gap-[7px] px-[5px] text-[25px] font-semibold tracking-[-.04em]"><BrandMark className="size-5" />Fotosinteze</Link>
      <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} onSwitch={(id) => { setMobileMenu(false); onSwitch(id) }} onCreate={() => { setMobileMenu(false); onCreate() }} />
      <p className="mx-[9px] mt-[33px] mb-4 text-[10px] text-[#7d877f] uppercase">Workspace</p>
      <nav aria-label="Workspace" className="grid gap-2">{workspaceNavigation.map((item) => <button key={item} className={`rounded-[10px] border-0 px-[19px] py-[13px] text-left ${view === item ? 'bg-[#193f33] text-white' : 'bg-transparent text-[#7d877f] hover:bg-[#f1f4ec] hover:text-[#193f33]'}`} aria-current={view === item ? 'page' : undefined} onClick={() => navigate(item)}>{item}</button>)}</nav>
      <div className="mt-auto pt-[100px] max-[900px]:pt-[50px] max-sm:pt-6"><button className="flex w-full items-center gap-1 whitespace-nowrap border-t border-[#e1e5df] bg-transparent px-1 py-[21px] text-xs text-[#193f33] hover:text-[#60815b]" onClick={() => { setMobileMenu(false); onCreate() }}><Plus size={16} />Create business workspace</button>
        <div className="mx-1 mt-[35px] mb-[23px] flex items-center gap-3 max-sm:mt-3 [&>div]:grid [&>div]:min-w-0 [&_strong]:text-sm [&_strong]:wrap-anywhere [&_div_span]:text-xs [&_div_span]:text-[#7d877f]"><span className="grid size-[39px] shrink-0 place-items-center rounded-full bg-[#ecf0e6] text-xs">{initials}</span><div><strong>{displayName}</strong><span>{isBusiness ? 'Workspace owner' : 'Personal account'}</span></div></div>
        <button className="mx-[7px] block border-0 bg-transparent p-0 text-[13px] text-[#7d877f] hover:text-[#60815b]" onClick={() => openDialog('profile')}>Profile & account</button>
        <button className="mx-[7px] mt-[14px] border-0 bg-transparent p-0 text-[11px] text-[#7d877f] hover:text-[#60815b]" onClick={handleLogout}>Log out</button>
        {logoutError && <p role="alert" className="mt-3 text-xs text-[#a43b32]">{logoutError}</p>}
      </div>
    </aside>
    <main className="mx-auto min-w-0 max-w-[1800px] flex-1 px-[42px] pt-8 pb-11 max-[1200px]:px-[26px] max-[1200px]:py-[25px] max-sm:px-[18px] max-sm:pt-5 max-sm:pb-7 min-[1600px]:px-[50px] min-[1600px]:pt-10 min-[1600px]:pb-[50px]">
      <header className="flex items-center justify-between border-b border-[#e1e5df] pb-[23px] max-sm:pb-[18px] [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&_div_span]:text-[11px] [&_div_span]:text-[#7d877f] [&_div_span]:uppercase max-sm:[&_div_span]:text-[9px] [&>span]:pr-[9%] [&>span]:text-sm max-sm:[&>span]:pr-0 max-sm:[&>span]:text-xs"><div><button className="inline-flex border-0 bg-transparent p-[3px] sm:hidden" aria-label="Toggle workspace navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</button><span>{isBusiness ? 'Business workspace / Owner' : 'Personal workspace'}</span></div><span>September 2026</span></header>
      <div className="mt-7 flex items-center justify-between gap-[22px] max-[1200px]:flex-col max-[1200px]:items-start max-sm:mt-[25px] [&_h1]:m-0 [&_h1]:text-[clamp(25px,2.45vw,40px)] [&_h1]:leading-[1.2] [&_h1]:font-semibold [&_h1]:tracking-[-.035em] max-sm:[&_h1]:max-w-[330px] max-sm:[&_h1]:text-[29px] [&_p]:mt-3 [&_p]:text-[15px] [&_p]:text-[#7d877f] max-sm:[&_p]:text-[13px]"><div><h1>{view === 'Dashboard' ? isBusiness ? 'Your business, at a glance.' : 'A little clarity for your everyday.' : view === 'Transactions' ? 'Every transaction, in its place.' : view}</h1><p>{isBusiness ? view === 'Transactions' ? 'Search, organise and follow the details behind your business.' : 'Track the money. Give every plan room to grow.' : view === 'Dashboard' ? 'Your balance, spending and goals — all in their own place.' : 'A clearer picture of your personal finances.'}</p></div>
        <div className="flex shrink-0 gap-[13px] max-sm:w-full max-sm:gap-[10px] max-sm:[&_button]:flex-1 max-sm:[&_button]:text-[13px]"><button className="inline-flex min-h-12 items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] border-0 bg-[#eaf0e6] px-[18px] py-3 text-[#193f33] hover:bg-[#dce6d4]" onClick={() => openDialog('transaction', 'income')}><Plus size={18} />Add income</button><button className={primaryButtonClasses} onClick={() => openDialog('transaction', 'expense')}><span aria-hidden>−</span>Add expense</button></div>
      </div>
      <div className="mt-6 mb-[19px] flex flex-wrap items-center gap-[15px] text-xs text-[#7d877f] max-sm:mt-5 max-sm:gap-2">{view === 'Categories' || (isBusiness && view === 'Projects') ? <span>{view} are saved to your connected backend workspace.</span> : <><span>1–30 September 2026</span><span className="rounded-[5px] bg-[#edf0e8] px-[7px] py-[3px] text-[10px]">Sample workspace · changes last for this session</span></>}</div>
      {notice && <p role="status" className="mb-[18px] flex items-center justify-between rounded-[10px] bg-[#eaf0e5] px-4 py-3 text-[13px] [&_button]:border-0 [&_button]:bg-transparent">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></p>}
      {(view === 'Dashboard' || view === 'Statistics') && <><section className="grid grid-cols-4 gap-[17px] max-[900px]:grid-cols-2 max-sm:gap-[10px]" aria-label="Monthly overview">
        {(isBusiness ? [{ label: 'Revenue', value: income, note: 'Income across your business workspace' }, { label: 'Expenses', value: expenses, note: `${income ? (expenses / income * 100).toFixed(1) : '0.0'}% of revenue` }, { label: 'Net profit', value: income - expenses, note: `${income ? ((income - expenses) / income * 100).toFixed(1) : '0.0'}% profit margin` }, { label: 'Current balance', value: balance, note: 'Across your business workspace' }] : [{ label: 'Current balance', value: balance, note: 'Opening balance + this month’s activity' }, { label: 'Income this month', value: income, note: 'Salary and other income' }, { label: 'Expenses this month', value: expenses, note: `${(expenses / income * 100).toFixed(1)}% of monthly income` }, { label: 'Saved this month', value: income - expenses, note: `${((income - expenses) / income * 100).toFixed(1)}% savings rate` }]).map((item) => <article className={`min-w-0 rounded-2xl ${item.label === (isBusiness ? 'Net profit' : 'Saved this month') ? 'bg-[#d5f579]' : 'bg-white'} px-[23px] pt-5 pb-[23px] max-[1200px]:px-[15px] max-[1200px]:py-[18px] min-[1600px]:px-7 min-[1600px]:py-[25px]  [&_p]:text-sm [&_p]:text-[#7d877f] max-sm:[&_p]:text-xs [&_strong]:mt-3 [&_strong]:mb-[11px] [&_strong]:block [&_strong]:text-[clamp(24px,2.35vw,36px)] [&_strong]:leading-[1.3] [&_strong]:font-[650] [&_strong]:tracking-[-.035em] max-sm:[&_strong]:text-[25px] [&_span]:text-[11px] [&_span]:text-[#7d877f] max-sm:[&_span]:text-[10px] data-[highlight=true]:[&_p]:text-[#688044] data-[highlight=true]:[&_span]:text-[#688044]`} data-highlight={item.label === (isBusiness ? 'Net profit' : 'Saved this month')} key={item.label}><p>{item.label}</p><strong>{euro(item.value)}</strong><span>{item.note}</span></article>)}
      </section><div className="my-[25px] grid grid-cols-[minmax(0,1.92fr)_minmax(270px,1fr)] gap-6 max-[1200px]:grid-cols-[minmax(0,1.6fr)_minmax(235px,1fr)] max-[1200px]:gap-[18px] max-[900px]:grid-cols-1 min-[1600px]:my-[30px] min-[1600px]:gap-[30px]">{renderChart()}{renderBudgets()}</div></>}
      {view === 'Dashboard' && renderTransactions()}
      {view === 'Transactions' && <TransactionsView transactions={transactions} income={income} expenses={expenses} workspaceName={workspace.name} workspaceKind={workspace.kind} />}
      {view === 'Budgets' && renderBudgets()}
      {view === 'Categories' && <CategoryManager workspaceName={workspace.name} workspaceKind={workspace.kind} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} />}
      {!isBusiness && (view === 'Dashboard' || view === 'Revolut') && <section className="mt-[25px] flex items-center justify-between gap-5 rounded-[15px] bg-[#eaf0e5] px-[26px] py-[17px] max-sm:flex-col max-sm:items-start max-sm:gap-3 max-sm:p-[18px] [&_h2]:m-0 [&_h2]:text-base [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-[-.025em] [&_p]:mt-[5px] [&_p]:text-xs [&_p]:text-[#7d877f]"><div><h2>Revolut preview</h2><p>Sample imported transactions · connect your account when integration is available</p></div><span className="whitespace-nowrap rounded-full border border-[#cbd6c3] px-[10px] py-1 text-xs">Not connected</span></section>}
      {isBusiness && view === 'Dashboard' && <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#eaf0e5] p-5"><div><h2 className="text-base font-semibold!">Built for your team. Kept in your control.</h2><p className="mt-2 text-xs text-[#68796e]">Owners manage the workspace. Employees can view finances and add expenses.</p></div><button className="text-sm" onClick={() => navigate('Employees')}>Employees</button></section>}
      {isBusiness && view === 'Projects' && <ProjectManager key={backendWorkspaceId ?? 'unconnected'} catalog={projectCatalog} workspaceId={backendWorkspaceId} onConnect={connectBackendWorkspace} canManage={canManageProjects} />}
      {isBusiness && ['Departments', 'Employees'].includes(view) && <TeamManager key={view} section={view as TeamSection} data={team} onChange={setTeam} ownerName={displayName} />}
      {isBusiness && view === 'Settings' && <section className={cardClasses}><h2>{workspace.name}</h2><p className="mt-3 text-sm text-[#68796e]">Business workspace · You are the Owner · Currency: EUR</p></section>}
    </main>
    <dialog ref={dialog} className="m-auto max-h-[calc(100svh-40px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[18px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/35 backdrop:backdrop-blur-[3px] [&_h2]:m-0 [&_h2]:text-[23px] [&_h2]:font-semibold" aria-labelledby="dashboard-dialog-title">
      <div className="flex items-center justify-between gap-[15px]"><h2 id="dashboard-dialog-title">{dialogType === 'transaction' ? `Add ${entryType}` : dialogType === 'budget' ? 'Manage your budgets' : dialogType === 'profile' ? 'Your account' : 'Your account'}</h2><button className="rounded-full border-0 bg-[#eff2e9] p-[6px]" aria-label="Close dialog" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {dialogType === 'transaction' && <form key={entryType} onSubmit={saveTransaction} className={formClasses}><p className="text-xs text-[#7d877f]">Add a transaction to the September sample workspace.</p><label>Description<input name="name" placeholder={entryType === 'income' ? 'e.g. Freelance project' : 'e.g. Weekly groceries'} required maxLength={80} autoFocus /></label><label>Amount (€)<input name="amount" type="number" min="0.01" max="999999999" step="0.01" placeholder="0.00" required /></label><label>Category<select name="category">{(entryType === 'income' ? isBusiness ? ['Services', 'Other income'] : ['Salary', 'Other income'] : isBusiness ? ['Marketing', 'Software', 'Office', 'Travel', 'Equipment', 'Other'] : ['Groceries', 'Transport', 'Subscriptions', 'Shopping', 'Other']).map((category) => <option key={category}>{category}</option>)}</select></label>{isBusiness && <ProjectFields catalog={projectCatalog} departmentId={transactionDepartmentId} projectId={transactionProjectId} onDepartmentChange={setTransactionDepartmentId} onProjectChange={setTransactionProjectId} />}<label>Date<input name="date" type="date" min="2026-09-01" max="2026-09-30" defaultValue="2026-09-22" required /></label><button className={primaryButtonClasses} type="submit">Save {entryType}</button></form>}
      {dialogType === 'budget' && <form className={formClasses} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setBudgets(Object.fromEntries(Object.keys(budgets).map((name) => [name, Number(data.get(name))]))); setBudgetTargets(Object.fromEntries(Object.keys(budgets).map((name, index) => [name, { departmentId: String(data.get(`budget-${index}-department_id`) || ''), projectId: String(data.get(`budget-${index}-project_id`) || '') }]))); setNotice('Sample budgets updated.'); dialog.current?.close() }}><p className="text-xs text-[#7d877f]">Set your monthly spending limits.</p>{Object.keys(budgets).map((category, index) => <fieldset key={category} className="grid gap-4 rounded-xl border border-[#dce4d8] p-4"><legend className="px-1 text-sm font-medium">{category}</legend><label>{category} (€)<input name={category} type="number" min="1" max="999999999" step="0.01" defaultValue={budgets[category]} required /></label>{isBusiness && <ProjectFields catalog={projectCatalog} namePrefix={`budget-${index}-`} departmentId={budgetDraft[category]?.departmentId || ''} projectId={budgetDraft[category]?.projectId || ''} onDepartmentChange={departmentId => setBudgetDraft(previous => ({ ...previous, [category]: { ...previous[category], departmentId, projectId: previous[category]?.projectId || '' } }))} onProjectChange={projectId => setBudgetDraft(previous => ({ ...previous, [category]: { departmentId: previous[category]?.departmentId || '', projectId } }))} />}</fieldset>)}<button className={primaryButtonClasses}>Save budgets</button></form>}
      {dialogType === 'profile' && <div className={formClasses}><strong>{displayName}</strong><p>{user?.email}</p><p className="text-xs text-[#7d877f]">{workspace.name} workspace</p><button className={primaryButtonClasses} onClick={handleLogout}>Log out</button>{logoutError && <p role="alert">{logoutError}</p>}</div>}
    </dialog>
  </div>
}

function HomePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([{ id: 'personal', name: 'Personal', kind: 'personal' }])
  const [activeId, setActiveId] = useState('personal')
  const [creating, setCreating] = useState(false)
  function createWorkspace(name: string) {
    const workspace: Workspace = { id: crypto.randomUUID(), name, kind: 'business', role: 'OWNER' }
    setWorkspaces((current) => [...current, workspace])
    setActiveId(workspace.id)
  }
  return <>
    {workspaces.map((workspace) => <div key={workspace.id} hidden={workspace.id !== activeId}>
      <WorkspaceDashboard workspace={workspace} workspaces={workspaces} active={workspace.id === activeId} onSwitch={setActiveId} onCreate={() => setCreating(true)} />
    </div>)}
    {creating && <CreateBusinessDialog workspaces={workspaces} onCreate={createWorkspace} onClose={() => setCreating(false)} />}
  </>
}

export default HomePage
