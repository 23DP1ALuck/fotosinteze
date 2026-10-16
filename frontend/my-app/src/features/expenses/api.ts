import { z } from 'zod'
import type { Category } from '@/features/categories/types'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const expenseSchema = z.object({
  id: z.number().int().positive(), workspace_id: z.number().int().positive(), submitted_by: z.number().int().positive(),
  reviewed_by: z.number().int().positive().nullable(), amount: z.coerce.number().positive(),
  currency: z.string().length(3), description: z.string(), receipt_url: z.string().nullable(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  category_id: z.number().int().positive(), department_id: z.number().int().positive().nullable(),
  project_id: z.number().int().positive().nullable(), created_at: z.string(), updated_at: z.string(), reviewed_at: z.string().nullable(),
})
export type ExpenseRequest = z.infer<typeof expenseSchema>
export type ExpenseInput = { amount: number; currency: string; description: string; category_id: number; department_id?: number; project_id?: number; receipt_url?: string }
const accountSchema = z.object({ account_id: z.number().int().positive(), name: z.string(), currency: z.string().length(3), balance: z.coerce.number(), workspace_id: z.number().int().positive(), connection_id: z.number().int().positive().nullable() })
export type ExpenseAccount = z.infer<typeof accountSchema>

async function request(workspaceId: number, path: string, init: RequestInit = {}): Promise<Response> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) throw new Error('Enter a valid workspace ID.')
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch { throw new Error('Cannot reach the server. Check that the backend is running and try again.') }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    throw new Error(await readApiErrorMessage(response))
  }
  return response
}
function parseExpense(value: unknown, workspaceId: number): ExpenseRequest {
  const result = expenseSchema.safeParse(value)
  if (!result.success || result.data.workspace_id !== workspaceId) throw new Error('The server returned unexpected expense request data. Please retry.')
  return result.data
}
export async function listExpenseRequests(workspaceId: number, signal?: AbortSignal): Promise<ExpenseRequest[]> {
  const rows: unknown = await (await request(workspaceId, '/expenses', { method: 'GET', signal })).json()
  if (!Array.isArray(rows)) throw new Error('The server returned unexpected expense request data. Please retry.')
  return rows.map(row => parseExpense(row, workspaceId))
}
export async function createExpenseRequest(workspaceId: number, input: ExpenseInput): Promise<ExpenseRequest> {
  const row: unknown = await (await request(workspaceId, '/expenses', { method: 'POST', body: JSON.stringify(input) })).json()
  return parseExpense(row, workspaceId)
}
export async function listExpenseAccounts(workspaceId: number, signal?: AbortSignal): Promise<ExpenseAccount[]> {
  const rows: unknown = await (await request(workspaceId, '/accounts', { method: 'GET', signal })).json()
  const result = z.array(accountSchema).safeParse(rows)
  if (!result.success || result.data.some(row => row.workspace_id !== workspaceId)) throw new Error('The server returned unexpected account data. Please retry.')
  return result.data
}
export async function decideExpenseRequest(workspaceId: number, id: number, decision: 'approve' | 'reject', accountId?: number): Promise<ExpenseRequest> {
  const row: unknown = await (await request(workspaceId, `/expenses/${id}/review`, {
    method: 'POST', body: JSON.stringify({ approve: decision === 'approve', ...(decision === 'approve' && accountId !== undefined ? { account_id: accountId } : {}) }),
  })).json()
  return parseExpense(row, workspaceId)
}

export async function listExpenseCategories(workspaceId: number, signal?: AbortSignal): Promise<Category[]> {
  const schema = z.array(z.object({ category_id: z.number().int().positive(), workspace_id: z.number().int().positive(), name: z.string(), type: z.literal('EXPENSE') }))
  const result = schema.safeParse(await (await request(workspaceId, '/expenses/categories', { signal })).json())
  if (!result.success || result.data.some(row => row.workspace_id !== workspaceId)) throw new Error('The server returned unexpected expense categories. Please retry.')
  return result.data.map(row => ({ id: row.category_id, workspaceId: row.workspace_id, name: row.name, type: 'expense' }))
}
