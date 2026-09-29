type FormAlertProps = {
  message: string
}

function FormAlert({ message }: FormAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </div>
  )
}

export { FormAlert }
