import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { ExpenseExplorer } from './ExpenseExplorer'
import { MonthlyReview } from './MonthlyReview'
import { monthRange, reviewLines } from './review-export'
const range = { from: '2026-10-01', to: '2026-10-31' }
beforeEach(() => {
  setAccessToken(`h.${btoa(JSON.stringify({sub:'1',exp:Math.floor(Date.now()/1000)+3600}))}.s`); setWorkspace(1,7)
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','')}})
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.removeAttribute('open')}})
  vi.stubGlobal('fetch',vi.fn(async (input,init) => {
    const u=new URL(String(input),'http://localhost'); const id=Number(new Headers(init?.headers).get('X-Workspace-ID'))
    const base={workspace_id:id,currency:'EUR',date_from:u.searchParams.get('date_from'),date_to:u.searchParams.get('date_to')}
    if(u.pathname.endsWith('/summary'))return Response.json({...base,income:'3200',expenses:'1842.35'})
    if(u.pathname.endsWith('/categories'))return Response.json({...base,items:[{id:4,name:'Groceries',amount:'420'}]})
    return Response.json({items:[{transaction_id:1,workspace_id:id,amount:'180',currency:'EUR',description:'Rimi',source:'MANUAL',account_id:12,category_id:4,department_id:null,project_id:null,expense_id:null,created_at:'2026-10-22T12:00:00',updated_at:'2026-10-22T12:00:00'}],limit:50,offset:Number(u.searchParams.get('offset')),has_more:false})
  }))
})
afterEach(()=>{cleanup();clearSession();vi.unstubAllGlobals()})
it('preserves workspace, category and inclusive month when exploring expenses',async()=>{
  render(<ExpenseExplorer workspaceId={7} range={range} onClose={()=>{}} />)
  await userEvent.click(await screen.findByRole('button',{name:/Groceries/}))
  expect(await screen.findByText('Rimi')).toBeInTheDocument()
  const call=vi.mocked(fetch).mock.calls.find(([url])=>String(url).includes('/transactions?'))!
  expect(String(call[0])).toContain('category_id=4')
  expect(String(call[0])).toContain('date_to=2026-10-31')
  expect(String(call[0])).toContain('type=EXPENSE')
  expect(new Headers(call[1]?.headers).get('X-Workspace-ID')).toBe('7')
})
it('does not keep old category data when the workspace changes',async()=>{
  const view=render(<ExpenseExplorer workspaceId={7} range={range} onClose={()=>{}} />)
  await screen.findByRole('button',{name:/Groceries/})
  vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}))
  setWorkspace(1,42)
  view.rerender(<ExpenseExplorer workspaceId={42} range={range} onClose={()=>{}} />)
  expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
})
it('shows a monthly review and hides exact amounts and identity in the export by default',async()=>{
  render(<MonthlyReview workspaceId={7} workspaceName="Private studio" kind="personal" initialMonth="2026-10" />)
  await screen.findByText('€1,357.65')
  const preview=within(screen.getByRole('region',{name:'Export preview'}))
  expect(preview.queryByText(/1,357/)).not.toBeInTheDocument()
  expect(preview.queryByText('Private studio')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox',{name:'Show exact amounts'}))
  expect(preview.getByText(/€1,357.65/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Review month'),{target:{value:'2026-02'}})
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('date_to=2026-02-28'))).toBe(true))
})
it('calculates leap months and never includes hidden export values',()=>{
  expect(monthRange('2024-02')).toEqual({from:'2024-02-01',to:'2024-02-29'})
  expect(monthRange('2026-13')).toBeNull()
  const lines=reviewLines({month:'October 2026',workspaceName:'Secret',currency:'EUR',income:3200,expenses:1842.35,kind:'personal',showAmounts:false,showName:false})
  expect(lines.join(' ')).not.toMatch(/Secret|3200|1842|1,357/)
  expect(lines.join(' ')).toContain('42.4%')
})
it('refreshes explored transactions and monthly totals after deleting an expense',async()=>{
  const { DeleteTransactionDialog }=await import('@/features/transactions/DeleteTransactionDialog')
  const fallback=vi.mocked(fetch).getMockImplementation()!
  let deleted=false
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    if(init?.method==='DELETE'){deleted=true;return new Response(null,{status:204})}
    const response=await fallback(input,init)
    if(!deleted)return response
    const url=String(input)
    const body=await response.json()
    if(url.includes('/summary?'))body.expenses='1662.35'
    if(url.includes('/transactions?'))body.items=[]
    if(url.includes('/categories?'))body.items=[{id:4,name:'Groceries',amount:'240'}]
    return Response.json(body)
  })
  const transaction={transaction_id:1,workspace_id:7,amount:'180',currency:'EUR',description:'Rimi',source:'MANUAL' as const,account_id:12,category_id:4,department_id:null,project_id:null,expense_id:null,created_at:'2026-10-22T12:00:00',updated_at:'2026-10-22T12:00:00'}
  render(<><ExpenseExplorer workspaceId={7} range={range} onClose={()=>{}}/><MonthlyReview workspaceId={7} workspaceName="Personal" kind="personal" initialMonth="2026-10"/><DeleteTransactionDialog workspaceId={7} transaction={transaction} onClose={()=>{}} onDeleted={()=>{}}/></>)
  await screen.findByText('€1,357.65')
  await userEvent.click(await screen.findByRole('button',{name:/Groceries/}))
  await screen.findByText('Rimi')
  await userEvent.click(screen.getByRole('button',{name:'Delete transaction'}))
  await waitFor(()=>expect(screen.queryByText('Rimi')).not.toBeInTheDocument())
  expect(await screen.findByText('€240.00')).toBeInTheDocument()
  expect(await screen.findByText('€1,537.65')).toBeInTheDocument()
})
it('pages uncategorised expenses without inventing a category filter or leaking other categories',async()=>{
  const fallback=vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    const url=new URL(String(input),'http://localhost')
    const response=await fallback(input,init)
    const body=await response.json()
    if(url.pathname.endsWith('/categories'))body.items=[{id:null,name:'Uncategorised',amount:'180'}]
    if(url.pathname.endsWith('/transactions')){
      const next=url.searchParams.get('offset')==='50'
      body.has_more=!next
      if(next){body.items[0].category_id=null;body.items[0].description='Unassigned taxi'}
    }
    return Response.json(body)
  })
  render(<ExpenseExplorer workspaceId={7} range={range} onClose={()=>{}} />)
  await userEvent.click(await screen.findByRole('button',{name:/Uncategorised/}))
  expect(await screen.findByText(/No matching transactions on this page/)).toBeInTheDocument()
  expect(screen.queryByText('Rimi')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Load more transactions'}))
  expect(await screen.findByText('Unassigned taxi')).toBeInTheDocument()
  const urls=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/transactions?')).map(([url])=>String(url))
  expect(urls[1]).toContain('offset=50')
  expect(urls.every(url=>!url.includes('category_id='))).toBe(true)
})
it('recovers from a category load error instead of showing an empty total as successful data',async()=>{
  const fallback=vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({detail:'Unavailable'},{status:503}))
  render(<ExpenseExplorer workspaceId={7} range={range} onClose={()=>{}} />)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
  vi.mocked(fetch).mockImplementation(fallback)
  await userEvent.click(screen.getByRole('button',{name:'Retry expense categories'}))
  expect(await screen.findByRole('button',{name:/Groceries/})).toBeInTheDocument()
})
it('exports a negative net result without dividing zero income or exposing disabled identity',()=>{
  const lines=reviewLines({month:'October 2026',workspaceName:'Secret',currency:'EUR',income:0,expenses:120.50,kind:'business',showAmounts:true,showName:false})
  expect(lines.join(' ')).toContain('Net result: -€120.50')
  expect(lines.join(' ')).not.toMatch(/Infinity|NaN|Secret/)
})
it('prints only enabled export values and escapes workspace names as text',async()=>{
  const {printReview}=await import('./review-export')
  printReview({month:'October 2026',workspaceName:'<script>bad()</script>',currency:'EUR',income:3200,expenses:1842.35,kind:'personal',showAmounts:false,showName:true})
  const frame=document.querySelector('iframe')!
  expect(frame.srcdoc).toContain('&lt;script&gt;bad()&lt;/script&gt;')
  expect(frame.srcdoc).not.toContain('<script>')
  expect(frame.srcdoc).not.toMatch(/3,200|1,842|1,357/)
  frame.remove()
})
