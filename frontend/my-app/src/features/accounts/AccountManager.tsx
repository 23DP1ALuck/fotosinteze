import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, Landmark, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { authAccountId, workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { CreateAccountDialog } from './CreateAccountDialog'
import { AccountDetails } from './AccountDetails'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { formatAccountBalance, listAccounts, updateAccount, type ApiAccount } from './api'

export function AccountManager({ workspaceId, workspaceName, canCreate = true }: { workspaceId: number; workspaceName?: string; canCreate?: boolean }) {
  return <Accounts key={`${authAccountId()}-${workspaceId}-${canCreate}`} workspaceId={workspaceId} workspaceName={workspaceName} canCreate={canCreate} />
}
function Accounts({ workspaceId, workspaceName, canCreate }: { workspaceId: number; workspaceName?: string; canCreate: boolean }) {
  const client = useQueryClient()
  const ownerId = authAccountId()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deletingAccount, setDeletingAccount] = useState<ApiAccount | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const query = useQuery({ queryKey: workspaceQueryKey('accounts', workspaceId), queryFn: ({ signal }) => listAccounts(workspaceId, signal), staleTime: 0, refetchOnMount: 'always' })
  const accounts = query.data ?? []
  const mainMutation = useMutation({ mutationFn: (accountId: number) => updateAccount(workspaceId, accountId, { is_main: true }),
    onSuccess: async () => {
      if (authAccountId() !== ownerId) return
      await client.invalidateQueries({ queryKey: workspaceQueryKey('accounts', workspaceId) })
      setNotice('Main account updated. New transactions will use it by default.')
    },
  })
  return <section aria-label="Account management" className="rounded-[20px] bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#d5f579]"><Wallet size={22} /></span><div><h2 className="text-[22px] font-semibold!">Your accounts</h2><p className="mt-1 text-xs text-[#526259]">{workspaceName ? `${workspaceName} · ` : ''}Current balances, all in one place.</p></div></div><div className="flex items-center gap-3">{canCreate && <button ref={addButton} type="button" disabled={query.isPending || query.isError} onClick={() => { setCreating(true); setNotice('') }} className="inline-flex items-center gap-2 rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-40"><Plus size={17} />Add account</button>}<button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Refresh accounts" className="rounded-xl bg-[#eaf0e6] p-3 hover:bg-[#dce6d4] disabled:opacity-40"><RefreshCw size={18} className={query.isFetching ? 'animate-spin' : ''} /></button></div></div>
    {notice && <p role="status" className="mt-5 flex items-center gap-2 rounded-xl bg-[#eaf0e6] p-4 text-sm"><Check size={17} className="shrink-0" aria-hidden="true" />{notice}</p>}
    {query.isFetching && <p role="status" className="mt-5 text-sm text-[#526259]">{query.isPending ? 'Loading accounts…' : 'Refreshing accounts…'}</p>}
    {query.isError && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm">Retry</button></div>}
    {!query.isPending && !query.isError && !accounts.length && <div className="mt-6 rounded-2xl border border-dashed border-[#dce4d8] px-5 py-10 text-center"><p className="font-medium">No accounts yet.</p><p className="mt-2 text-sm text-[#526259]">{canCreate ? 'Create your first account to start tracking its balance.' : 'Ask a workspace owner to add an account.'}</p>{canCreate && <button type="button" onClick={() => setCreating(true)} className="mt-5 rounded-xl bg-[#193f33] px-4 py-3 text-sm text-white">Create your first account</button>}</div>}
    {mainMutation.isError && <p role="alert" className="mt-4 text-sm text-[#a43b32]">{mainMutation.error.message}</p>}
    <p className="mt-4 text-xs text-[#526259]">Choose a main account to prefill new transactions. You can still choose another account each time.</p>
    {!query.isPending && !query.isError && accounts.length > 0 && <ul aria-label="Accounts" className="mt-6 grid gap-4 md:grid-cols-2">{accounts.map(account => <li key={account.account_id} className="flex min-w-0 flex-col rounded-2xl border border-[#e1e5df] p-5">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-[#f3f6ed] p-3">{(account.connection_id !== null || account.banking_connection_id !== null) ? <Landmark size={20} /> : <Wallet size={20} />}</span><div className="min-w-0"><h3 className="wrap-anywhere font-semibold">{account.name}</h3><p className="mt-1 text-xs text-[#526259]">{account.banking_connection_id !== null ? 'Revolut · Enable Banking' : account.connection_id !== null ? 'Revolut-linked' : 'Manual / internal'}</p></div></div>
      {account.is_main ? <span className="mt-4 self-start rounded-full bg-[#d5f579] px-3 py-1 text-xs font-medium">Main account</span> : canCreate && <button type="button" disabled={mainMutation.isPending || query.isFetching} aria-label={`Make ${account.name} main account`} onClick={() => { setNotice(''); mainMutation.mutate(account.account_id) }} className="mt-4 self-start rounded-lg bg-[#eaf0e6] px-3 py-2 text-xs hover:bg-[#dce6d4] disabled:opacity-50">Make main account</button>}
      <p className="mt-5 text-xs text-[#526259]">Current balance · {account.currency}</p><strong className="mt-1 wrap-anywhere text-2xl font-semibold tabular-nums">{formatAccountBalance(account)}</strong>
      <div className="mt-auto flex items-center gap-2 pt-5"><button type="button" onClick={() => { setSelectedId(account.account_id); setNotice('') }} aria-label={`View ${account.name} details`} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-[#f3f6ed] px-4 py-3 text-sm hover:bg-[#eaf0e6]">View details<ArrowUpRight size={17} className="shrink-0" /></button>{canCreate && <button type="button" onClick={() => { setDeletingAccount(account); setNotice('') }} aria-label={`Delete ${account.name}`} className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm text-[#a43b32] hover:bg-[#fcf0ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a43b32]"><Trash2 size={16} aria-hidden="true" /><span>Delete</span></button>}</div>
    </li>)}</ul>}
    {canCreate && creating && <CreateAccountDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setNotice('Account added.') }} />}
    {selectedId !== null && <AccountDetails accountId={selectedId} workspaceId={workspaceId} canDelete={canCreate} onDelete={setDeletingAccount} onClose={() => setSelectedId(null)} onSaved={() => { setSelectedId(null); setNotice('Account updated.') }} />}
    {canCreate && deletingAccount && <DeleteAccountDialog key={deletingAccount.account_id} workspaceId={workspaceId} account={deletingAccount} onClose={() => setDeletingAccount(null)} onDeleted={() => {
      setDeletingAccount(null)
      if (selectedId === deletingAccount.account_id) setSelectedId(null)
      setNotice(`“${deletingAccount.name}” was deleted.`)
      requestAnimationFrame(() => addButton.current?.focus())
    }} />}

  </section>
}
