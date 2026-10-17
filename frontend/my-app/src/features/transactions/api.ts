import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const id = z.number().int().positive()
const decimal = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number().finite()]).transform(String)
const currency = z.string().regex(/^[A-Z]{3}$/)
const source = z.union([z.enum(['MANUAL', 'BANK', 'EXPENSE']), z.tuple([z.enum(['MANUAL', 'BANK'])])]).transform(value => typeof value === 'string' ? value : value[0])
export const transactionSchema = z.object({
  transaction_id: id, workspace_id: id, amount: decimal.refine(value => Number(value) > 0), currency, description: z.string(), source,
  account_id: id, category_id: id.nullable(), department_id: id.nullable(), project_id: id.nullable(), expense_id: id.nullable(),
  created_at: z.iso.datetime({ local: true, offset: true }), updated_at: z.iso.datetime({ local: true, offset: true }),
})
export type ApiTransaction = z.infer<typeof transactionSchema>
const accountSchema = z.object({ account_id: id, workspace_id: id, name: z.string(), currency, balance: decimal, connection_id: id.nullable().default(null) })
export type TransactionAccount = z.infer<typeof accountSchema>
export type TransactionInput = Pick<ApiTransaction, 'amount' | 'currency' | 'description' | 'account_id' | 'department_id' | 'project_id' | 'expense_id'> & { category_id: number }
const pageSchema = z.object({ items: z.array(transactionSchema), limit: z.number().int().positive(), offset: z.number().int().nonnegative(), has_more: z.boolean() })
const dashboardBase = z.object({ workspace_id: id, currency, period_start: z.iso.date(), period_end: z.iso.date(), expenses: decimal })
const dashboardSchema = z.union([
  dashboardBase.extend({ income: decimal, balance: decimal, savings: decimal, recent_transactions: z.array(transactionSchema) }),
  dashboardBase.extend({ revenue: decimal, profit: decimal, spending_by_category: z.array(z.unknown()), spending_by_department: z.array(z.unknown()), spending_by_project: z.array(z.unknown()) }),
])
export type TransactionDashboard = z.infer<typeof dashboardSchema>

async function request(workspaceId: number, path: string, init: RequestInit = {}) {
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new Error('Cannot reach the server. Check that the backend is running and try again.', { cause: error })
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    throw new Error(await readApiErrorMessage(response))
  }
  return response
}
function parseTransaction(value: unknown, workspaceId: number) {
  const parsed = transactionSchema.safeParse(value)
  if (!parsed.success || parsed.data.workspace_id !== workspaceId) throw new Error('The server returned unexpected transaction data. Please refresh and try again.')
  return parsed.data
}
export async function listTransactions(workspaceId: number, offset: number, signal?: AbortSignal) {
  const parsed = pageSchema.safeParse(await (await request(workspaceId, `/transactions?limit=50&offset=${offset}`, { signal })).json())
  if (!parsed.success || parsed.data.offset !== offset || parsed.data.items.some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned unexpected transaction data. Please refresh and try again.')
  return parsed.data
}
export async function listTransactionAccounts(workspaceId: number, signal?: AbortSignal) {
  const parsed = z.array(accountSchema).safeParse(await (await request(workspaceId, '/accounts', { signal })).json())
  if (!parsed.success || parsed.data.some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned unexpected account data. Please refresh and try again.')
  return parsed.data
}
export async function loadTransactionDashboard(workspaceId: number, signal?: AbortSignal) {
  const parsed = dashboardSchema.safeParse(await (await request(workspaceId, '/dashboard', { signal })).json())
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || ('recent_transactions' in parsed.data && parsed.data.recent_transactions.some(item => item.workspace_id !== workspaceId))) throw new Error('The server returned unexpected dashboard data. Please refresh and try again.')
  return parsed.data
}
export async function saveTransaction(workspaceId: number, input: TransactionInput, transactionId?: number) {
  const response = await request(workspaceId, transactionId === undefined ? '/transactions' : `/transactions/${transactionId}`, { method: transactionId === undefined ? 'POST' : 'PUT', body: JSON.stringify(input) })
  return parseTransaction(await response.json(), workspaceId)
}
