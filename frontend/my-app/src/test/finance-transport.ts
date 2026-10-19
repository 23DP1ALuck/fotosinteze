// An in-memory HTTP boundary for tests that render the real transaction UI.
export function createFinanceTransport() {
  type Row = { transaction_id: number; workspace_id: number; amount: string; currency: string; description: string; source: string | string[]; account_id: number; category_id: number | null; department_id: number | null; project_id: number | null; expense_id: number | null; created_at: string; updated_at: string }
  const personal: Row[] = [
    { transaction_id: 1, description: 'Monthly salary', amount: '3200.00', category_id: 3, source: ['MANUAL'] },
    { transaction_id: 2, description: 'Rimi', amount: '28.54', category_id: 4, source: ['BANK'] },
    { transaction_id: 3, description: 'Spotify Premium', amount: '10.99', category_id: 7, source: ['BANK'] },
  ].map(item => ({ ...item, workspace_id: 7, currency: 'EUR', account_id: 12, department_id: null, project_id: null, expense_id: null, created_at: '2026-10-17T12:00:00', updated_at: '2026-10-17T12:00:00' }))
  const rows = new Map<number, Row[]>([[7, personal]])
  const changes = new Map<number, { income: number; expenses: number; balance: number }>()
  let nextId = 100
  const state = { failSave: false, emptyAccounts: false, emptyCategories: false }
  function categories(workspaceId: number) {
    return [{ category_id: 3, name: 'Salary', type: 'INCOME' }, { category_id: 4, name: 'Groceries', type: 'EXPENSE' }, { category_id: 5, name: 'Marketing', type: 'EXPENSE' }, { category_id: 6, name: 'Services', type: 'INCOME' }, { category_id: 7, name: 'Subscriptions', type: 'EXPENSE' }].map(item => ({ ...item, workspace_id: workspaceId }))
  }
  function respond(input: RequestInfo | URL, init?: RequestInit): Response | undefined {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace(/^\/api/, '')
    const workspaceId = Number(new Headers(init?.headers).get('X-Workspace-ID'))
    const business = workspaceId !== 7
    const accountId = business ? 13 : 12
    const method = init?.method || 'GET'
    const list = rows.get(workspaceId) ?? []
    const delta = changes.get(workspaceId) ?? { income: 0, expenses: 0, balance: 0 }
    const income = (business ? 0 : 3200) + delta.income
    const expenses = (business ? 0 : 1842.35) + delta.expenses
    const balance = (business ? 0 : 4820.5) + delta.balance
    if (path === '/accounts') return Response.json(state.emptyAccounts ? [] : [{ account_id: accountId, name: 'Main account', currency: 'EUR', balance: balance.toFixed(2), workspace_id: workspaceId, connection_id: null }])
    if (path === '/categories') return Response.json(state.emptyCategories ? [] : categories(workspaceId))
    if (path === '/dashboard') return Response.json({ workspace_id: workspaceId, currency: 'EUR', period_start: '2026-10-01', period_end: '2026-11-01', expenses: expenses.toFixed(2), ...(business ? { revenue: income.toFixed(2), profit: (income - expenses).toFixed(2), spending_by_category: [], spending_by_department: [], spending_by_project: [] } : { income: income.toFixed(2), savings: (income - expenses).toFixed(2), balance: balance.toFixed(2), recent_transactions: list.slice(0, 10) }) })
    if (path === '/transactions' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') || 0)
      const filtered = list.filter(row => {
        const category = categories(workspaceId).find(item => item.category_id === row.category_id)
        return row.description.toLowerCase().includes((url.searchParams.get('search') || '').trim().toLowerCase()) &&
          (!url.searchParams.has('type') || category?.type === url.searchParams.get('type')) &&
          (!url.searchParams.has('source') || (Array.isArray(row.source) ? row.source[0] : row.source) === url.searchParams.get('source')) &&
          (['category_id', 'department_id', 'project_id'] as const).every(key => !url.searchParams.has(key) || row[key] === Number(url.searchParams.get(key)))
      })
      return Response.json({ items: filtered.slice(offset, offset + 50), offset, limit: 50, has_more: filtered.length > offset + 50 })
    }
    if (/^\/transactions\/\d+$/.test(path) && method === 'DELETE') {
      if (state.failSave) return Response.json({ detail: 'No access to this transaction' }, { status: 403 })
      const old = list.find(item => item.transaction_id === Number(path.split('/').at(-1)))
      if (!old) return Response.json({ detail: 'Transaction not found' }, { status: 404 })
      const wasIncome = categories(workspaceId).find(item => item.category_id === old.category_id)?.type === 'INCOME'
      delta[wasIncome ? 'income' : 'expenses'] -= Number(old.amount)
      delta.balance -= (wasIncome ? 1 : -1) * Number(old.amount)
      changes.set(workspaceId, delta)
      rows.set(workspaceId, list.filter(item => item !== old))
      return new Response(null, { status: 204 })
    }
    if ((path === '/transactions' && method === 'POST') || (/^\/transactions\/\d+$/.test(path) && method === 'PUT')) {
      if (state.failSave) return Response.json({ detail: 'Account not found' }, { status: 404 })
      const body = JSON.parse(String(init?.body))
      if (!body.description?.trim()) return Response.json({ detail: 'Description must not be empty' }, { status: 400 })
      const id = method === 'PUT' ? Number(path.split('/').at(-1)) : nextId++
      const old = list.find(item => item.transaction_id === id)
      const categoryRows = categories(workspaceId)
      const oldIncome = categoryRows.find(item => item.category_id === old?.category_id)?.type === 'INCOME'
      const newIncome = categoryRows.find(item => item.category_id === body.category_id)?.type === 'INCOME'
      if (old) { delta[oldIncome ? 'income' : 'expenses'] -= Number(old.amount); delta.balance -= (oldIncome ? 1 : -1) * Number(old.amount) }
      delta[newIncome ? 'income' : 'expenses'] += Number(body.amount)
      delta.balance += (newIncome ? 1 : -1) * Number(body.amount)
      changes.set(workspaceId, delta)
      const row: Row = { ...body, transaction_id: id, workspace_id: workspaceId, source: ['MANUAL'], created_at: old?.created_at ?? '2026-10-17T13:00:00', updated_at: '2026-10-17T13:00:00' }
      rows.set(workspaceId, [row, ...list.filter(item => item.transaction_id !== id)])
      return Response.json(row, { status: method === 'POST' ? 201 : 200 })
    }
    return undefined
  }
  return { respond, state }
}
