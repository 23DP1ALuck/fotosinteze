import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useQuery } from '@tanstack/react-query'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { AuthContext, type AuthContextValue } from '@/features/auth/use-auth'
import { setAccessToken, clearSession, getAccessToken } from '@/features/auth/storage'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { WorkspaceProvider } from './WorkspaceProvider'
import { useWorkspace } from './use-workspace'
import { workspaceQueryKey } from './workspace-state'
const rows = [{ id: 7, name: 'Personal', type: 'PERSONAL', role: 'OWNER' }, { id: 42, name: 'Studio', type: 'BUSINESS', role: 'OWNER' }, { id: 43, name: 'Agency', type: 'BUSINESS', role: 'EMPLOYEE' }]
const token = `h.${btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now()/1000)+3600 }))}.s`
const auth: AuthContextValue = { status: 'authenticated', user: { id: 1, email: 'a@test.com', displayName: 'A' }, token, login: async()=>{}, register: async()=>{}, logout: async()=>{} }
function Probe() {
  const workspace = useWorkspace()
  const data = useQuery({ queryKey: workspaceQueryKey('categories',workspace.activeWorkspace?.id), enabled: Boolean(workspace.activeWorkspace), queryFn: async ({signal}) => (await authenticatedFetch('/categories',{signal})).json() })
  return <><p>{workspace.status}</p><p>Selected: {workspace.activeWorkspace?.name || 'None'}</p>{workspace.workspaces.map(item=><button key={item.id} onClick={()=>workspace.selectWorkspace(item.id)}>{item.name}</button>)}{workspace.error && <p role="alert">{workspace.error}</p>}<button onClick={workspace.retry}>Retry</button>{data.data && <p>Data: {data.data[0]?.name}</p>}</>
}
function mount(value=auth) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const tree=(next:AuthContextValue)=><QueryClientProvider client={client}><AuthContext.Provider value={next}><WorkspaceProvider><Probe /></WorkspaceProvider></AuthContext.Provider></QueryClientProvider>
  const view=render(tree(value)); return {client,...view, change(next:AuthContextValue){ view.rerender(tree(next)) }}
}
beforeEach(()=>{ localStorage.clear(); clearSession(); setAccessToken(token) })
afterEach(()=>{ cleanup(); clearSession(); vi.unstubAllGlobals() })
function transport(available=rows) {
  vi.stubGlobal('fetch',vi.fn(async (url,init)=>{
    const h=new Headers(init.headers)
    expect(h.get('Authorization')).toBe(`Bearer ${token}`)
    if(String(url).endsWith('/workspaces')) {
      expect(h.has('X-Workspace-ID')).toBe(false); expect(h.has('Workspace-ID')).toBe(false)
      return Response.json(available)
    }
    const id=h.get('X-Workspace-ID'); expect(h.get('Workspace-ID')).toBe(id)
    return Response.json([{name:`Workspace ${id}`}])
  }))
}
it('defaults to Personal and switches scoped headers/data without changing the JWT',async()=>{
  transport(); mount(); await screen.findByText('Selected: Personal'); await screen.findByText('Data: Workspace 7')
  await userEvent.click(screen.getByRole('button',{name:'Studio'}))
  await screen.findByText('Data: Workspace 42'); expect(getAccessToken()).toBe(token)
  expect(screen.queryByText('Data: Workspace 7')).not.toBeInTheDocument()
})
it('rejects inaccessible saved selection and restores only accessible workspace IDs',async()=>{
  localStorage.setItem('fotosinteze.workspace.1','999'); transport(); mount(); await screen.findByText('Selected: Personal')
  expect(localStorage.getItem('fotosinteze.workspace.1')).toBe('7')
})
it('does not let another browser tab change the active request header',async()=>{
  transport(); mount(); await screen.findByText('Selected: Personal')
  localStorage.setItem('fotosinteze.workspace.1','42')
  window.dispatchEvent(new StorageEvent('storage',{key:'fotosinteze.workspace.1',newValue:'42'}))
  expect(screen.getByText('Selected: Personal')).toBeInTheDocument()
  expect(getAccessToken()).toBe(token)
})
it('clears selected workspace and cached data on logout',async()=>{
  transport(); const view=mount(); await screen.findByText('Data: Workspace 7')
  clearSession(); view.change({...auth,status:'unauthenticated',user:null,token:null})
  await waitFor(()=>expect(screen.getByText('Selected: None')).toBeInTheDocument())
  expect(view.client.getQueryCache().findAll({queryKey:['categories',1]})).toHaveLength(0)
})
it('handles an empty membership list and a failed request with retry',async()=>{
  let fail=true
  vi.stubGlobal('fetch',vi.fn(async()=>fail?Response.json({detail:'Unavailable'},{status:503}):Response.json([])))
  mount(); await screen.findByRole('alert'); fail=false; await userEvent.click(screen.getByRole('button',{name:'Retry'})); await screen.findByText('empty')
  expect(screen.getByText('Selected: None')).toBeInTheDocument()
})

