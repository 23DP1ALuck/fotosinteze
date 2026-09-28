const LOGIN_FAILURE_MESSAGE = 'Invalid email or password.'

const DETAIL_MESSAGES: Record<string, string> = {
  'User already exists': 'An account with this email or name already exists.',
  Unauthorized: LOGIN_FAILURE_MESSAGE,
  'Incorrect password': LOGIN_FAILURE_MESSAGE,
  'User not found': LOGIN_FAILURE_MESSAGE,
  'Invalid credentials': LOGIN_FAILURE_MESSAGE,
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (
      body &&
      typeof body === 'object' &&
      'detail' in body &&
      typeof (body as { detail: unknown }).detail === 'string'
    ) {
      const detail = (body as { detail: string }).detail
      return DETAIL_MESSAGES[detail] ?? detail
    }

    if (
      body &&
      typeof body === 'object' &&
      'detail' in body &&
      Array.isArray((body as { detail: unknown }).detail)
    ) {
      const items = (body as { detail: { msg?: string }[] }).detail
      const messages = items
        .map((item) => item.msg)
        .filter((msg): msg is string => Boolean(msg))
      if (messages.length > 0) {
        return messages.join(' ')
      }
    }
  } catch {
    // fall through
  }

  if (response.status === 401) {
    return LOGIN_FAILURE_MESSAGE
  }

  return 'Something went wrong. Please try again.'
}
