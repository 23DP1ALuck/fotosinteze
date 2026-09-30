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
import { loginSchema, type LoginFormValues } from '@/features/auth/schemas'
import { cn } from '@/lib/utils'

function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
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
      navigate('/', { replace: true })
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
      )
    }
  })

  return (
    <AuthShell headline="Slow and steady wins the race">
      <AuthBackLink />
      <div className="space-y-2 text-left">
        <h2 className="text-3xl font-semibold tracking-tight text-[#1a2e2a]">
          Welcome back.
        </h2>
        <p className="text-[#6b7280]">Log in to pick up where you left off.</p>
      </div>

      <form className="mt-8 space-y-5 text-left" onSubmit={onSubmit} noValidate>
        {serverError ? <FormAlert message={serverError} /> : null}

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
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={Boolean(errors.password)}
            disabled={isSubmitting}
            {...register('password')}
          />
          {errors.password ? (
            <p className="text-sm text-red-600">{errors.password.message}</p>
          ) : null}
          <div className="flex justify-end">
            <span className="text-sm text-[#6b7280]">Forgot password?</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1a3c34] text-sm font-medium text-white transition-opacity hover:bg-[#163329] disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {isSubmitting ? 'Logging in…' : 'Log in'}
          {!isSubmitting ? <ArrowRight className="size-4" aria-hidden /> : null}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#6b7280]">
        New here?{' '}
        <Link className="font-medium text-[#1a3c34] hover:underline" to="/register">
          Create an account
        </Link>
      </p>
    </AuthShell>
  )
}

export default LoginPage
