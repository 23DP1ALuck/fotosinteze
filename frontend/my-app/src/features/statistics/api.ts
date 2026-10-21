import { z } from 'zod'
import { authenticatedFetch } from '@/features/auth/authenticated-fetch'
import { readApiErrorMessage } from '@/features/auth/api-error'

export type DateRange = { from: string; to: string }
const day = z.iso.date()
const amount = z.union([z.string().regex(/^\d+(\.\d+)?$/), z.number().nonnegative()]).transform(Number).refine(Number.isFinite)
const base = z.object({ workspace_id: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/), date_from: day, date_to: day })
const summary = base.extend({ income: amount, expenses: amount })
const categories = base.extend({ items: z.array(z.object({ id: z.number().int().positive().nullable(), name: z.string(), amount })) })
const timeseries = base.extend({ items: z.array(z.object({ date: day, amount })) })
const schemas = { summary, categories, timeseries }
export type MetricKind = keyof typeof schemas
export type Metrics = { [K in MetricKind]: z.infer<(typeof schemas)[K]> }
export function rangeError(range: DateRange) {
  if (!day.safeParse(range.from).success || !day.safeParse(range.to).success) return 'Choose valid start and end dates.'
  if (range.from > range.to) return 'Start date must be on or before end date.'
  if ((Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1 > 3660) return 'Choose a range of 3660 days or fewer.'
  return ''
}
export function currentMonth(): DateRange {
  const today = new Date()
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: format(new Date(today.getFullYear(), today.getMonth(), 1)), to: format(new Date(today.getFullYear(), today.getMonth() + 1, 0)) }
}
export async function loadMetric<K extends MetricKind>(kind: K, workspaceId: number, range: DateRange, signal?: AbortSignal): Promise<Metrics[K]> {
  const error = rangeError(range)
  if (error) throw new Error(error)
  const params = new URLSearchParams({ date_from: range.from, date_to: range.to })
  let response: Response
  try { response = await authenticatedFetch(`/statistics/${kind}?${params}`, { signal }, { workspaceId }) }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Cannot reach the server. Please try again.', { cause: error })
  }
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Please log in again.' : await readApiErrorMessage(response))
  const parsed = schemas[kind].safeParse(await response.json())
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || parsed.data.date_from !== range.from || parsed.data.date_to !== range.to || (kind === 'timeseries' && 'items' in parsed.data && parsed.data.items.some(item => 'date' in item && (item.date < range.from || item.date > range.to)))) throw new Error('The server returned unexpected statistics data. Please retry.')
  return parsed.data as Metrics[K]
}
