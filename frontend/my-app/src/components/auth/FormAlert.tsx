import { useTranslation } from 'react-i18next'
import { pageError } from '@/i18n/pages'
type FormAlertProps = {
  message: string
}

function FormAlert({ message }: FormAlertProps) {
  const { t } = useTranslation('pages')
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {pageError(message, t)}
    </div>
  )
}

export { FormAlert }
