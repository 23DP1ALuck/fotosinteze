import { pageText } from '@/i18n/pages'
import { useTranslation } from 'react-i18next'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { AuthBackLink, AuthShell } from '@/components/auth/AuthShell'
import { FormAlert } from '@/components/auth/FormAlert'
import { PasswordField } from '@/components/auth/PasswordField'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/use-auth'
import { ApiError } from '@/features/auth/api'
import { loginSchema, type LoginFormValues } from '@/features/auth/schemas'
import { cn } from '@/lib/utils'

function LoginPage() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register, trigger,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await login(values.email, values.password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/' ? from : '/app', { replace: true })
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
      )
    }
  })

  return (
    <AuthShell headline={t('slowAndSteadyWinsTheRace')}>
      <AuthBackLink />
      <div className="space-y-2 text-left">
        <h2 className="text-3xl font-semibold tracking-tight text-[#1a2e2a]">
          {t('welcomeBack')}
        </h2>
        <p className="text-[#526259]">{t('logInToPickUpWhereYouLeftOff')}</p>
      </div>

      <KeyboardForm validateField={trigger} className="mt-8 space-y-5 text-left" onSubmit={onSubmit} noValidate>
        {serverError ? <FormAlert message={serverError} /> : null}

        <div className="space-y-2">
          <Label htmlFor="email">{t('emailAddress')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            aria-invalid={Boolean(errors.email)}
            disabled={isSubmitting}
            {...register('email')}
          />
          {errors.email ? (
            <p className="text-sm text-red-600">{pageText(errors.email.message, t)}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordField
            id="password"
            autoComplete="current-password"
            placeholder={t('enterYourPassword')}
            aria-invalid={Boolean(errors.password)}
            disabled={isSubmitting}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-sm text-red-600">{pageText(errors.password.message, t)}</p>
          ) : null}
          <div className="flex justify-end">
            <span className="text-sm text-[#526259]">{t('forgotPassword')}</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1a3c34] text-sm font-medium text-white transition-opacity hover:bg-[#163329] disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {isSubmitting ? t('loggingIn') : t('logIn')}
          {!isSubmitting ? <ArrowRight className="size-4" aria-hidden /> : null}
        </button>
      </KeyboardForm>

      <p className="mt-6 text-center text-sm text-[#526259]">
        {t('newHere')}{' '}
        <Link className="font-medium text-[#1a3c34] hover:underline" to="/register">
          {t('createAnAccount')}
        </Link>
      </p>
    </AuthShell>
  )
}

export default LoginPage
