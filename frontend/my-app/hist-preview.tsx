import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './src/index.css'
import { TransactionsView, type WorkspaceTransaction } from './src/features/workspaces/TransactionsView'

const samples: WorkspaceTransaction[] = [
  { id: 1, name: 'Website launch', type: 'income', category: 'Services', source: 'Manual', amount: 4000, currency: 'EUR', date: '2026-10-19', department: 'Design', project: 'Website' },
  { id: 2, name: 'Conference travel and accommodation', type: 'expense', category: 'Travel', source: 'Expense', amount: -320, currency: 'EUR', date: '2026-10-18', department: 'Design', project: 'Website', canModify: false },
  { id: 3, name: 'Design software subscription', type: 'expense', category: 'Software', source: 'Manual', amount: -49, currency: 'EUR', date: '2026-10-17', department: 'Design', project: 'Website' },
  { id: 4, name: 'Brand identity deposit', type: 'income', category: 'Services', source: 'Manual', amount: 1250, currency: 'EUR', date: '2026-10-16', department: 'Design', project: 'Brand refresh' },
]
export function Preview() {
  const [kind, setKind] = useState<'business' | 'personal'>('business')
  return <main className="min-h-screen bg-[#f7f8f2] px-5 py-8 font-sans text-[#193f33] sm:px-10 sm:py-10 [&_button]:cursor-pointer">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-3 text-xs text-[#68796e]">FOTOSINTEZE · LOCAL PREVIEW · SAMPLE DATA</p><h1 className="text-3xl font-semibold">Every transaction, in its place.</h1><p className="mt-3 text-sm text-[#68796e]">Explore the history, search and filters. Open the ••• buttons for transaction details.</p></div><div className="flex gap-2">{(['business', 'personal'] as const).map(value => <button key={value} onClick={() => setKind(value)} className={`rounded-xl px-4 py-3 text-sm capitalize ${kind === value ? 'bg-[#193f33] text-white' : 'bg-[#eaf0e6]'}`}>{value}</button>)}</div></div>
    <TransactionsView key={kind} workspaceName={kind === 'business' ? 'Studio' : 'Personal'} workspaceKind={kind} transactions={samples} income={5250} expenses={369} onEdit={() => alert('Preview: in the app this opens the prefilled transaction edit form.')} onDelete={() => alert('Preview: in the app this opens a deletion confirmation and refreshes the account balance after deletion.')} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
