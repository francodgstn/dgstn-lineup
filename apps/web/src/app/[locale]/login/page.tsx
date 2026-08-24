'use client'

import { useState } from 'react'
import type { Route } from 'next'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signIn, resetPassword } from '@/lib/auth'
import { userHasTeam } from '@/lib/provisioning'
import { usePublicSignupEnabled } from '@/lib/signupGate'
import { isDemoMode } from '@/lib/demo'
import { Logo } from '@/components/Logo'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { SocialAuthButtons, AuthDivider } from '@/components/auth/SocialAuthButtons'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type FormData = z.infer<typeof schema>

/**
 * Where to go after a successful sign-in, from `?next=`.
 *
 * Read off `window` rather than `useSearchParams()` deliberately: that hook
 * forces the page into dynamic rendering (or a Suspense boundary) and this is
 * the sign-in screen, which should keep prerendering. The value is only ever
 * read inside a submit handler, never during render, so there is no hydration
 * mismatch to pay for it.
 *
 * A single leading slash is REQUIRED and a double one is refused: `//evil.com`
 * is protocol-relative, so accepting it would turn the login page into an open
 * redirect for anyone who can get a link clicked.
 */
function nextPath(): Route | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('next')
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw as Route
}

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations('Login')
  const tAuth = useTranslations('Auth')
  const { enabled: signupEnabled } = usePublicSignupEnabled()
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
      router.push(nextPath() ?? '/dashboard')
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
    <div className="relative min-h-screen flex items-center justify-center bg-muted/40 px-4">
      {/* Language switcher — same placement as /try. Sign-in is the first screen
          a non-English user meets, and the locale is otherwise only reachable
          from inside the app, i.e. behind this very page. */}
      <div className="absolute right-4 top-4 z-20">
        <LocaleSwitcher />
      </div>

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

          <SocialAuthButtons
            onAuthed={async (cred) => {
              const hasTeam = await userHasTeam(cred.user.uid)
              // `next` outranks the team check: an invitee arrives here WITHOUT a
              // team precisely because accepting the invitation is what gives them
              // one, so sending them to /signup would strand them.
              router.replace(nextPath() ?? (hasTeam ? '/dashboard' : '/signup'))
            }}
          />

          <AuthDivider label={tAuth('orWithEmail')} />

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1" suppressHydrationWarning>
              <label htmlFor="email" className="text-sm font-medium">
                {t('email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                // Password managers decorate this field with an autofill icon
                // (inline style + an injected button) BEFORE hydration — suppress
                // the resulting attribute mismatch on the input itself, not just
                // the wrapper (suppressHydrationWarning is shallow).
                suppressHydrationWarning
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
                suppressHydrationWarning
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

        {/* Hide the public signup CTA while signup is closed. Invited users
            reach /signup directly via their invite email; the server enforces. */}
        {signupEnabled && (
          <p className="text-center text-xs text-muted-foreground">
            {t('noAccount')}{' '}
            <Link href="/signup" className="text-primary hover:underline">
              {t('createAccount')}
            </Link>
          </p>
        )}

        {isDemoMode() && (
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/try" className="text-primary hover:underline">
              {t('tryDemo')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
