'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signUp } from '@/lib/auth'
import { provisionTeam, userHasTeam } from '@/lib/provisioning'
import { useAuth } from '@/contexts/AuthContext'
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

const teamSchema = z.object({
  name: z.string().min(2, 'At least 2 characters').max(60, 'Max 60 characters'),
  sport_type: z.string().optional(),
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
      })
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'auth/email-already-in-use') {
        setError(t('errorEmailInUse'))
      } else {
        setError(t('errorAccountGeneric'))
      }
    }
  }

  return (
    <div className="space-y-4">
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

function StepTeam({ user, onComplete }: { user: AuthedUser; onComplete: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Signup')
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TeamData>({ resolver: zodResolver(teamSchema) })

  async function onSubmit(data: TeamData) {
    setError(null)
    try {
      await provisionTeam(user, data.name, data.sport_type)
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

      {error && (
        <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

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
            <a href="/login" className="text-primary hover:underline">
              {t('signIn')}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
