import { z } from 'zod'
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
const targetSchema = z.array(z.object({ id: z.number().int().positive(), name: z.string() }))
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
