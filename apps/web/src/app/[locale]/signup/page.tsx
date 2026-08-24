'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TRIAL_DAYS, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '@linyup/shared'
import { signUp } from '@/lib/auth'
import { provisionTeam, userHasTeam } from '@/lib/provisioning'
import { usePublicSignupEnabled, isSignupClosedError } from '@/lib/signupGate'
import { useAuth } from '@/contexts/AuthContext'
import { usePlanName } from '@/hooks/usePlanName'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { SocialAuthButtons, AuthDivider } from '@/components/auth/SocialAuthButtons'

// ─── shared shape of the authenticated user we carry into the team step ───────

interface AuthedUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  /** Carried through to `provisionTeam`, which records it on the team — the
   *  mail gate reads it. A social sign-in arrives true; an email signup false. */
  emailVerified: boolean
}

// ─── schemas ─────────────────────────────────────────────────────────────────

const accountSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

// CURRENCY AND LANGUAGE ARE ASKED HERE, and they are asked here because of what
// happens if they are not (found on the prod canary, 2026-08-23):
//
//  • `Team.language` decides the language of EVERY member-facing email this
//    studio ever sends — booking confirmations, reminders, waitlist offers, the
//    lot. Nothing set it and, until now, nothing in the app could: a studio
//    created through signup mailed its members in English permanently.
//  • `default_currency` is what every price the studio types is entered in. Left
//    to a default, the first prices are authored in a currency nobody chose.
//
// Both default to something sensible rather than to nothing, so a studio that
// skips past them is still correct in the common case.
const teamSchema = z.object({
  name: z.string().min(2, 'At least 2 characters').max(60, 'Max 60 characters'),
  sport_type: z.string().optional(),
  default_currency: z.string().min(3),
  language: z.enum(['en', 'de', 'fr', 'it']),
})

type AccountData = z.infer<typeof accountSchema>
type TeamData = z.infer<typeof teamSchema>

