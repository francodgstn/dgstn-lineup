'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signIn, resetPassword } from '@/lib/auth'
import { Logo } from '@/components/Logo'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations('Login')
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      await signIn(data.email, data.password)
      router.push('/dashboard')
    } catch {
      setError(t('errorInvalidCredentials'))
    }
  }

  async function handleResetPassword() {
    const email = getValues('email')
    if (!email) {
      setError(t('errorEmailRequired'))
      return
    }
    try {
      await resetPassword(email)
      setResetSent(true)
    } catch {
      setError(t('errorResetFailed'))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center"><Logo size={32} /></div>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>

        <div className="bg-card border rounded-xl shadow-sm p-6 space-y-4">
          {resetSent && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
              {t('resetSent')}
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1" suppressHydrationWarning>
              <label htmlFor="email" className="text-sm font-medium">
                {t('email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                {...register('email')}
              />
              {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
            </div>

            <div className="space-y-1" suppressHydrationWarning>
              <label htmlFor="password" className="text-sm font-medium">
                {t('password')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                {...register('password')}
              />
              {errors.password && <p className="text-destructive text-xs">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? t('submitting') : t('submit')}
            </button>
          </form>

          <div className="text-center">
            <button
              type="button"
              onClick={handleResetPassword}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {t('forgotPassword')}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href="/signup" className="text-primary hover:underline">
            {t('createAccount')}
          </Link>
        </p>
      </div>
    </div>
  )
}
