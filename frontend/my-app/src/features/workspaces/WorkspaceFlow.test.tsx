import { render } from '@/test/render'
import { cleanup, screen, within } from '@testing-library/react'
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
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).endsWith('/workspaces')) return Response.json(workspaces)
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
  await user.type(modal.getByLabelText('Description'),'Personal groceries');await user.type(modal.getByLabelText('Amount (€)'),'50');await user.click(modal.getByRole('button',{name:'Save expense'}))
  await switchWorkspace('Personal','Acme Studio')
  expect(within(screen.getByRole('main')).queryByText('Personal groceries')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Add income'}));modal=within(screen.getByRole('dialog'))
  await user.type(modal.getByLabelText('Description'),'Client project');await user.type(modal.getByLabelText('Amount (€)'),'900');await user.click(modal.getByRole('button',{name:'Save income'}))
  await switchWorkspace('Acme Studio','Personal');expect(within(screen.getByRole('main')).getByText('Personal groceries')).toBeInTheDocument()
  expect(within(screen.getByRole('main')).queryByText('Client project')).not.toBeInTheDocument()
})
it('shows employee role and hides owner-only project management',async()=>{
  await renderWorkspace(); await switchWorkspace('Personal','Beta Studio')
  await userEvent.click(within(screen.getByRole('navigation',{name:'Workspace'})).getByRole('button',{name:'Projects'}))
  await within(screen.getByRole('list',{name:'Projects'})).findByText('Website');expect(screen.queryByRole('button',{name:'Add project'})).not.toBeInTheDocument()
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
it('uses active backend project IDs in Business transaction and budget selectors',async()=>{
  const user=userEvent.setup();await renderWorkspace();await switchWorkspace('Personal','Acme Studio')
  await user.click(screen.getByRole('button',{name:'Projects'}));await screen.findByRole('button',{name:'Edit Website'})
  expect(screen.queryByLabelText('Workspace ID')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'Add expense'}));let modal=within(screen.getByRole('dialog'))
  await user.type(modal.getByLabelText('Description'),'Website promotion');await user.type(modal.getByLabelText('Amount (€)'),'900')
  await user.selectOptions(modal.getByLabelText('Department'),'7');await user.selectOptions(modal.getByLabelText('Project'),'10');await user.click(modal.getByRole('button',{name:'Save expense'}))
  await user.click(screen.getByRole('button',{name:/^Budgets$/}));await user.click(screen.getByRole('button',{name:'Manage budgets'}));modal=within(screen.getByRole('dialog'))
  const marketing=within(modal.getByRole('group',{name:'Marketing'}));await user.selectOptions(marketing.getByLabelText('Department'),'7');await user.selectOptions(marketing.getByLabelText('Project'),'10');await user.click(modal.getByRole('button',{name:'Save budgets'}))
  expect(screen.getByRole('progressbar',{name:'Marketing budget used'})).toHaveAttribute('value','900')
  await user.click(screen.getByRole('button',{name:'Transactions'}));expect(screen.getByRole('row',{name:/Website promotion Marketing Development Website Ada/})).toBeInTheDocument()
})
