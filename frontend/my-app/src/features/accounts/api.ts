import { getLocale } from '@/i18n'
import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

const id = z.number().int().positive()
export const accountSchema = z.object({
  account_id: id, workspace_id: id, name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/),
  balance: z.union([z.string().regex(/^[+-]?\d+(\.\d+)?$/), z.number().finite()]).transform(String),
  connection_id: id.nullable().default(null), banking_connection_id: id.nullable().default(null), is_main: z.boolean().optional(),
})
export type ApiAccount = z.infer<typeof accountSchema>
export type AccountCreate = { name: string; currency: string; balance: string }
export type AccountUpdate = { name?: string; balance?: string; is_main?: boolean }

export class AccountRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.name = 'AccountRequestError'; this.status = status }
}

async function request(workspaceId: number, path: string, init: RequestInit = {}) {
  let response: Response
  try { response = await authenticatedFetch(path, init, { workspaceId }) }
  catch (error) {
    if (init.signal?.aborted) throw error
    throw new Error('Cannot reach the server. Check your connection and try again.', { cause: error })
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    if (response.status === 403) throw new Error(`You do not have permission to access or manage accounts in this workspace. ${await readApiErrorMessage(response)}`)
    if (response.status === 404) throw new Error('This account is no longer available in the selected workspace. Close its details and refresh accounts.')
    throw new AccountRequestError(await readApiErrorMessage(response), response.status)
  }
  return response
}
function parseAccount(value: unknown, workspaceId: number, accountId?: number) {
  const parsed = accountSchema.safeParse(value)
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || (accountId !== undefined && parsed.data.account_id !== accountId)) throw new Error('The server returned unexpected account data. Please refresh and try again.')
  return parsed.data
}
export async function listAccounts(workspaceId: number, signal?: AbortSignal): Promise<ApiAccount[]> {
  const parsed = z.array(accountSchema).safeParse(await (await request(workspaceId, '/accounts', { signal })).json())
  if (!parsed.success || parsed.data.some(item => item.workspace_id !== workspaceId)) throw new Error('The server returned unexpected account data. Please refresh and try again.')
  return parsed.data
}
export async function createAccount(workspaceId: number, input: AccountCreate, signal?: AbortSignal) {
  return parseAccount(await (await request(workspaceId, '/accounts', { method: 'POST', body: JSON.stringify(input), signal })).json(), workspaceId)
}
export async function getAccount(workspaceId: number, accountId: number, signal?: AbortSignal) {
  return parseAccount(await (await request(workspaceId, `/accounts/${accountId}`, { signal })).json(), workspaceId, accountId)
}
export async function updateAccount(workspaceId: number, accountId: number, input: AccountUpdate, signal?: AbortSignal) {
  return parseAccount(await (await request(workspaceId, `/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify(input), signal })).json(), workspaceId, accountId)
}
export function formatAccountBalance(account: ApiAccount) {
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: account.currency }).format(Number(account.balance))
}

export async function deleteAccount(workspaceId: number, accountId: number, signal?: AbortSignal) {
  await request(workspaceId, `/accounts/${accountId}`, { method: 'DELETE', signal })
}
