import i18n from '@/i18n'
import { finance, financeSources } from './finance'

// Stored validation and API messages stay canonical so they can change language without resetting forms.
export function financeMessage(message: string | undefined, error = false): string {
  if (!message) return ''
  const status = /^The server returned an error \(HTTP (5\d{2})\)\. Please check the backend logs\.$/.exec(message)
  if (status) return String(i18n.t('serverError', { ns: 'finance', status: status[1] }))
  if (message.startsWith('You do not have permission to access or manage accounts in this workspace.')) message = 'You do not have permission to access or manage accounts in this workspace.'
  const key = financeSources[message] ?? Object.keys(finance.en).find(key => finance.lv[key as keyof typeof finance.lv] === message || finance.ru[key as keyof typeof finance.ru] === message)
  if (key) return String(i18n.t(key, { ns: 'finance' }))
  return error ? String(i18n.t('actionFailed', { ns: 'finance' })) : message
}
