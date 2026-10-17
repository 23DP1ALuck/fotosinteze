import { useEffect, useState, type FormEvent } from 'react'
import { listAccessibleWorkspaces, type AccessibleWorkspace } from '@/features/workspaces/api'
import { deleteBusinessBudget, loadBusinessBudgets, saveBusinessBudget, targetTypes, type BudgetCatalog, type BudgetInput, type BusinessBudget, type TargetType } from './api'

const button = 'rounded-xl bg-[#193f33] px-4 py-2 text-sm text-white disabled:opacity-50'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-2 text-sm text-[#193f33] disabled:opacity-50'
const field = 'mt-1 w-full rounded-lg border border-[#d8d8d0] bg-white p-3 text-sm'
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount)
const labels = { CATEGORY: 'Category', DEPARTMENT: 'Department', PROJECT: 'Project' }
function blank(): BudgetInput {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return { name: '', target_type: 'CATEGORY', target_id: 0, limit_amount: '', currency: 'EUR', period_start: today, period_length: 'MONTHLY', duration_days: null }
}

export function BusinessBudgets({ workspaceId, onConnect }: { workspaceId?: number; onConnect: (id: number) => void }) {
  const [data, setData] = useState<BudgetCatalog | null>(null)
  const [workspaces, setWorkspaces] = useState<AccessibleWorkspace[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<BudgetInput | null>(null)
  const [editing, setEditing] = useState<number>()
  const [deleting, setDeleting] = useState<BusinessBudget | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (workspaceId === undefined) {
          const rows = await listAccessibleWorkspaces(controller.signal)
          if (!controller.signal.aborted) setWorkspaces(rows.filter(row => row.type === 'BUSINESS'))
        } else {
          const result = await loadBusinessBudgets(workspaceId, controller.signal)
          if (!controller.signal.aborted) setData(result)
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load budgets.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [workspaceId, revision])
  const current = data?.workspace_id === workspaceId ? data : null
  const canManage = current?.can_manage && !loading && !error
  function refresh() { setLoading(true); setError(''); setDraft(null); setDeleting(null); setRevision(value => value + 1) }
  function edit(row?: BusinessBudget) {
    setError(''); setNotice(''); setEditing(row?.id)
    setDraft(row ? { name: row.name, target_type: row.target_type, target_id: row.target_id, limit_amount: String(row.limit_amount), currency: row.currency, period_start: row.period_start, period_length: row.period_length, duration_days: row.duration_days } : blank())
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || workspaceId === undefined || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const row = await saveBusinessBudget(workspaceId, draft, editing)
      setData(previous => previous && ({ ...previous, budgets: editing === undefined ? [...previous.budgets, row] : previous.budgets.map(item => item.id === row.id ? row : item) }))
      setDraft(null); setNotice(editing === undefined ? 'Budget created.' : 'Budget updated.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save budget.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!deleting || workspaceId === undefined || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await deleteBusinessBudget(workspaceId, deleting.id)
      setData(previous => previous && ({ ...previous, budgets: previous.budgets.filter(row => row.id !== deleting.id) }))
      setDeleting(null); setNotice('Budget deleted.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete budget.') }
    finally { setBusy(false) }
  }

  return <section aria-label="Business budgets" className="rounded-2xl bg-white p-6 text-[#193f33]">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold!">Business budgets</h2><p className="mt-2 text-sm text-[#68796e]">Plan spending by category, department or project.</p></div><div className="flex gap-2"><button className={secondary} onClick={refresh} disabled={loading || busy}>Refresh budgets</button>{canManage && <button className={button} disabled={busy} onClick={() => edit()}>Create budget</button>}</div></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#fae8e5] p-3 text-sm text-[#a43b32]">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    {loading && <p role="status" className="mt-6">Loading budgets…</p>}
    {workspaceId === undefined && !loading && <label className="mt-6 block max-w-md text-sm">Business workspace<select className={field} value="" onChange={event => onConnect(Number(event.target.value))}><option value="" disabled>Select a workspace</option>{workspaces.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{!workspaces.length && <span className="mt-2 block">No accessible Business workspaces. Ask an owner to add you or create a Business workspace first.</span>}</label>}
    {current?.progress_scope === 'ASSIGNED_DEPARTMENT' && <p className="mt-5 text-sm text-[#68796e]">Read-only progress for your assigned department and its projects. Spending includes only your department; category budgets are visible to owners.</p>}
    {draft && current?.can_manage && <form aria-label={editing === undefined ? 'Create business budget' : 'Edit business budget'} onSubmit={save} className="mt-6 grid gap-4 rounded-xl bg-[#f7f8f2] p-5 sm:grid-cols-2">
      <label className="text-sm">Budget name<input className={field} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required maxLength={100} /></label>
      <label className="text-sm">Limit<input className={field} type="number" min="0.01" max="99999999.99" step="0.01" value={draft.limit_amount} onChange={e => setDraft({ ...draft, limit_amount: e.target.value })} required /></label>
      <label className="text-sm">Target type<select className={field} value={draft.target_type} onChange={e => setDraft({ ...draft, target_type: e.target.value as TargetType, target_id: 0 })}>{targetTypes.map(kind => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
      <label className="text-sm">Target entity<select className={field} value={draft.target_id || ''} onChange={e => setDraft({ ...draft, target_id: Number(e.target.value) })} required><option value="" disabled>Select {labels[draft.target_type].toLowerCase()}</option>{(current.targets[draft.target_type] || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{!current.targets[draft.target_type]?.length && <span className="mt-1 block text-xs">Create a {labels[draft.target_type].toLowerCase()} before choosing this target.</span>}</label>
      <label className="text-sm">Currency<input className={field} value={draft.currency} pattern="[A-Z]{3}" minLength={3} maxLength={3} onChange={e => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} required /></label>
      <label className="text-sm">Period start<input className={field} type="date" value={draft.period_start} onInput={e => setDraft({ ...draft, period_start: e.currentTarget.value })} required /></label>
      <label className="text-sm">Period<select className={field} value={draft.period_length} onChange={e => setDraft({ ...draft, period_length: e.target.value as BudgetInput['period_length'], duration_days: e.target.value === 'CUSTOM' ? 30 : null })}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="CUSTOM">Custom</option></select></label>
      {draft.period_length === 'CUSTOM' && <label className="text-sm">Duration (days)<input className={field} type="number" min="1" max="3660" step="1" value={draft.duration_days ?? ''} onChange={e => setDraft({ ...draft, duration_days: Number(e.target.value) })} required /></label>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={secondary} onClick={() => setDraft(null)} disabled={busy}>Cancel</button><button className={button} disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</button></div>
    </form>}
    {deleting && current?.can_manage && <div role="group" aria-label="Confirm budget deletion" className="mt-5 rounded-xl bg-[#fae8e5] p-4"><p>Delete “{deleting.name}”?</p><div className="mt-3 flex gap-2"><button className={button} disabled={busy} onClick={() => void remove()}>Confirm delete</button><button className={secondary} disabled={busy} onClick={() => setDeleting(null)}>Cancel deletion</button></div></div>}
    {!loading && current && !current.budgets.length && !error && <p className="mt-6 rounded-xl border border-dashed p-8 text-center">No budgets available for this workspace.</p>}
    <div className="mt-6 grid gap-4 lg:grid-cols-2">{current?.budgets.map(row => <article key={row.id} aria-label={`Budget ${row.name}`} className="rounded-xl border border-[#dce4d8] p-5">
      <div className="flex items-start justify-between gap-3"><h3 className="font-semibold!">{row.name}</h3><span className={`rounded-full px-2 py-1 text-xs ${row.status === 'EXCEEDED' ? 'bg-[#fae8e5] text-[#a43b32]' : row.status === 'WARNING' ? 'bg-[#fff3d6] text-[#8a6200]' : 'bg-[#eaf0e6]'}`}>{row.status === 'EXCEEDED' ? 'Exceeded' : row.status === 'WARNING' ? 'Almost there' : 'On track'}</span></div>
      <p className="mt-2 text-sm">{labels[row.target_type]}: {row.target_name}</p><p className="mt-2 text-xs text-[#68796e]">{row.period_length.toLowerCase()} · {row.period_start} to {row.period_end} (end excluded)</p>
      <p className="mt-4 text-sm">{money(row.spent, row.currency)} spent of {money(row.limit_amount, row.currency)}</p><p className="mt-1 text-sm">{row.remaining < 0 ? `${money(-row.remaining, row.currency)} over budget` : `${money(row.remaining, row.currency)} remaining`}</p>
      <progress className="mt-3 h-2 w-full accent-[#193f33]" aria-label={`${row.name} budget used`} value={Math.min(row.spent, row.limit_amount)} max={row.limit_amount} />
      {canManage && <div className="mt-4 flex gap-2"><button className={secondary} disabled={busy} onClick={() => edit(row)} aria-label={`Edit ${row.name}`}>Edit</button><button className={secondary} disabled={busy} onClick={() => { setDraft(null); setDeleting(row) }} aria-label={`Delete ${row.name}`}>Delete</button></div>}
    </article>)}</div>
  </section>
}
