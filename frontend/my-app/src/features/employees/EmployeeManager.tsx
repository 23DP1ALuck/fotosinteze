import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { useDepartments } from '@/features/departments/use-departments'
import { addEmployee, assignEmployee, listMembers, MemberApiError, removeEmployee, type WorkspaceMember } from './api'
import { EmployeeDialog, type MemberAction } from './EmployeeDialog'

const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-50'
const secondary = 'rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4] disabled:opacity-50'
type Props = { workspaceId: number; workspaceName: string; canManage: boolean }

export function EmployeeManager(props: Props) {
  return props.canManage ? <OwnerEmployees key={`${authAccountId()}-${props.workspaceId}`} workspaceId={props.workspaceId} workspaceName={props.workspaceName} /> : null
}

function OwnerEmployees({ workspaceId, workspaceName }: Omit<Props, 'canManage'>) {
  const client = useQueryClient()
  const accountId = authAccountId()
  const departments = useDepartments(workspaceId, true, 'OWNER')
  const key = ['members', accountId, workspaceId] as const
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => listMembers(workspaceId, signal), enabled: accountId !== null })
  const [action, setAction] = useState<MemberAction | null>(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const members = query.isError ? [] : query.data ?? []
  const rows = members.filter(member => `${member.display_name} ${member.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const denied = query.error instanceof MemberApiError && query.error.status === 403
  useEffect(() => {
    if (denied) void client.invalidateQueries({ queryKey: ['workspaces', accountId], exact: true })
  }, [denied, client, accountId])
  async function save(next: MemberAction, email?: string, departmentId?: number) {
    if (accountId === null || authAccountId() !== accountId || activeWorkspaceId() !== workspaceId) throw new Error('Your workspace or account changed. Reopen Employees before retrying.')
    if (next.kind === 'remove' && next.member.role !== 'EMPLOYEE') throw new Error('Owners cannot be removed from this workspace.')
    let added: WorkspaceMember | undefined
    try {
      if (next.kind === 'add') added = await addEmployee(workspaceId, email ?? '', departmentId)
      else if (next.kind === 'assign') await assignEmployee(workspaceId, next.member.user_id, departmentId!)
      else await removeEmployee(workspaceId, next.member.user_id)
    } catch (error) {
      if (error instanceof MemberApiError && error.status === 403 && authAccountId() === accountId) void client.invalidateQueries({ queryKey: ['workspaces', accountId], exact: true })
      throw error
    }
    if (authAccountId() !== accountId) return false
    await client.cancelQueries({ queryKey: key, exact: true })
    if (authAccountId() !== accountId) return false
    client.setQueryData<WorkspaceMember[]>(key, previous => next.kind === 'remove'
      ? previous?.filter(member => member.user_id !== next.member.user_id)
      : next.kind === 'assign' ? previous?.map(member => member.user_id === next.member.user_id ? { ...member, department_id: departmentId! } : member) : added ? [...(previous ?? []).filter(member => member.user_id !== added.user_id), added] : previous)
    void client.invalidateQueries({ queryKey: key, exact: true })
    void client.invalidateQueries({ predicate: query => query.queryKey[1] === accountId && query.queryKey[2] === workspaceId && query.queryKey[0] !== 'members' })
    if (activeWorkspaceId() !== workspaceId) return false
    setSearch('')
    setNotice(next.kind === 'add' ? 'Employee added and assigned to their department.' : next.kind === 'assign' ? 'Employee department updated.' : 'Employee removed. Their workspace access has been revoked.')
    return true
  }
  return <section aria-label="Employees management" className="rounded-[20px] bg-white p-6 max-sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#d5f579]"><Users size={22} /></span><div><h2 className="text-[22px] font-semibold!">Your employees</h2><p className="mt-1 text-xs text-[#7d877f]">{workspaceName} · Give your team access to their workspace.</p></div></div><button type="button" disabled={query.isPending || query.isFetching || query.isError || departments.loading || Boolean(departments.error) || !departments.departments.length} onClick={() => { setNotice(''); setAction({ kind: 'add' }) }} className={primary}><Plus size={17} />Add employee</button></div>
    <div className="mt-6 flex flex-wrap items-center gap-3"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#f7f8f2] px-4"><Search size={16} className="shrink-0 text-[#68796e]" /><input aria-label="Search members" placeholder="Search by name or email" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 w-full bg-transparent py-3 text-sm outline-none" /></label><button type="button" aria-label="Refresh members" disabled={query.isFetching} onClick={() => void query.refetch()} className={secondary}><RefreshCw size={16} className={query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''} /></button></div>
    {!departments.loading && !departments.error && !departments.departments.length && <p className="mt-4 rounded-xl bg-[#eaf0e6] p-4 text-sm text-[#68796e]">Create a department in Departments first, then add and assign your employees.</p>}
    {departments.error && <p role="alert" className="mt-4 text-sm text-[#a43b32]">{departments.error}<button onClick={departments.refresh} className="ml-3 underline">Retry departments</button></p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-[#eaf0e5] p-4 text-sm">{notice}</p>}
    {query.isPending && <p role="status" className="mt-6 text-sm text-[#68796e]">Loading members…</p>}
    {query.isError && <div className="mt-5 rounded-xl bg-[#fcf0ed] p-4"><p role="alert" className="text-sm text-[#a43b32]">{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className={`${secondary} mt-3`}>Retry members</button></div>}
    {!query.isPending && !query.isError && <><p className="mt-5 text-xs text-[#68796e]">{members.filter(member => member.role === 'EMPLOYEE').length} employees · Owners manage membership. Owners cannot be removed here.</p>
      <ul aria-label="Workspace members" className="mt-4 grid gap-3">{rows.map(member => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e1e5df] p-5 max-sm:p-4"><div className="flex min-w-0 flex-1 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf0e6] text-sm">{(member.display_name || member.email).slice(0, 2).toUpperCase()}</span><div className="min-w-0"><strong className="block wrap-anywhere text-sm">{member.display_name || member.email}</strong><p className="mt-1 wrap-anywhere text-xs text-[#7d877f]">{member.email}</p>{member.role === 'EMPLOYEE' && <p className="mt-1 text-xs text-[#68796e]">{member.department_id === null ? 'Unassigned department' : departments.departments.find(item => item.id === member.department_id)?.name ?? 'Loading department…'}</p>}</div></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs ${member.role === 'OWNER' ? 'bg-[#d5f579]' : 'bg-[#f3f6ed] text-[#68796e]'}`}>{member.role === 'OWNER' ? 'Owner' : 'Employee'}</span>{member.role === 'EMPLOYEE' && <><button type="button" aria-label={`Assign department for ${member.display_name || member.email}`} disabled={query.isFetching || departments.loading || Boolean(departments.error)} onClick={() => { setNotice(''); setAction({ kind: 'assign', member }) }} className={secondary}>Assign department</button><button type="button" aria-label={`Remove ${member.display_name || member.email}`} disabled={query.isFetching} onClick={() => { setNotice(''); setAction({ kind: 'remove', member }) }} className="rounded-lg p-2 text-[#7d877f] hover:bg-[#fcf0ed] hover:text-[#a43b32] disabled:opacity-50"><Trash2 size={17} /></button></>}</div></li>)}</ul>
      {!rows.length && <div className="mt-5 rounded-2xl border border-dashed border-[#dce4d8] p-8 text-center text-sm text-[#7d877f]">{search ? 'No members match your search.' : 'No members found. Refresh to check the workspace.'}</div>}
    </>}
    {action && <EmployeeDialog action={action} departments={departments.departments} onSave={save} onClose={() => setAction(null)} />}
  </section>
}
