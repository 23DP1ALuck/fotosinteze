import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { DateInput } from '@/components/calendar/DateInput'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal, Search, X } from 'lucide-react'
import type { TransactionFilters } from '@/features/transactions/api'

export type WorkspaceTransaction = {
  id: number; name: string; category: string; source: string; date: string; amount: number
  department?: string; project?: string; createdBy?: string; departmentId?: number; projectId?: number
  canModify?: boolean; currency?: string; type?: 'income' | 'expense' | 'unknown'
}
const selectClass = 'min-w-0 rounded-[10px] border-0 bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33]'

export function TransactionsView({ transactions, income, expenses, workspaceName, workspaceKind = 'business', currency = 'EUR', onEdit, onDelete, onFilterChange, filterOptions, loading = false, error = '', hasMore = false }: {
  transactions: WorkspaceTransaction[]; income: number; expenses: number; workspaceName: string; workspaceKind?: 'personal' | 'business'; currency?: string; onEdit?: (id: number) => void; onDelete?: (id: number) => void
  onFilterChange?: (filters: TransactionFilters) => void; filterOptions?: { categories: { id: number; name: string }[]; departments: { id: number; name: string }[]; projects: { id: number; name: string }[] }; loading?: boolean; error?: string; hasMore?: boolean
}) {
  const euro = (value: number, code = currency) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: code }).format(value)
  const isBusiness = workspaceKind === 'business'
  const detailId = useId()
  const [source, setSource] = useState('All sources')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('All')
  const [category, setCategory] = useState('All categories')
  const [department, setDepartment] = useState('All departments')
  const [project, setProject] = useState('All projects')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dates, setDates] = useState({ from: '', to: '' })
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(searchTimer.current), [])
  const invalidDates = Boolean(dateFrom && dateTo && dateFrom > dateTo)
  const hasFilters = Boolean(query || kind !== 'All' || category !== 'All categories' || department !== 'All departments' || project !== 'All projects' || source !== 'All sources' || dates.from || dates.to)
  function resetFilters() {
    clearTimeout(searchTimer.current)
    setQuery(''); setKind('All'); setCategory('All categories'); setDepartment('All departments'); setProject('All projects'); setSource('All sources')
    setDateFrom(''); setDateTo(''); setDates({ from: '', to: '' }); setPage(0)
    onFilterChange?.({ search: undefined, type: undefined, category_id: undefined, department_id: undefined, project_id: undefined, source: undefined, date_from: undefined, date_to: undefined })
  }
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<WorkspaceTransaction | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const filtered = onFilterChange ? transactions : transactions.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()) &&
    (kind === 'All' || (item.type !== 'unknown' && (kind === 'Income' ? item.amount > 0 : item.amount < 0))) &&
    (category === 'All categories' || item.category === category) &&
    (department === 'All departments' || item.department === department) &&
    (project === 'All projects' || item.project === project) &&
    (source === 'All sources' || item.source === source) &&
    (!dates.from || item.date >= dates.from) && (!dates.to || item.date <= dates.to),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 8) - 1))
  const rows = filtered.slice(currentPage * 8, currentPage * 8 + 8)
  const typeLabel = (item: WorkspaceTransaction) => item.type === 'income' ? 'Income' : item.type === 'expense' ? 'Expense' : 'Unknown type'
  const amountClass = (item: WorkspaceTransaction) => item.type === 'income' ? '!text-[#286644]' : item.type === 'expense' ? '!text-[#a43b32]' : '!text-[#526259]'
  const amountLabel = (item: WorkspaceTransaction) => `${item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''} ${euro(Math.abs(item.amount), item.currency)}`
  const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  function actions(item: WorkspaceTransaction) {
    return <div className="flex flex-wrap items-center gap-1"><button aria-label={`View ${item.name} details`} onClick={() => { setDetail(item); dialog.current?.showModal() }} className="rounded-lg p-2 hover:bg-[#eaf0e6]"><MoreHorizontal size={18} /></button>{item.canModify !== false ? <>{onEdit && <button type="button" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item.id)} className="rounded-lg px-3 py-2 hover:bg-[#eaf0e6]">Edit</button>}{onDelete && <button type="button" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item.id)} className="rounded-lg px-3 py-2 text-[#a43b32] hover:bg-[#fcf0ed]">Delete</button>}</> : <span className="text-xs">Approved expense · read only</span>}</div>
  }
  function options(field: 'category' | 'department' | 'project' | 'source', label: string) {
    const catalog = field === 'category' ? filterOptions?.categories : field === 'department' ? filterOptions?.departments : field === 'project' ? filterOptions?.projects : undefined
    const sources = isBusiness ? ['Manual', 'Revolut', 'Expense'] : ['Manual', 'Revolut']
    const choices = catalog ? catalog.map(item => ({ value: String(item.id), label: item.name })) : (field === 'source' ? sources : [...new Set(transactions.map(item => item[field]).filter((value): value is string => Boolean(value)))]).map(value => ({ value, label: value }))
    return [{ value: label, label }, ...choices]
  }
  return <>
    <section className="grid grid-cols-3 gap-5 rounded-2xl bg-white p-6 max-sm:grid-cols-1" aria-label={`${isBusiness ? 'Business' : 'Personal'} transaction summary`}>
      {[['Income this month', income], ['Expenses this month', expenses], ['Net change', income - expenses]].map(([label, value]) => <div key={label}><p className="text-[11px] text-[#526259] uppercase">{label}</p><strong className="mt-3 block text-[28px] tracking-tight">{euro(Number(value))}</strong></div>)}
    </section>
    <section className="mt-6 rounded-2xl bg-white p-6 max-sm:p-4">
      <h2 className="sr-only">Your transactions</h2>
      <div className={`grid gap-3 max-[1100px]:grid-cols-2 max-sm:grid-cols-1 ${isBusiness ? 'grid-cols-[2fr_1fr_1fr_1fr_1fr]' : 'grid-cols-[2fr_1fr_1fr]'}`}>
        <label className="flex items-center gap-2 rounded-[10px] bg-[#f7f8f2] px-4 py-3 focus-within:ring-2 focus-within:ring-[#82965b]"><Search size={16} className="shrink-0 text-[#526259]" /><input type="search" aria-label={`Search ${workspaceKind} transactions`} placeholder="Search name or description" value={query} maxLength={255} onChange={(event) => { setQuery(event.target.value); setPage(0); clearTimeout(searchTimer.current); const search = event.target.value.trim() || undefined; searchTimer.current = setTimeout(() => { setPage(0); onFilterChange?.({ search }) }, 300) }} className="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
        {[{ label: 'Category', value: category, set: setCategory, options: options('category', 'All categories') }, ...(isBusiness ? [{ label: 'Department', value: department, set: setDepartment, options: options('department', 'All departments') }, { label: 'Project', value: project, set: setProject, options: options('project', 'All projects') }] : []), { label: 'Source', value: source, set: setSource, options: options('source', 'All sources') }].map((filter) => <select key={filter.label} aria-label={`Filter by ${filter.label.toLowerCase()}`} value={filter.value} onChange={(event) => { filter.set(event.target.value); setPage(0)
          const value = event.target.value
          if (filter.label === 'Source') onFilterChange?.({ source: value === 'Manual' ? 'MANUAL' : value === 'Revolut' ? 'BANK' : value === 'Expense' ? 'EXPENSE' : undefined })
          else onFilterChange?.({ [`${filter.label.toLowerCase()}_id`]: value.startsWith('All ') ? undefined : Number(value) }) }} className={selectClass}>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>)}
      </div>
      <KeyboardForm aria-label="Filter by date range" className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault()
        if (invalidDates) return
        setDates({ from: dateFrom, to: dateTo }); setPage(0)
        onFilterChange?.({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      }}>
        <label className="grid min-w-0 gap-1 text-xs text-[#526259]">From date<DateInput calendarLabel="From date" nextCalendarId={`${detailId}-to`} value={dateFrom} onChange={event => setDateFrom(event.target.value)} className={selectClass} /></label>
        <label className="grid min-w-0 gap-1 text-xs text-[#526259]">To date<DateInput calendarLabel="To date" id={`${detailId}-to`} value={dateTo} onChange={event => setDateTo(event.target.value)} aria-invalid={invalidDates} aria-describedby={invalidDates ? `${detailId}-date-error` : undefined} className={selectClass} /></label>
        <button type="submit" disabled={invalidDates} className={`${selectClass} disabled:opacity-40`}>Apply dates</button>
        {(hasFilters || dateFrom || dateTo) && <button type="button" onClick={resetFilters} className="rounded-lg px-4 py-3 text-sm underline">Clear filters</button>}
      </KeyboardForm>
      {invalidDates && <p role="alert" id={`${detailId}-date-error`} className="mt-2 text-sm text-[#a43b32]">From date must be on or before to date.</p>}
      {(dates.from || dates.to) && <p className="mt-2 text-xs text-[#526259]">Dates: {dates.from ? dateLabel(dates.from) : 'Any time'} – {dates.to ? dateLabel(dates.to) : 'Any time'} (inclusive)</p>}
      <div className="my-5 flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label="Transaction type" className="flex gap-2">{['All', 'Income', 'Expenses'].map((type) => <button key={type} aria-pressed={kind === type} onClick={() => { setKind(type); setPage(0); onFilterChange?.({ type: type === 'Income' ? 'INCOME' : type === 'Expenses' ? 'EXPENSE' : undefined }) }} className={`rounded-full px-5 py-2 text-xs ${kind === type ? 'bg-[#193f33] text-white' : 'text-[#526259] hover:bg-[#eaf0e6]'}`}>{type}</button>)}</div><span className="text-xs text-[#526259]">{filtered.length}{hasMore ? ' loaded' : ''} transactions</span></div>
      {loading && <p role="status" className="py-8 text-sm text-[#526259]">Loading transactions…</p>}
      <div className="overflow-x-auto"><table aria-label="Transaction history" aria-busy={loading} className="w-full border-collapse text-left text-xs max-sm:[&_thead]:sr-only max-sm:[&_tbody]:grid max-sm:[&_tbody]:gap-4 max-sm:[&_tbody_tr]:grid max-sm:[&_tbody_tr]:grid-cols-2 max-sm:[&_tbody_tr]:rounded-xl max-sm:[&_tbody_tr]:border max-sm:[&_tbody_tr]:border-[#dce4d8] max-sm:[&_tbody_tr]:p-4 [&_th]:border-y [&_th]:border-[#dce4d8] [&_th]:py-3 [&_th]:pr-5 [&_th]:text-[10px] [&_th]:font-normal [&_th]:text-[#526259] [&_th]:uppercase [&_td]:border-b [&_td]:border-[#dce4d8] [&_td]:py-4 [&_td]:pr-5 [&_td]:text-[#526259] max-sm:[&_td]:border-0 max-sm:[&_td]:py-2 max-sm:[&_td]:pr-2 max-sm:[&_td]:wrap-anywhere">
        <thead><tr>{['Transaction', 'Type', 'Category', ...(isBusiness ? ['Department', 'Project'] : ['Source']), 'Date', 'Amount', ''].map((heading) => <th key={heading} scope="col">{heading || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
        <tbody>{!loading && rows.map(item => <tr key={item.id} className="even:bg-[#f7f8f2]">
          <td className="max-sm:col-span-2"><strong className="text-sm text-[#193f33]">{item.name}</strong></td>
          <td><span className={`inline-block rounded-full px-2 py-1 ${item.type === 'income' ? 'bg-[#eaf0e6] text-[#286644]' : item.type === 'expense' ? 'bg-[#fcf0ed] text-[#a43b32]' : 'bg-[#f7f8f2]'}`}>{typeLabel(item)}</span></td>
          <td><span aria-hidden="true" className="block text-[10px] uppercase sm:hidden">Category</span>{item.category}</td>
          {isBusiness ? <><td><span aria-hidden="true" className="block text-[10px] uppercase sm:hidden">Department</span>{item.department || '—'}</td><td><span aria-hidden="true" className="block text-[10px] uppercase sm:hidden">Project</span>{item.project || '—'}</td></> : <td><span aria-hidden="true" className="block text-[10px] uppercase sm:hidden">Source</span>{item.source}</td>}
          <td className="whitespace-nowrap"><span aria-hidden="true" className="block text-[10px] uppercase sm:hidden">Date</span>{dateLabel(item.date)}</td>
          <td className={`${amountClass(item)} whitespace-nowrap font-medium tabular-nums`}><span aria-hidden="true" className="block text-[10px] font-normal uppercase sm:hidden">Amount</span>{amountLabel(item)}</td>
          <td className="max-sm:col-span-2">{actions(item)}</td>
        </tr>)}</tbody>
      </table></div>
      {!loading && !error && rows.length === 0 && <p className="py-10 text-center text-sm text-[#526259]">{transactions.length || hasFilters ? 'No transactions match these filters.' : 'No transactions yet. Add income or an expense to get started.'}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#526259]"><span>{filtered.length ? `Showing ${currentPage * 8 + 1}–${Math.min(currentPage * 8 + 8, filtered.length)} of ${filtered.length}${hasMore ? ' loaded' : ''} transactions` : '0 transactions'}</span><div className="flex gap-3"><button disabled={loading || currentPage === 0} onClick={() => setPage(currentPage - 1)} className={`${selectClass} disabled:opacity-40`}>← Previous</button><button disabled={loading || (currentPage + 1) * 8 >= filtered.length} onClick={() => setPage(currentPage + 1)} className={`${selectClass} disabled:opacity-40`}>Next →</button></div></div>
    </section>
    <p className="mt-5 text-xs text-[#526259]">Workspace: {workspaceName} · Amounts shown in each account’s currency</p>
    <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={detailId} className="m-auto max-h-[calc(100svh-32px)] overflow-y-auto w-[min(440px,calc(100%_-_32px))] rounded-2xl border-0 bg-white p-6 text-[#193f33] backdrop:bg-[#102c23]/40"><div className="flex items-center justify-between"><h2 id={detailId} className="text-xl font-semibold!">Transaction details</h2><button aria-label="Close transaction details" onClick={() => dialog.current?.close()}><X size={20} /></button></div>{detail && <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">{Object.entries({ Transaction: detail.name, Type: typeLabel(detail), Category: detail.category, ...(isBusiness ? { Department: detail.department || '—', Project: detail.project || '—' } : { Source: detail.source }), Date: dateLabel(detail.date), Amount: amountLabel(detail) }).map(([label, value]) => <div key={label}><dt className="text-xs text-[#526259]">{label}</dt><dd className="wrap-anywhere">{value}</dd></div>)}</dl>}</dialog>
  </>
}
