import { useId, useRef, useState } from 'react'
import { MoreHorizontal, Search, X } from 'lucide-react'

export type WorkspaceTransaction = {
  id: number; name: string; category: string; source: string; date: string; amount: number
  department?: string; project?: string; createdBy?: string
}
const euro = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value)
const selectClass = 'min-w-0 rounded-[10px] border-0 bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33]'

export function TransactionsView({ transactions, income, expenses, workspaceName, workspaceKind = 'business' }: {
  transactions: WorkspaceTransaction[]; income: number; expenses: number; workspaceName: string; workspaceKind?: 'personal' | 'business'
}) {
  const isBusiness = workspaceKind === 'business'
  const detailId = useId()
  const [source, setSource] = useState('All sources')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('All')
  const [category, setCategory] = useState('All categories')
  const [department, setDepartment] = useState('All departments')
  const [project, setProject] = useState('All projects')
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<WorkspaceTransaction | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const filtered = transactions.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()) &&
    (kind === 'All' || (kind === 'Income' ? item.amount > 0 : item.amount < 0)) &&
    (category === 'All categories' || item.category === category) &&
    (department === 'All departments' || item.department === department) &&
    (project === 'All projects' || item.project === project) &&
    (source === 'All sources' || item.source === source),
  )
  const rows = filtered.slice(page * 8, page * 8 + 8)
  function options(field: 'category' | 'department' | 'project' | 'source', label: string) {
    return [label, ...new Set(transactions.map((item) => item[field]).filter((value): value is string => Boolean(value)))]
  }
  return <>
    <section className="grid grid-cols-3 gap-5 rounded-2xl bg-white p-6 max-sm:grid-cols-1" aria-label={`${isBusiness ? 'Business' : 'Personal'} transaction summary`}>
      {[['September income', income], ['September expenses', expenses], ['Net change', income - expenses]].map(([label, value]) => <div key={label}><p className="text-[11px] text-[#68796e] uppercase">{label}</p><strong className="mt-3 block text-[28px] tracking-tight">{euro(Number(value))}</strong></div>)}
    </section>
    <section className="mt-6 rounded-2xl bg-white p-6 max-sm:p-4">
      <h2 className="sr-only">Your transactions</h2>
      <div className={`grid gap-3 max-[1100px]:grid-cols-2 max-sm:grid-cols-1 ${isBusiness ? 'grid-cols-[2fr_1fr_1fr_1fr_1fr]' : 'grid-cols-[2fr_1fr_1fr_1fr]'}`}>
        <label className="flex items-center gap-2 rounded-[10px] bg-[#f7f8f2] px-4 py-3"><Search size={16} className="shrink-0 text-[#68796e]" /><input aria-label={`Search ${workspaceKind} transactions`} placeholder="Search name or description" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} className="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
        <div className={selectClass}>September 2026</div>
        {[{ label: 'Category', value: category, set: setCategory, options: options('category', 'All categories') }, ...(isBusiness ? [{ label: 'Department', value: department, set: setDepartment, options: options('department', 'All departments') }, { label: 'Project', value: project, set: setProject, options: options('project', 'All projects') }] : [{ label: 'Source', value: source, set: setSource, options: options('source', 'All sources') }])].map((filter) => <select key={filter.label} aria-label={`Filter by ${filter.label.toLowerCase()}`} value={filter.value} onChange={(event) => { filter.set(event.target.value); setPage(0) }} className={selectClass}>{filter.options.map((option) => <option key={option}>{option}</option>)}</select>)}
      </div>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label="Transaction type" className="flex gap-2">{['All', 'Income', 'Expenses'].map((type) => <button key={type} aria-pressed={kind === type} onClick={() => { setKind(type); setPage(0) }} className={`rounded-full px-5 py-2 text-xs ${kind === type ? 'bg-[#193f33] text-white' : 'text-[#68796e] hover:bg-[#eaf0e6]'}`}>{type}</button>)}</div><span className="text-xs text-[#68796e]">{filtered.length} transactions</span></div>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-left whitespace-nowrap text-xs [&_th]:border-y [&_th]:border-[#dce4d8] [&_th]:py-3 [&_th]:pr-5 [&_th]:text-[10px] [&_th]:font-normal [&_th]:text-[#68796e] [&_th]:uppercase [&_td]:border-b [&_td]:border-[#dce4d8] [&_td]:py-4 [&_td]:pr-5 [&_td]:text-[#68796e]">
        <thead><tr>{['Transaction', 'Category', ...(isBusiness ? ['Department', 'Project', 'Created by'] : ['Source']), 'Date', 'Amount', ''].map((heading) => <th key={heading} scope="col">{heading || <span className="sr-only">Details</span>}</th>)}</tr></thead>
        <tbody>{rows.map((item) => <tr key={item.id} className="even:bg-[#f7f8f2]"><td><strong className="text-[#193f33]">{item.name}</strong></td><td>{item.category}</td>{isBusiness ? <><td>{item.department || '—'}</td><td>{item.project || '—'}</td><td>{item.createdBy || '—'}</td></> : <td>{item.source}</td>}<td>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${item.date}T12:00:00`))}</td><td className="!text-[#193f33] tabular-nums">{item.amount > 0 ? '+' : '−'} {euro(Math.abs(item.amount))}</td><td><button aria-label={`View ${item.name} details`} onClick={() => { setDetail(item); dialog.current?.showModal() }} className="rounded-lg p-2 hover:bg-[#eaf0e6]"><MoreHorizontal size={18} /></button></td></tr>)}</tbody>
      </table></div>
      {rows.length === 0 && <p className="py-10 text-center text-sm text-[#68796e]">{transactions.length ? 'No transactions match these filters.' : 'No transactions yet. Add income or an expense to get started.'}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#68796e]"><span>{filtered.length ? `Showing ${page * 8 + 1}–${Math.min(page * 8 + 8, filtered.length)} of ${filtered.length} transactions` : '0 transactions'}</span><div className="flex gap-3"><button disabled={page === 0} onClick={() => setPage(page - 1)} className={`${selectClass} disabled:opacity-40`}>← Previous</button><button disabled={(page + 1) * 8 >= filtered.length} onClick={() => setPage(page + 1)} className={`${selectClass} disabled:opacity-40`}>Next →</button></div></div>
    </section>
    <p className="mt-5 text-xs text-[#68796e]">Workspace: {workspaceName} · All amounts in EUR</p>
    <dialog ref={dialog} aria-labelledby={detailId} className="m-auto w-[min(440px,calc(100%_-_32px))] rounded-2xl border-0 bg-white p-6 text-[#193f33] backdrop:bg-[#102c23]/40"><div className="flex items-center justify-between"><h2 id={detailId} className="text-xl font-semibold!">Transaction details</h2><button aria-label="Close transaction details" onClick={() => dialog.current?.close()}><X size={20} /></button></div>{detail && <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">{Object.entries({ Transaction: detail.name, Category: detail.category, ...(isBusiness ? { Department: detail.department || '—', Project: detail.project || '—', 'Created by': detail.createdBy || '—' } : { Source: detail.source }), Date: detail.date, Amount: euro(detail.amount) }).map(([label, value]) => <div key={label}><dt className="text-xs text-[#68796e]">{label}</dt><dd>{value}</dd></div>)}</dl>}</dialog>
  </>
}
