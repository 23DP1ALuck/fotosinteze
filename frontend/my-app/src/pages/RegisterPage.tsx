import { pageText } from '@/i18n/pages'
import { useTranslation } from 'react-i18next'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'

import { AuthBackLink, AuthShell } from '@/components/auth/AuthShell'
import { FormAlert } from '@/components/auth/FormAlert'
import { PasswordField } from '@/components/auth/PasswordField'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/use-auth'
import { ApiError } from '@/features/auth/api'
import {
  registerSchema,
  type RegisterFormValues,
} from '@/features/auth/schemas'
import { cn } from '@/lib/utils'

function RegisterPage() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const { register: registerUserSession } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register, trigger,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await registerUserSession(
        values.displayName,
        values.email,
        values.password,
      )
      navigate('/app', { replace: true })
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
      )
    }
  })

  return (
    <AuthShell headline={t('beCarefulOnTheRoad')}>
      <AuthBackLink />
      <div className="space-y-2 text-left">
        <h2 className="text-3xl font-semibold tracking-tight text-[#1a2e2a]">
          {t('aClearerStart')}
        </h2>
        <p className="text-[#526259]">
          {t('createOneAccountMakeRoomForEveryGoal')}
        </p>
      </div>

      <KeyboardForm validateField={trigger} className="mt-8 space-y-5 text-left" onSubmit={onSubmit} noValidate>
        {serverError ? <FormAlert message={serverError} /> : null}

        <div className="space-y-2">
          <Label htmlFor="displayName">{t('fullName')}</Label>
          <Input
            id="displayName"
            autoComplete="name"
            placeholder={t('yourFullName')}
            aria-invalid={Boolean(errors.displayName)}
            disabled={isSubmitting}
            {...register('displayName')}
          />
          {errors.displayName ? (
            <p className="text-sm text-red-600">{pageText(errors.displayName.message, t)}</p>
          ) : null}
        </div>

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
            autoComplete="new-password"
            placeholder={t('createAPassword')}
            aria-invalid={Boolean(errors.password)}
            disabled={isSubmitting}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-sm text-red-600">{pageText(errors.password.message, t)}</p>
          ) : (
            <p className="text-sm text-[#526259]">
              {t('useAtLeast8CharactersALongerPhraseWorksWell')}
            </p>
          )}
        </div>

        <p className="text-sm text-[#526259]">
          {t('byCreatingAnAccountYouAgreeToTheTermsOfServiceAndPrivacyPolicy')}
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1a3c34] text-sm font-medium text-white transition-opacity hover:bg-[#163329] disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {isSubmitting ? t('creatingAccount') : t('createAccount')}
          {!isSubmitting ? <ArrowRight className="size-4" aria-hidden /> : null}
        </button>
      </KeyboardForm>

      <p className="mt-6 text-center text-sm text-[#526259]">
        {t('alreadyHaveAnAccount')}{' '}
        <Link className="font-medium text-[#1a3c34] hover:underline" to="/login">
          {t('logIn')}
        </Link>
      </p>
    </AuthShell>
  )
}

export default RegisterPage
