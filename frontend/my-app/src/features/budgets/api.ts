import { z } from 'zod'
import { listCategories } from '@/features/categories/api'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

export const targetTypes = ['CATEGORY', 'DEPARTMENT', 'PROJECT'] as const
export type TargetType = typeof targetTypes[number]
const budgetSchema = z.object({
  id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string(),
  target_type: z.enum(targetTypes), target_id: z.number().int().positive(), target_name: z.string(),
  limit_amount: z.coerce.number().positive(), currency: z.string().length(3), period_start: z.string(), period_end: z.string(),
  period_length: z.enum(['MONTHLY', 'WEEKLY', 'CUSTOM']), duration_days: z.number().nullable(),
  spent: z.coerce.number(), remaining: z.coerce.number(), status: z.enum(['ON_TRACK', 'WARNING', 'EXCEEDED']),
})
const targetSchema = z.array(z.object({ id: z.number().int().positive(), name: z.string(), icon: z.string().nullable().optional() }))
const catalogSchema = z.object({ workspace_id: z.number().int().positive(), can_manage: z.boolean(), progress_scope: z.enum(['WORKSPACE', 'ASSIGNED_DEPARTMENT']), budgets: z.array(budgetSchema), targets: z.object({ CATEGORY: targetSchema.optional(), DEPARTMENT: targetSchema.optional(), PROJECT: targetSchema.optional() }) })
export type BusinessBudget = z.infer<typeof budgetSchema>
export type BudgetCatalog = z.infer<typeof catalogSchema>
export type BudgetInput = Pick<BusinessBudget, 'name' | 'target_type' | 'target_id' | 'currency' | 'period_start' | 'period_length' | 'duration_days'> & { limit_amount: string }
async function request(workspaceId: number, path = '', init: RequestInit = {}) {
  const response = await authenticatedFetch(`/business-budgets${path}`, init, { workspaceId })
  if (!response.ok) throw new Error(await readApiErrorMessage(response))
  return response
}
export async function loadBusinessBudgets(workspaceId: number, signal?: AbortSignal) {
  const data = catalogSchema.parse(await (await request(workspaceId, '', { signal })).json())
  if (data.workspace_id !== workspaceId || data.budgets.some(row => row.workspace_id !== workspaceId)) throw new Error('Unexpected budget workspace. Please retry.')
  return data
}
export async function saveBusinessBudget(workspaceId: number, input: BudgetInput, id?: number) {
  const row = budgetSchema.parse(await (await request(workspaceId, id === undefined ? '' : `/${id}`, { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(input) })).json())
  if (row.workspace_id !== workspaceId) throw new Error('Unexpected budget workspace. Please retry.')
  return row
}
export async function deleteBusinessBudget(workspaceId: number, id: number) {
  await request(workspaceId, `/${id}`, { method: 'DELETE' })
}

const personalBudgetSchema = z.object({
  budget_id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string(),
  category_id: z.number().int().positive().nullable(), limit_amount: z.coerce.number().positive(),
  currency: z.string().length(3), current_spent: z.coerce.number(), period_start: z.string(),
  period_length: z.enum(['MONTHLY', 'WEEKLY', 'CUSTOM']), duration_days: z.number().nullable(),
})
async function personalRequest(workspaceId: number, path = '', init: RequestInit = {}) {
  const response = await authenticatedFetch(`/budgets${path}`, init, { workspaceId })
  if (!response.ok) throw new Error(await readApiErrorMessage(response))
  return response
}
function personalBudget(value: unknown, workspaceId: number, categories: { id: number; name: string }[]): BusinessBudget {
  const row = personalBudgetSchema.parse(value)
  if (row.workspace_id !== workspaceId) throw new Error('Unexpected budget workspace. Please retry.')
  const end = new Date(`${row.period_start}T00:00:00Z`)
  if (row.period_length === 'MONTHLY') end.setUTCMonth(end.getUTCMonth() + 1, 1)
  else end.setUTCDate(end.getUTCDate() + (row.period_length === 'WEEKLY' ? 7 : row.duration_days!))
  return { ...row, id: row.budget_id, target_type: 'CATEGORY', target_id: row.category_id ?? 0,
    target_name: categories.find(category => category.id === row.category_id)?.name ?? 'All expense categories',
    period_end: end.toISOString().slice(0, 10), spent: row.current_spent, remaining: row.limit_amount - row.current_spent,
    status: row.current_spent > row.limit_amount ? 'EXCEEDED' : row.current_spent >= row.limit_amount * 0.8 ? 'WARNING' : 'ON_TRACK' }
}
export async function loadPersonalBudgets(workspaceId: number, signal?: AbortSignal): Promise<BudgetCatalog> {
  const [response, categories] = await Promise.all([personalRequest(workspaceId, '', { signal }), listCategories(workspaceId, signal)])
  const targets = categories.filter(category => category.type === 'expense')
  const rows = z.array(z.unknown()).parse(await response.json())
  return { workspace_id: workspaceId, can_manage: true, progress_scope: 'WORKSPACE',
    targets: { CATEGORY: targets }, budgets: rows.map(row => personalBudget(row, workspaceId, categories)) }
}
export async function savePersonalBudget(workspaceId: number, input: BudgetInput, id?: number, categories: { id: number; name: string }[] = []) {
  const { name, limit_amount, currency, period_start, period_length, duration_days, target_id } = input
  const response = await personalRequest(workspaceId, id === undefined ? '' : `/${id}`, {
    method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify({ name, limit_amount, currency, period_start, period_length, duration_days, category_id: target_id }),
  })
  return personalBudget(await response.json(), workspaceId, categories)
}
export async function deletePersonalBudget(workspaceId: number, id: number) {
  await personalRequest(workspaceId, `/${id}`, { method: 'DELETE' })
}
