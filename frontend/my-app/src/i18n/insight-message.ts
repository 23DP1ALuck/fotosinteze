import i18n from '@/i18n'
import { insightRows } from './insights'
const keys = new Map(Object.entries(insightRows).map(([key, values]) => [values[0], key]))
export function insightMessage(message: string): string {
  const key = keys.get(message)
  return key ? i18n.t(key, { ns: 'insights' }) : message
}
export function insightError(message: string): string {
  return keys.has(message) ? insightMessage(message) : i18n.t('error', { ns: 'insights' })
}
