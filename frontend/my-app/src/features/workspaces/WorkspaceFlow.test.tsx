import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { render } from '@/test/render'
import { createFinanceTransport } from '@/test/finance-transport'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext } from '@/features/auth/use-auth'
import { clearSession, setAccessToken } from '@/features/auth/storage'
import HomePage from '@/pages/HomePage'
import { TransactionsView } from './TransactionsView'
const workspaces=[{id:7,name:'Personal',type:'PERSONAL',role:'OWNER'},{id:42,name:'Acme Studio',type:'BUSINESS',role:'OWNER'},{id:43,name:'Beta Studio',type:'BUSINESS',role:'EMPLOYEE'}]
const token=`h.${btoa(JSON.stringify({sub:'1',exp:Math.floor(Date.now()/1000)+3600}))}.s`
beforeEach(()=>{
  localStorage.clear();clearSession();setAccessToken(token)
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','')}})
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.removeAttribute('open')}})
  const finance = createFinanceTransport()
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).endsWith('/workspaces')) return Response.json(workspaces)
    const response = finance.respond(url, init)
    if (response) return response
    const id=Number(new Headers(init.headers).get('X-Workspace-ID'))
    if(String(url).endsWith('/projects'))return Response.json([{id:10,workspace_id:id,name:'Website',status:'Active',department_ids:[7],start_date:null,end_date:null}])
    if(String(url).endsWith('/departments'))return Response.json([{id:7,workspace_id:id,name:'Development'}])
    return Response.json([])
  }))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals();clearSession()})
