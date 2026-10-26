import { render } from '@/test/render'
import { useEffect, useState } from 'react'
import { cleanup, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setAccessToken, clearSession } from '@/features/auth/storage'
import { ProjectManager, ProjectFields } from './ProjectManager'
import { setWorkspace } from '@/features/workspaces/workspace-state'
import { useProjectCatalog } from './use-project-catalog'

beforeEach(() => {
  setAccessToken(`header.${btoa(JSON.stringify({ sub: '1', exp: Date.now()/1000+3600 }))}.signature`)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
})
afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals() })
const project = { id: 10, workspace_id: 42, name: 'Website', status: 'Active', department_ids: [7,8], start_date: '2026-09-01T00:00:00', end_date: null }
const departments = [{ id: 7, workspace_id: 42, name: 'Development' }, { id: 8, workspace_id: 42, name: 'Marketing' }]
function Harness({ id = 42, owner = true }: { id?: number; owner?: boolean }) {
  const catalog = useProjectCatalog(id, true)
  useEffect(() => { setWorkspace(1, id) }, [id])
  const [departmentId, setDepartment] = useState('')
  const [projectId, setProject] = useState('')
  return <><ProjectManager catalog={catalog} canManage={owner} canCreate={owner || catalog.departments.length > 0} /><form aria-label="Business transaction"><ProjectFields catalog={catalog} departmentId={departmentId} projectId={projectId} onDepartmentChange={setDepartment} onProjectChange={setProject} /></form></>
}
it('creates, edits and deletes real projects with multiple departments and ISO dates', async () => {
  let rows = [project]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/members')) return Response.json([])
    expect(new Headers(init.headers).get('Workspace-ID')).toBe('42')
    expect(new Headers(init.headers).get('Authorization')).toMatch(/^Bearer /)
    if (String(url).endsWith('/members')) return Response.json([])
    if (url === '/api/departments') return Response.json(departments)
    if (init.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ name: 'Launch', status: 'Planned', department_ids: [7,8], start_date: '2026-10-01T00:00:00', end_date: null })
      const next = { ...project, id: 11, ...JSON.parse(String(init.body)) }
      rows = [...rows, next]
      return Response.json(next, { status: 201 })
    }
    if (init.method === 'PUT') {
      expect(url).toBe('/api/projects/11')
      const body = JSON.parse(String(init.body))
      expect(body.department_ids).toEqual([])
      rows = rows.map(row => row.id === 11 ? { ...row, ...body } : row)
      return Response.json(rows[1])
    }
    if (init.method === 'DELETE') { rows = rows.filter(row => row.id !== 11); return Response.json(null) }
    return Response.json(rows)
  }))
  const user = userEvent.setup()
  render(<Harness />)
  await screen.findByRole('button', { name: 'Edit Website' })
  await user.click(screen.getByRole('button', { name: 'Add project' }))
  let dialog = within(screen.getByRole('dialog'))
  await user.type(dialog.getByLabelText('Project name'), 'Launch')
  await user.click(dialog.getByLabelText('Development'))
  await user.click(dialog.getByLabelText('Marketing'))
  await user.click(dialog.getByLabelText('Start date'))
  await user.click(await screen.findByRole('button', { name: '1 October 2026' }))
  await user.click(await screen.findByRole('button', { name: 'Close calendar' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose date' })).not.toBeInTheDocument())
  await user.click(dialog.getByRole('button', { name: 'Add project' }))
  await screen.findByRole('button', { name: 'Edit Launch' })
  await user.click(screen.getByRole('button', { name: 'Edit Launch' }))
  dialog = within(screen.getByRole('dialog'))
  await user.click(dialog.getByLabelText('Development'))
  await user.click(dialog.getByLabelText('Marketing'))
  await user.click(dialog.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('list', { name: 'Projects' })).toHaveTextContent('Workspace-wide project')
  await user.click(screen.getByRole('button', { name: 'Delete Launch' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Launch' })).not.toBeInTheDocument())
})
it('filters selectors by department and clears an incompatible selected project', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/members') ? [] : String(url).endsWith('/departments') ? departments : [project, { ...project, id: 12, name: 'Sales plan', department_ids: [8] }, { ...project, id: 13, name: 'Workspace plan', department_ids: [] }])))
  const user = userEvent.setup()
  render(<Harness />)
  await screen.findByRole('button', { name: 'Edit Website' })
  const form = within(screen.getByRole('form', { name: 'Business transaction' }))
  await user.selectOptions(form.getByLabelText('Project'), '12')
  await user.selectOptions(form.getByLabelText('Department'), '7')
  expect(form.getByLabelText('Project')).toHaveValue('')
  expect(form.queryByRole('option', { name: 'Sales plan' })).not.toBeInTheDocument()
  expect(form.getByRole('option', { name: 'Workspace plan' })).toBeInTheDocument()
})
it('shows mutation errors without removing the project and hides management for non-owners', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => init.method === 'DELETE' ? Response.json({ detail: 'Workspace owner required' }, { status: 403 }) : Response.json(String(url).endsWith('/members') ? [] : String(url).endsWith('/departments') ? departments : [project])))
  const user = userEvent.setup()
  const { rerender } = render(<Harness />)
  await screen.findByRole('button', { name: 'Delete Website' })
  await user.click(screen.getByRole('button', { name: 'Delete Website' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace owner required')
  expect(screen.getByRole('list', { name: 'Projects' })).toHaveTextContent('Website')
  rerender(<Harness owner={false} />)
  expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Website' })).not.toBeInTheDocument()
})
it('clears previous workspace projects immediately and ignores stale responses', async () => {
  let resolveOld: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const id = new Headers(init.headers).get('Workspace-ID')
    if (String(url).endsWith('/departments')) return Response.json([])
    if (id === '42') return new Promise<Response>(resolve => { resolveOld = resolve })
    return Response.json([{ ...project, workspace_id: 43, name: 'Other workspace', department_ids: [] }])
  }))
  const { rerender } = render(<Harness />)
  rerender(<Harness id={43} />)
  await screen.findByRole('button', { name: 'Edit Other workspace' })
  resolveOld(Response.json([project]))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Website' })).not.toBeInTheDocument())
})