// ─── step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i < current ? 'w-6 bg-primary' : i === current ? 'w-6 bg-primary' : 'w-4 bg-border'
          }`}
        />
      ))}
    </div>
  )
}

// ─── step 1: account ─────────────────────────────────────────────────────────

function StepAccount({ onNext }: { onNext: (user: AuthedUser) => void }) {
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Signup')
  const tAuth = useTranslations('Auth')
  const { enabled: signupEnabled } = usePublicSignupEnabled()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccountData>({ resolver: zodResolver(accountSchema) })

  async function onSubmit(data: AccountData) {
    setError(null)
    try {
      const cred = await signUp(data.email, data.password)
      onNext({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
        photoURL: cred.user.photoURL,
        emailVerified: cred.user.emailVerified,
      })
    } catch (err) {
      const e = err as { code?: string }
      if (isSignupClosedError(err)) {
        setError(tAuth('errorSignupClosed'))
      } else if (e.code === 'auth/email-already-in-use') {
        setError(t('errorEmailInUse'))
      } else {
        setError(t('errorAccountGeneric'))
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Invite-only notice while public signup is closed. The form stays usable
          so an allowlisted invitee can finish; the server is the real gate. */}
      {!signupEnabled && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          {tAuth('signupClosedNotice')}
        </p>
      )}

      <SocialAuthButtons
        onAuthed={async (cred) => {
          const hasTeam = await userHasTeam(cred.user.uid)
          if (hasTeam) {
            // Returning user signed in via a provider — straight to the app.
            window.location.assign('/dashboard')
            return
          }
          onNext({
            uid: cred.user.uid,
            email: cred.user.email,
            displayName: cred.user.displayName,
            photoURL: cred.user.photoURL,
            emailVerified: cred.user.emailVerified,
          })
        }}
      />

      <AuthDivider label={tAuth('orWithEmail')} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          {errors.password && <p className="text-destructive text-xs">{errors.password.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} />
          {errors.confirmPassword && (
            <p className="text-destructive text-xs">{errors.confirmPassword.message}</p>
          )}
        </div>

        {error && (
          <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t('creating') : t('continue')}
        </Button>
      </form>
    </div>
  )
}

// ─── step 2: team ─────────────────────────────────────────────────────────────

const SPORT_TYPES = [
  'Martial arts',
  'Football / Soccer',
  'Basketball',
  'Volleyball',
  'Tennis',
  'Swimming',
  'Gymnastics',
  'CrossFit / Fitness',
  'Yoga / Pilates',
  'Dance',
  'Rugby',
  'Cycling',
  'Athletics',
  'Other',
]

/** The languages the product speaks. Same four as `routing.locales`; named here
 *  rather than imported from the i18n config because this list is about the
 *  STUDIO's outbound mail, not about the URL the browser is on. */
const TEAM_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
] as const

function StepTeam({ user, onComplete }: { user: AuthedUser; onComplete: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Signup')
  const locale = useLocale()
  const planName = usePlanName()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TeamData>({
    resolver: zodResolver(teamSchema),
    // Seeded from the locale the visitor is already reading the page in — the
    // best guess available, and one they can see and change before it is saved.
    defaultValues: {
      default_currency: DEFAULT_CURRENCY,
      language: (['en', 'de', 'fr', 'it'] as const).includes(locale as 'en')
        ? (locale as 'en' | 'de' | 'fr' | 'it')
        : 'en',
    },
  })

  async function onSubmit(data: TeamData) {
    setError(null)
    try {
      await provisionTeam(user, data.name, data.sport_type, {
        defaultCurrency: data.default_currency,
        language: data.language,
      })
      onComplete()
    } catch {
      setError(t('errorTeamGeneric'))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">{t('teamName')}</Label>
        <Input id="name" type="text" placeholder={t('teamNamePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sport_type">
          {t('sportType')} <span className="text-muted-foreground font-normal">{t('sportTypeOptional')}</span>
        </Label>
        <Controller
          name="sport_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('sportTypeSelect')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('sportTypeSelect')}</SelectItem>
                {SPORT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {/* Two selects on one row: neither needs the width, and stacking them
          would make a two-field step look like a four-field one. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="default_currency">{t('currency')}</Label>
          <Controller
            name="default_currency"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code} label={`${c.code} · ${c.name}`} />
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="language">{t('language')}</Label>
          <Controller
            name="language"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      {/* What the language actually decides, said once — it is not the UI
          language (that follows the URL), it is what your members are written
          to in. */}
      <p className="text-xs text-muted-foreground -mt-2">{t('languageHint')}</p>

      {error && (
        <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* UX-7 interim: self-service signup silently provisions a 30-day trial
          (lib/provisioning.ts) and never said so anywhere. State it once,
          here, before the studio is created. */}
      <p className="text-center text-xs text-muted-foreground">
        {t('trialNotice', { plan: planName('studio'), days: TRIAL_DAYS })}
      </p>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('creatingTeam') : t('createTeam')}
      </Button>
    </form>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Step = 'account' | 'team' | 'done'

export default function SignupPage() {
  const router = useRouter()
  const t = useTranslations('Signup')
  const { user, profile, loading } = useAuth()
  const [step, setStep] = useState<Step>('account')
  const [authedUser, setAuthedUser] = useState<AuthedUser | null>(null)

  // A user who authenticated elsewhere (social button, magic link) but never
  // finished signup lands here already logged in — skip straight to the team
  // step. If they already have a team, send them to the app.
  useEffect(() => {
    if (loading || !user || authedUser) return
    if (profile?.currentTeam) {
      router.replace('/dashboard')
      return
    }
    setAuthedUser({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified,
    })
    setStep('team')
  }, [loading, user, profile, authedUser, router])

  function handleAccountDone(u: AuthedUser) {
    setAuthedUser(u)
    setStep('team')
  }

  function handleTeamDone() {
    setStep('done')
    setTimeout(() => router.push('/dashboard'), 1200)
  }

  const stepIndex = step === 'account' ? 0 : 1

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center"><Logo size={32} /></div>
          <p className="text-muted-foreground text-sm">
            {step === 'account' && t('stepAccount')}
            {step === 'team' && t('stepTeam')}
            {step === 'done' && t('stepDone')}
          </p>
        </div>

        <StepIndicator current={stepIndex} total={2} />

        <Card>
          <CardContent className="pt-6">
            {step === 'account' && <StepAccount onNext={handleAccountDone} />}
            {step === 'team' && authedUser && (
              <StepTeam user={authedUser} onComplete={handleTeamDone} />
            )}
            {step === 'done' && (
              <div className="py-4 text-center space-y-2">
                <div className="text-4xl">🎉</div>
                <p className="font-semibold">{t('teamCreated')}</p>
                <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {step === 'account' && (
          <p className="text-center text-xs text-muted-foreground">
            {t('alreadyHaveAccount')}{' '}
            <Link href="/login" className="text-primary hover:underline">
              {t('signIn')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