async function renderWorkspace(){
  render(<AuthContext.Provider value={{status:'authenticated',user:{id:1,displayName:'Ada',email:'ada@example.com'},token,login:async()=>{},register:async()=>{},logout:async()=>{}}}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
  await screen.findByRole('button',{name:'Switch workspace, Personal'})
}
async function switchWorkspace(from:string,to:string){await userEvent.click(screen.getByRole('button',{name:`Switch workspace, ${from}`}));await userEvent.click(screen.getByRole('button',{name:`Switch to ${to}`}))}
it('loads actual memberships and displays Personal, Business and membership roles',async()=>{
  await renderWorkspace(); await userEvent.click(screen.getByRole('button',{name:'Switch workspace, Personal'}))
  expect(screen.getByRole('button',{name:'Switch to Acme Studio'})).toHaveTextContent('Owner')
  expect(screen.getByRole('button',{name:'Switch to Beta Studio'})).toHaveTextContent('Employee')
  await userEvent.click(screen.getByRole('button',{name:'Switch to Acme Studio'}))
  expect(screen.getByRole('heading',{name:'Your business, at a glance.'})).toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Revolut'})).not.toBeInTheDocument()
})
it('keeps business and personal transaction data separate across switches',async()=>{
  const user=userEvent.setup();await renderWorkspace()
  await user.click(screen.getByRole('button',{name:'Add expense'}));let modal=within(screen.getByRole('dialog'))
  await user.selectOptions(modal.getByLabelText('Account'), '12');await user.selectOptions(modal.getByLabelText('Category'), '4');await user.type(modal.getByLabelText('Description'),'Personal groceries');await user.type(modal.getByLabelText('Amount (EUR)'),'50');await user.click(modal.getByRole('button',{name:'Save expense'}));await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add expense' })).not.toBeInTheDocument())
  await switchWorkspace('Personal','Acme Studio')
  expect(within(screen.getByRole('main')).queryByText('Personal groceries')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Add income'}));modal=within(screen.getByRole('dialog'))
  await user.selectOptions(modal.getByLabelText('Account'), '13');await user.selectOptions(modal.getByLabelText('Category'), '6');await user.type(modal.getByLabelText('Description'),'Client project');await user.type(modal.getByLabelText('Amount (EUR)'),'900');await user.click(modal.getByRole('button',{name:'Save income'}));await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add income' })).not.toBeInTheDocument())
  await switchWorkspace('Acme Studio','Personal');expect(within(screen.getByRole('main')).getByText('Personal groceries')).toBeInTheDocument()
  expect(within(screen.getByRole('main')).queryByText('Client project')).not.toBeInTheDocument()
})
it('lets employees manage assigned project details while reserving deletion for owners',async()=>{
  await renderWorkspace(); await switchWorkspace('Personal','Beta Studio')
  await userEvent.click(within(screen.getByRole('navigation',{name:'Workspace'})).getByRole('button',{name:'Projects'}))
  await within(screen.getByRole('list',{name:'Projects'})).findByText('Website');expect(screen.getByRole('button',{name:'Add project'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Edit Website'})).toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Delete Website'})).not.toBeInTheDocument()
})
it('uses the shared Personal transaction menu with source filters and details',async()=>{
  const user=userEvent.setup();await renderWorkspace();await user.click(screen.getByRole('button',{name:'Transactions'}))
  expect(screen.queryByRole('columnheader',{name:'Department'})).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Filter by source'),'Revolut');expect(screen.getAllByRole('row')).toHaveLength(3)
  await user.click(screen.getByRole('button',{name:'View Rimi details'}));expect(screen.getByRole('dialog')).toHaveTextContent('Revolut')
})
it('paginates and combines business transaction filters',async()=>{
  const user=userEvent.setup()
  const transactions=Array.from({length:10},(_,index)=>({id:index,name:`Invoice ${index}`,category:index%2?'Software':'Services',source:'Manual',date:'2026-09-22',amount:index%2?-10:100,department:'Development',project:index%2?'App':'Website'}))
  render(<TransactionsView transactions={transactions} income={500} expenses={50} workspaceName="Acme" />)
  expect(screen.getAllByRole('row')).toHaveLength(9);await user.click(screen.getByRole('button',{name:'Next →'}));expect(screen.getAllByRole('row')).toHaveLength(3)
  await user.selectOptions(screen.getByLabelText('Filter by category'),'Services');expect(screen.getByRole('button',{name:'← Previous'})).toBeDisabled()
  await user.click(screen.getByRole('button',{name:'Expenses'}));expect(screen.getByText('No transactions match these filters.')).toBeInTheDocument()
})
it('uses active backend project IDs in Business transaction selectors',async()=>{
  const user=userEvent.setup();await renderWorkspace();await switchWorkspace('Personal','Acme Studio')
  await user.click(screen.getByRole('button',{name:'Projects'}));await screen.findByRole('button',{name:'Edit Website'})
  expect(screen.queryByLabelText('Workspace ID')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Add expense'}));const modal=within(screen.getByRole('dialog'))
  await user.selectOptions(modal.getByLabelText('Account'), '13');await user.selectOptions(modal.getByLabelText('Category'), '5');await user.type(modal.getByLabelText('Description'),'Website promotion');await user.type(modal.getByLabelText('Amount (EUR)'),'900')
  await user.selectOptions(modal.getByLabelText('Department'),'7');await user.selectOptions(modal.getByLabelText('Project'),'10');await user.click(modal.getByRole('button',{name:'Save expense'}));await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add expense' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button',{name:'Transactions'}));expect(screen.getByRole('row',{name:/Website promotion Expense Marketing Development Website/})).toBeInTheDocument()
})


it('creates, edits and deletes sample budgets, retains the period, and shows exceeded spending', async () => {
  const user = userEvent.setup()
  await renderWorkspace()
  await user.click(screen.getByRole('button', { name: /^Budgets$/ }))
  await user.click(screen.getByRole('button', { name: 'Manage budgets' }))
  let modal = within(screen.getByRole('dialog'))
  await user.clear(modal.getByLabelText('Groceries (€)'))
  await user.type(modal.getByLabelText('Groceries (€)'), '10')
  await user.selectOptions(modal.getByLabelText('Period Groceries'), 'WEEKLY')
  await user.type(modal.getByLabelText('New budget name'), 'Travel')
  await user.click(modal.getByRole('button', { name: '+ Add budget' }))
  await user.click(modal.getByRole('button', { name: 'Delete Transport' }))
  await user.click(modal.getByRole('button', { name: 'Save budgets' }))
  expect(screen.getByText('Exceeded')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /^Travel$/ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /^Transport$/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Manage budgets' }))
  modal = within(screen.getByRole('dialog'))
  expect(modal.getByLabelText('Period Groceries')).toHaveValue('WEEKLY')
  expect(modal.getByLabelText('Groceries (€)')).toHaveValue(10)
})


it('creates a business through the API and selects its persisted workspace ID', async () => {
  const user = userEvent.setup()
  let finish: (response: Response) => void = () => {}
  const fallback = vi.mocked(fetch).getMockImplementation()!
  const create = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', vi.fn((url, init) => String(url).endsWith('/workspaces/business') ? create(url, init) : fallback(url, init)))
  await renderWorkspace()
  await user.click(screen.getByRole('button', { name: 'Create business workspace' }))
  const modal = within(screen.getByRole('dialog', { name: 'Make room for your business.' }))
  await user.type(modal.getByLabelText('Workspace name'), 'New Studio')
  await user.clear(modal.getByLabelText('Base currency'))
  await user.type(modal.getByLabelText('Base currency'), 'eur')
  await user.click(modal.getByRole('button', { name: 'Create business workspace' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(modal.getByRole('button', { name: 'Creating workspace…' })).toBeDisabled()
  const init = create.mock.calls[0][1]!
  expect(init.method).toBe('POST')
  expect(JSON.parse(String(init.body))).toEqual({ name: 'New Studio', base_currency: 'EUR' })
  const headers = new Headers(init.headers)
  expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
  expect(headers.has('X-Workspace-ID')).toBe(false)
  expect(headers.has('Workspace-ID')).toBe(false)
  await act(async () => finish(Response.json({ id: 81, name: 'New Studio', type: 'BUSINESS', role: 'OWNER' }, { status: 201 })))
  await screen.findByRole('button', { name: 'Switch workspace, New Studio' })
  expect(screen.queryByRole('dialog', { name: 'Make room for your business.' })).not.toBeInTheDocument()
  expect(localStorage.getItem('fotosinteze.workspace.1')).toBe('81')
  await switchWorkspace('New Studio', 'Personal')
  await switchWorkspace('Personal', 'New Studio')
  expect(screen.getByRole('button', { name: 'Switch workspace, New Studio' })).toHaveTextContent('Owner')
})

it('keeps the creation form and selection after a server error, allowing retry', async () => {
  const user = userEvent.setup()
  const fallback = vi.mocked(fetch).getMockImplementation()!
  let fail = true
  vi.stubGlobal('fetch', vi.fn((url, init) => String(url).endsWith('/workspaces/business')
    ? Promise.resolve(fail ? Response.json({ detail: 'Workspace name is already taken' }, { status: 409 }) : Response.json({ id: 81, name: 'New Studio', type: 'BUSINESS', role: 'OWNER' }, { status: 201 }))
    : fallback(url, init)))
  await renderWorkspace()
  await user.click(screen.getByRole('button', { name: 'Create business workspace from workspace switcher' }))
  const modal = within(screen.getByRole('dialog', { name: 'Make room for your business.' }))
  await user.type(modal.getByLabelText('Workspace name'), 'New Studio')
  await user.click(modal.getByRole('button', { name: 'Create business workspace' }))
  expect(await modal.findByRole('alert')).toHaveTextContent('Workspace name is already taken')
  expect(modal.getByLabelText('Workspace name')).toHaveValue('New Studio')
  expect(localStorage.getItem('fotosinteze.workspace.1')).toBe('7')
  fail = false
  await user.click(modal.getByRole('button', { name: 'Create business workspace' }))
  await screen.findByRole('button', { name: 'Switch workspace, New Studio' })
})

it('allows creation when the account has no accessible workspaces', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<AuthContext.Provider value={{ status: 'authenticated', user: { id: 1, displayName: 'Ada', email: 'ada@example.com' }, token, login: async () => {}, register: async () => {}, logout: async () => {} }}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
  await screen.findByRole('heading', { name: 'No accessible workspaces' })
  await userEvent.click(screen.getByRole('button', { name: 'Create business workspace' }))
  expect(screen.getByRole('dialog', { name: 'Make room for your business.' })).toBeInTheDocument()
})

it('opens account management from personal and business navigation with scoped balances', async () => {
  await renderWorkspace()
  await userEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  expect(await screen.findByRole('list', { name: 'Accounts' })).toHaveTextContent('€4,820.50')
  await switchWorkspace('Personal', 'Acme Studio')
  await userEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  const business = await screen.findByRole('list', { name: 'Accounts' })
  expect(business).toHaveTextContent('€0.00')
  expect(business).not.toHaveTextContent('€4,820.50')
  await switchWorkspace('Acme Studio', 'Personal')
  expect(await screen.findByRole('list', { name: 'Accounts' })).toHaveTextContent('€4,820.50')
})


it('loads saved members and adds an existing user by email through the owner Employees page', async () => {
  const fallback = vi.mocked(fetch).getMockImplementation()!
  const owner = { user_id: 1, workspace_id: 42, display_name: 'Ada', email: 'ada@example.com', role: 'OWNER', department_id: null, joined_at: '2026-10-01T12:00:00' }
  const employee = { ...owner, user_id: 8, display_name: 'Anna', email: 'anna@example.com', role: 'EMPLOYEE' }
  let members = [owner]
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = new URL(String(url), 'http://test').pathname.replace(/^\/api/, '')
    if (path === '/workspaces/42/members') return Response.json(members)
    if (path === '/workspaces/42/employees' && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ email: 'anna@example.com', department_id: 7 })
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`)
      expect(new Headers(init.headers).has('Workspace-ID')).toBe(false)
      members = [owner, employee]
      return Response.json(employee, { status: 201 })
    }
    return fallback(url, init)
  }))
  await renderWorkspace()
  await switchWorkspace('Personal', 'Acme Studio')
  await userEvent.click(screen.getByRole('button', { name: 'Employees' }))
  expect(await screen.findByRole('list', { name: 'Workspace members' })).toHaveTextContent('ada@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Add employee' }))
  const modal = within(screen.getByRole('dialog', { name: 'Add employee' }))
  expect(modal.queryByLabelText('Full name')).not.toBeInTheDocument()
  await userEvent.type(modal.getByLabelText('Email address'), 'anna@example.com')
  await userEvent.selectOptions(modal.getByLabelText('Department'), '7')
  await userEvent.click(modal.getByRole('button', { name: 'Add employee' }))
  expect(await screen.findByText('anna@example.com')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove Ada' })).not.toBeInTheDocument()
  await switchWorkspace('Acme Studio', 'Beta Studio')
  expect(screen.queryByRole('button', { name: 'Employees' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Employees management' })).not.toBeInTheDocument()
})

it('refreshes role-scoped catalogs on demotion and excludes a late owner mutation', async () => {
  let client: QueryClient | undefined
  function CaptureClient() { client = useQueryClient(); return null }
  let employee = false
  let finishOwnerSave: (response: Response) => void = () => {}
  const secret = { id: 10, workspace_id: 42, name: 'Owner secret', status: 'Active', department_ids: [8], start_date: null, end_date: null }
  const assigned = { ...secret, id: 11, name: 'Assigned project', department_ids: [7], }
  const fallback = vi.mocked(fetch).getMockImplementation()!
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = new URL(String(url), 'http://test').pathname.replace(/^\/api/, '')
    if (path === '/workspaces') return Response.json(workspaces.map(row => row.id === 42 && employee ? { ...row, role: 'EMPLOYEE' } : row))
    if (path === '/projects/10' && init?.method === 'PUT') return new Promise<Response>(resolve => { finishOwnerSave = resolve })
    if (path === '/projects') return Response.json(employee ? [assigned] : [secret, assigned])
    if (path === '/departments') return Response.json(employee ? [{ id: 7, workspace_id: 42, name: 'Development' }] : [{ id: 7, workspace_id: 42, name: 'Development' }, { id: 8, workspace_id: 42, name: 'Secret department' }])
    return fallback(url, init)
  }))
  render(<><CaptureClient /><AuthContext.Provider value={{status:'authenticated',user:{id:1,displayName:'Ada',email:'ada@example.com'},token,login:async()=>{},register:async()=>{},logout:async()=>{}}}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider></>)
  await screen.findByRole('button', { name: 'Switch workspace, Personal' })
  await switchWorkspace('Personal', 'Acme Studio')
  await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Owner secret' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' })).toBeDisabled())
  client!.setQueryData(['statistics', 1, 42, 'cached-owner-report'], { secret: true })
  employee = true
  await act(async () => { await client!.invalidateQueries({ queryKey: ['workspaces', 1], exact: true }) })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await screen.findByRole('button', { name: 'Edit Assigned project' })
  expect(screen.queryByText('Owner secret')).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Secret department' })).not.toBeInTheDocument()
  expect(client!.getQueryData(['statistics', 1, 42, 'cached-owner-report'])).toBeUndefined()
  expect(client!.getQueryData(['workspaces', 1])).toBeDefined()
  await act(async () => finishOwnerSave(Response.json({ ...secret, name: 'Late owner response' })))
  expect(screen.queryByText('Late owner response')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit Assigned project' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Assigned project' })).not.toBeInTheDocument()
})
