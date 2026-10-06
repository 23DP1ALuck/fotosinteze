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
import { useAuth } from '@/features/auth/auth-context'
import { ApiError } from '@/features/auth/api'
import {
  registerSchema,
  type RegisterFormValues,
} from '@/features/auth/schemas'
import { cn } from '@/lib/utils'

function RegisterPage() {
  const navigate = useNavigate()
  const { register: registerUserSession } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
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
    <AuthShell headline="Be careful on the road!">
      <AuthBackLink />
      <div className="space-y-2 text-left">
        <h2 className="text-3xl font-semibold tracking-tight text-[#1a2e2a]">
          A clearer start.
        </h2>
        <p className="text-[#6b7280]">
          Create one account. Make room for every goal.
        </p>
      </div>

      <form className="mt-8 space-y-5 text-left" onSubmit={onSubmit} noValidate>
        {serverError ? <FormAlert message={serverError} /> : null}

        <div className="space-y-2">
          <Label htmlFor="displayName">Full name</Label>
          <Input
            id="displayName"
            autoComplete="name"
            placeholder="Your full name"
            aria-invalid={Boolean(errors.displayName)}
            disabled={isSubmitting}
            {...register('displayName')}
          />
          {errors.displayName ? (
            <p className="text-sm text-red-600">{errors.displayName.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            disabled={isSubmitting}
            {...register('email')}
          />
          {errors.email ? (
            <p className="text-sm text-red-600">{errors.email.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordField
            id="password"
            autoComplete="new-password"
            placeholder="Create a password"
            aria-invalid={Boolean(errors.password)}
            disabled={isSubmitting}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-sm text-red-600">{errors.password.message}</p>
          ) : (
            <p className="text-sm text-[#6b7280]">
              Use at least 8 characters. A longer phrase works well.
            </p>
          )}
        </div>

        <p className="text-sm text-[#6b7280]">
          By creating an account, you agree to the Terms of Service and Privacy
          Policy.
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1a3c34] text-sm font-medium text-white transition-opacity hover:bg-[#163329] disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {isSubmitting ? 'Creating account…' : 'Create account'}
          {!isSubmitting ? <ArrowRight className="size-4" aria-hidden /> : null}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#6b7280]">
        Already have an account?{' '}
        <Link className="font-medium text-[#1a3c34] hover:underline" to="/login">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}

export default RegisterPage