it('restores an accessible saved Business workspace after reload',async()=>{
  localStorage.setItem('fotosinteze.workspace.1','42'); transport(); mount()
  await screen.findByText('Selected: Studio'); await screen.findByText('Data: Workspace 42')
})
it('clears the previous account’s cache and selection on account change',async()=>{
  transport();const view=mount();await screen.findByText('Data: Workspace 7')
  const nextToken=`h.${btoa(JSON.stringify({sub:'2',exp:Math.floor(Date.now()/1000)+3600}))}.s`
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    const headers=new Headers(init.headers);expect(headers.get('Authorization')).toBe(`Bearer ${nextToken}`)
    return Response.json(String(url).endsWith('/workspaces')?[{id:9,name:'Second Personal',type:'PERSONAL',role:'OWNER'}]:[{name:'Second account'}])
  }))
  setAccessToken(nextToken);view.change({...auth,user:{id:2,email:'b@test.com',displayName:'B'},token:nextToken})
  await screen.findByText('Selected: Second Personal');await screen.findByText('Data: Second account')
  expect(view.client.getQueryCache().findAll({queryKey:['categories',1]})).toHaveLength(0)
  expect(localStorage.getItem('fotosinteze.workspace.1')).toBeNull()
})

it('keeps an in-flight request bound to its original workspace during token refresh',async()=>{
  const expired=`h.${btoa(JSON.stringify({sub:'1',exp:Math.floor(Date.now()/1000)-10}))}.s`
  setAccessToken(expired)
  const {setWorkspace}=await import('./workspace-state')
  setWorkspace(1,7)
  let resolveRefresh:(response:Response)=>void=()=>{}
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).endsWith('/auth/refresh')) return new Promise<Response>(resolve=>{resolveRefresh=resolve})
    const h=new Headers(init.headers);expect(h.get('X-Workspace-ID')).toBe('7');expect(h.get('Workspace-ID')).toBe('7')
    return Response.json([])
  }))
  const pending=authenticatedFetch('/transactions')
  setWorkspace(1,42);resolveRefresh(Response.json({access_token:token}));await pending
})

it('does not send an old workspace request as another account after a shared-cookie refresh',async()=>{
  const expired=`h.${btoa(JSON.stringify({sub:'1',exp:Math.floor(Date.now()/1000)-10}))}.s`
  const other=`h.${btoa(JSON.stringify({sub:'2',exp:Math.floor(Date.now()/1000)+3600}))}.s`
  setAccessToken(expired)
  const {setWorkspace}=await import('./workspace-state');setWorkspace(1,7)
  let scopedRequests=0
  vi.stubGlobal('fetch',vi.fn(async url=>{
    if(String(url).endsWith('/auth/refresh'))return Response.json({access_token:other})
    scopedRequests++;return Response.json([])
  }))
  const response=await authenticatedFetch('/categories')
  expect(response.status).toBe(401);expect(scopedRequests).toBe(0);expect(getAccessToken()).toBeNull()
})

it('shares token refresh across simultaneous scoped requests without dropping a request',async()=>{
  const expired=`h.${btoa(JSON.stringify({sub:'1',exp:Math.floor(Date.now()/1000)-10}))}.s`
  setAccessToken(expired);const {setWorkspace}=await import('./workspace-state');setWorkspace(1,7)
  let refreshes=0;let requests=0
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    if(String(url).endsWith('/auth/refresh')){refreshes++;await Promise.resolve();return Response.json({access_token:token})}
    requests++;expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);return Response.json([])
  }))
  const responses=await Promise.all([authenticatedFetch('/categories'),authenticatedFetch('/budgets')])
  expect(responses.map(response=>response.status)).toEqual([200,200]);expect(refreshes).toBe(1);expect(requests).toBe(2)
})

it.each(['logout','account change'])('does not retry an old 401 after %s',async change=>{
  const {setWorkspace}=await import('./workspace-state');setWorkspace(1,7)
  let finish:(response:Response)=>void=()=>{};let calls=0
  vi.stubGlobal('fetch',vi.fn(async()=>{calls++;if(calls===1)return new Promise<Response>(resolve=>{finish=resolve});return Response.json({access_token:token})}))
  const pending=authenticatedFetch('/categories')
  if(change==='logout')clearSession()
  else { const other=`h.${btoa(JSON.stringify({sub:'2',exp:Math.floor(Date.now()/1000)+3600}))}.s`;setAccessToken(other);setWorkspace(2,7) }
  finish(Response.json({detail:'Unauthorized'},{status:401}));const response=await pending
  expect(response.status).toBe(401);expect(calls).toBe(1)
})