it('uses the workspace switcher instead of asking for a manual workspace ID', () => {
  render(<ProjectManager catalog={{ workspaceId: undefined, projects: [], departments: [], loading: false, error: '', refresh() {}, upsert() {}, remove() {} }} canManage />)
  expect(screen.queryByLabelText('Workspace ID')).not.toBeInTheDocument()
  expect(screen.getByText(/Choose a Business workspace from the workspace switcher/)).toBeInTheDocument()
})

it('includes workspace-wide projects in department filters and supports filtering them separately', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/members') ? [] : String(url).endsWith('/departments') ? departments : [project, { ...project, id: 12, name: 'Sales plan', department_ids: [8] }, { ...project, id: 13, name: 'Workspace plan', department_ids: [] }])))
  render(<Harness />)
  await screen.findByRole('button', { name: 'Edit Workspace plan' })
  await userEvent.selectOptions(screen.getByLabelText('Filter projects by department'), '7')
  const list = within(screen.getByRole('list', { name: 'Projects' }))
  expect(list.getByText('Website')).toBeInTheDocument()
  expect(list.getByText('Workspace plan')).toBeInTheDocument()
  expect(list.queryByText('Sales plan')).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Filter projects by department'), 'workspace')
  expect(list.getByText('Workspace plan')).toBeInTheDocument()
  expect(list.queryByText('Website')).not.toBeInTheDocument()
})

it('clears a project selector when the selected project is removed by a catalog refresh', async () => {
  let available = [project]
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/members') ? [] : String(url).endsWith('/departments') ? departments : available)))
  render(<Harness />)
  await screen.findByRole('button', { name: 'Edit Website' })
  const form = within(screen.getByRole('form', { name: 'Business transaction' }))
  await userEvent.selectOptions(form.getByLabelText('Project'), '10')
  available = []
  await userEvent.click(screen.getByRole('button', { name: 'Refresh projects' }))
  await waitFor(() => expect(form.getByLabelText('Project')).toHaveValue(''))
  expect(form.queryByRole('option', { name: 'Website' })).not.toBeInTheDocument()
})

it('shares owner projects through departments without requesting a member catalog', async () => {
  let saved: unknown
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/members')) return Response.json({ detail: 'Members unavailable' }, { status: 503 })
    if (String(url).endsWith('/departments')) return Response.json(departments)
    if (init.method === 'POST') { saved = JSON.parse(String(init.body)); return Response.json({ ...project, ...saved as object, id: 11 }) }
    return Response.json([project])
  }))
  render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add project' }))
  const form = within(screen.getByRole('dialog'))
  await userEvent.type(form.getByLabelText('Project name'), 'Shared launch')
  await userEvent.click(form.getByLabelText('Development'))
  await userEvent.click(form.getByLabelText('Marketing'))
  expect(form.queryByText('Assigned employees')).not.toBeInTheDocument()
  expect(form.getAllByRole('checkbox')).toHaveLength(2)
  await userEvent.click(form.getByRole('button', { name: 'Add project' }))
  await waitFor(() => expect(saved).toMatchObject({ name: 'Shared launch', department_ids: [7,8] }))
  expect(saved).not.toHaveProperty('employee_ids')
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/members'))).toBe(false)
})

it('lets employees edit department project details without member requests, links or deletion', async () => {
  let saved: unknown
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(String(url)).not.toContain('/members')
    if (String(url).endsWith('/departments')) return Response.json(departments.slice(0,1))
    if (init.method === 'PUT') { saved = JSON.parse(String(init.body)); return Response.json({ ...project, ...saved as object }) }
    return Response.json([project])
  }))
  render(<Harness owner={false} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Website' }))
  const form = within(screen.getByRole('dialog'))
  expect(form.queryByText('Departments · optional')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Website' })).not.toBeInTheDocument()
  await userEvent.clear(form.getByLabelText('Project name'))
  await userEvent.type(form.getByLabelText('Project name'), 'Updated')
  await userEvent.click(form.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(saved).toMatchObject({ name: 'Updated' }))
  expect(saved).not.toHaveProperty('department_ids')
  expect(saved).not.toHaveProperty('employee_ids')
})

it('allows employees with a department to create project details using their own department', async () => {
  let saved: unknown
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(String(url)).not.toContain('/members')
    if (String(url).endsWith('/departments')) return Response.json(departments.slice(0,1))
    if (init.method === 'POST') { saved = JSON.parse(String(init.body)); return Response.json({ ...project, ...saved as object }) }
    return Response.json([])
  }))
  render(<Harness owner={false} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add project' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Add project' }))
  const form = within(screen.getByRole('dialog'))
  await userEvent.type(form.getByLabelText('Project name'), 'My project')
  await userEvent.click(form.getByRole('button', { name: 'Add project' }))
  await waitFor(() => expect(saved).toMatchObject({ name: 'My project' }))
  expect(saved).not.toHaveProperty('department_ids')
  expect(saved).not.toHaveProperty('employee_ids')
})

it('closes an owner deletion dialog when workspace ownership is lost', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/members') ? [] : String(url).endsWith('/departments') ? departments : [project])))
  const view = render(<Harness />)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Website' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  view.rerender(<Harness owner={false} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Website' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit Website' })).toBeInTheDocument()
})
