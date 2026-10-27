import { useTranslation } from 'react-i18next'
import { adminKeys } from './admin'

export function useAdminTranslation() {
  const { t } = useTranslation('admin')
  function tr(source: string | undefined, values: Record<string, string | number> = {}) {
    if (!source) return ''
    const key = adminKeys[source]
    return key ? t(key, values) : source
  }
  function trError(source: string | undefined) {
    if (!source) return ''
    const status = /^The server returned an error \(HTTP (5\d{2})\)\. Please check the backend logs\.$/.exec(source)
    if (status) return tr('The server returned an error (HTTP {{status}}). Please try again.', { status: status[1] })
    const patterns = [
      ['Your account cannot access workspace {{id}}. Use an existing workspace owned by or shared with your account.', /^Your account cannot access workspace (\d+)\. Use an existing workspace owned by or shared with your account\.$/],
      ['Your account cannot access workspace {{id}}. Choose an accessible Business workspace from the workspace switcher.', /^Your account cannot access workspace (\d+)\. Choose an accessible Business workspace from the workspace switcher\.$/],
      ['Workspace {{id}} is a Personal workspace. Projects require a Business workspace.', /^Workspace (\d+) is a Personal workspace\. Projects require a Business workspace\.$/],
      ['Workspace {{id}} is Personal. Connect a real Business workspace here.', /^Workspace (\d+) is Personal\. Connect a real Business workspace here\.$/],
    ] as const
    for (const [text, pattern] of patterns) {
      const match = pattern.exec(source)
      if (match) return tr(text, { id: match[1] })
    }
    return tr(adminKeys[source] ? source : 'Something went wrong. Please try again.')
  }
  return { tr, trError }
}
