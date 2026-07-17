'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { resolveActivityAccessRule, type ActivityAccessRule } from '@linyup/shared'
import { usePublicTeam } from '../PublicTeamProvider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  CalendarClock,
  MapPin,
  Video,
  Clock,
  User,
  Check,
  Lock,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────
// Mirrors the listAvailability callable's contract: availability is the ONLY
// source of bookable times (nothing is pre-generated any more — an appointment
// Session exists only once booked). Duration/name/access come from the linked
// Activity, not the availability window.

interface AvailActivity {
  activityId: string
  activityName: string
  durations: Array<{
    minutes: number
    priceAmount: number | null
    subscriptionPricing: Array<{ subscriptionTypeId: string; priceAmount: number | null }>
  }>
  accessRule: ActivityAccessRule
  location: string | null
  onlineUrl: string | null
  days: { dayMs: number; slotsByDuration: Record<string, number[]> }[]
}

interface AvailCoach {
  providerId: string
  providerName: string | null
  activities: AvailActivity[]
}

// What a time chip opens the booking modal with.
interface WindowBooking {
  providerId: string
  providerName: string | null
  activityId: string
  activityName: string
  startMs: number
  durationMinutes: number
  isFreeTrial: boolean
  location: string | null
  onlineUrl: string | null
}

type PickerStep = 'coach' | 'activity' | 'time'

// Args passed to whichever booking callable backs the form.
type BookArgs =
  | { contactDetails: { firstname: string; lastname: string; email: string; phone?: string } }
  | { authenticatedContactId: string; verificationCodeId: string }

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtDayShort = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60),
    m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── booking form schemas ──────────────────────────────────────────────────────

const bookingSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Enter a valid email'),
  phone: z.string().max(30).optional(),
})
type BookingFormValues = z.infer<typeof bookingSchema>
const emailSchema = z.object({ email: z.string().email('Enter a valid email address') })
type EmailValues = z.infer<typeof emailSchema>
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })
type CodeValues = z.infer<typeof codeSchema>

// ─── booking form (guest / members-only) ───────────────────────────────────────

function SlotBookingForm({
  teamId,
  isFreeTrial,
  book,
  onBooked,
  onClose,
}: {
  teamId: string
  isFreeTrial: boolean
  book: (args: BookArgs) => Promise<void>
  onBooked: (details: { firstname: string; email: string }) => void
  onClose: () => void
}) {
  const t = useTranslations('AppointmentBooking')
  const [error, setError] = useState<string | null>(null)

  type VerifyStep = 'email' | 'code'
  const [verifyStep, setVerifyStep] = useState<VerifyStep>('email')
  const [returningEmail, setReturningEmail] = useState('')
  const [codeId, setCodeId] = useState('')
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({ resolver: zodResolver(bookingSchema) })
  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })

  async function onSubmitGuest(data: BookingFormValues) {
    setError(null)
    try {
      await book({
        contactDetails: {
          firstname: data.firstname,
          lastname: data.lastname,
          email: data.email,
          phone: data.phone || undefined,
        },
      })
      onBooked({ firstname: data.firstname, email: data.email })
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'already-exists') setError(t('errorAlreadyBooked'))
      else if (e.code === 'failed-precondition') setError(t('errorSlotUnavailable'))
      else setError(t('errorGeneric'))
    }
  }

  async function onSendCode(values: EmailValues) {
    setError(null)
    try {
      const fn = httpsCallable<
        { email: string; teamId: string },
        { codeId: string; hasContacts?: boolean }
      >(functions, 'sendBookingVerificationCode')
      const result = await fn({ email: values.email, teamId })
      if (result.data.hasContacts === false) {
        setError(t('membersNoAccount'))
        return
      }
      setReturningEmail(values.email)
      setCodeId(result.data.codeId)
      setCountdown(60)
      setVerifyStep('code')
    } catch (err) {
      setError((err as { message?: string }).message || t('errorSendCode'))
    }
  }

  async function onVerifyCode(values: CodeValues) {
    setError(null)
    try {
      const verifyFn = httpsCallable<
        { codeId: string; code: string },
        { verified: boolean; codeId: string; selectedContactId?: string; matchedContacts?: { id: string }[] }
      >(functions, 'verifyBookingCode')
      const result = await verifyFn({ codeId, code: values.code })
      const contactId = result.data.selectedContactId ?? result.data.matchedContacts?.[0]?.id ?? null
      if (!contactId) {
        setError(t('errorNoAccount'))
        return
      }
      await book({ authenticatedContactId: contactId, verificationCodeId: result.data.codeId })
      onBooked({ firstname: returningEmail.split('@')[0], email: returningEmail })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'already-exists') setError(t('errorAlreadyBooked'))
      else if (e.code === 'permission-denied') setError(e.message || t('membersOnlyError'))
      else setError(e.message || t('errorIncorrectCode'))
    }
  }

  async function onResendCode() {
    if (countdown > 0) return
    setError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions,
        'sendBookingVerificationCode'
      )
      const result = await fn({ email: returningEmail, teamId })
      setCodeId(result.data.codeId)
      setCountdown(60)
      codeForm.reset()
    } catch (err) {
      setError((err as { message?: string }).message || t('errorResendCode'))
    }
  }

  const errorBox = error ? (
    <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
      {error}
    </p>
  ) : null

  if (isFreeTrial) {
    return (
      <form onSubmit={handleSubmit(onSubmitGuest)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cbf-fn" className="text-xs">{t('fieldFirstname')}</Label>
            <Input id="cbf-fn" {...register('firstname')} />
            {errors.firstname && <p className="text-destructive text-xs">{errors.firstname.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cbf-ln" className="text-xs">{t('fieldLastname')}</Label>
            <Input id="cbf-ln" {...register('lastname')} />
            {errors.lastname && <p className="text-destructive text-xs">{errors.lastname.message}</p>}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cbf-em" className="text-xs">{t('fieldEmail')}</Label>
          <Input id="cbf-em" type="email" {...register('email')} />
          {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cbf-ph" className="text-xs">{t('fieldPhone')}</Label>
          <Input id="cbf-ph" type="tel" {...register('phone')} />
        </div>
        {errorBox}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? t('submitting') : t('submit')}</Button>
        </div>
      </form>
    )
  }

  if (verifyStep === 'email') {
    return (
      <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-3">
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {t('membersVerifyPrompt')}
        </p>
        <div className="space-y-1">
          <Label className="text-xs">{t('fieldEmail')}</Label>
          <Input type="email" {...emailForm.register('email')} autoComplete="email" placeholder="your@email.com" />
          {emailForm.formState.errors.email && (
            <p className="text-destructive text-xs">{emailForm.formState.errors.email.message}</p>
          )}
        </div>
        {errorBox}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" size="sm" disabled={emailForm.formState.isSubmitting}>
            {emailForm.formState.isSubmitting ? t('sending') : t('sendCode')}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('codeSentTo', { email: returningEmail })}</p>
      <div className="space-y-1">
        <Label className="text-xs">{t('fieldCode')}</Label>
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          {...codeForm.register('code', {
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
            },
          })}
          placeholder="000000"
          className="text-center tracking-widest text-lg font-mono"
        />
        {codeForm.formState.errors.code && (
          <p className="text-destructive text-xs">{codeForm.formState.errors.code.message}</p>
        )}
      </div>
      {errorBox}
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onResendCode}
          disabled={countdown > 0}
          className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
        >
          {countdown > 0 ? t('resendIn', { seconds: countdown }) : t('resend')}
        </button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setVerifyStep('email'); setError(null); codeForm.reset() }}>
            {t('back')}
          </Button>
          <Button type="submit" size="sm" disabled={codeForm.formState.isSubmitting}>
            {codeForm.formState.isSubmitting ? t('verifying') : t('confirmBooking')}
          </Button>
        </div>
      </div>
    </form>
  )
}

// ─── booking modal shell (shared header + form) ────────────────────────────────

function BookingModal({
  title,
  isFreeTrial,
  providerName,
  location,
  onlineUrl,
  dateLine,
  teamId,
  book,
  onBooked,
  onClose,
}: {
  title: string | null
  isFreeTrial: boolean
  providerName: string | null
  location: string | null
  onlineUrl: string | null
  dateLine: string
  teamId: string
  book: (args: BookArgs) => Promise<void>
  onBooked: (d: { firstname: string; email: string }) => void
  onClose: () => void
}) {
  const t = useTranslations('AppointmentBooking')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {title}
            {!isFreeTrial && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Lock className="h-2.5 w-2.5" />
                {t('membersOnly')}
              </span>
            )}
          </DialogTitle>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{dateLine}</span>
            {providerName && (
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{providerName}</span>
            )}
            {location && (
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{location}</span>
            )}
            {onlineUrl && (
              <span className="flex items-center gap-1"><Video className="h-3 w-3" />{t('onlineSession')}</span>
            )}
          </div>
        </DialogHeader>
        <SlotBookingForm teamId={teamId} isFreeTrial={isFreeTrial} book={book} onBooked={onBooked} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

// ─── confirmation screen ──────────────────────────────────────────────────────

function ConfirmationScreen({ email }: { email: string }) {
  const t = useTranslations('AppointmentBooking')
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold">{t('confirmedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('confirmedMessage', { email })}</p>
      </div>
    </div>
  )
}

// ─── funnel building blocks ─────────────────────────────────────────────────────

function EmptyState({ icon: Icon, text, hint }: { icon: typeof CalendarClock; text: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Icon className="h-8 w-8 mx-auto mb-3 opacity-40" />
      <p className="font-medium">{text}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  )
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

// Step 1 — pick a coach.
function CoachCard({ coach, onSelect }: { coach: AvailCoach; onSelect: () => void }) {
  const t = useTranslations('AppointmentBooking')
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{coach.providerName || t('unnamedCoach')}</p>
          <p className="text-xs text-muted-foreground truncate">
            {coach.activities.map((a) => a.activityName).join(' · ')}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  )
}

// Step 2 — pick an activity offered by that coach.
function ActivityCard({ activity, onSelect }: { activity: AvailActivity; onSelect: () => void }) {
  const t = useTranslations('AppointmentBooking')
  const isFreeTrial = resolveActivityAccessRule({ accessRule: activity.accessRule }).type === 'open'
  const durations = activity.durations.map((d) => d.minutes)
  const durationLabel =
    durations.length > 1
      ? `${fmtDuration(Math.min(...durations))} – ${fmtDuration(Math.max(...durations))}`
      : fmtDuration(durations[0] ?? 60)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{activity.activityName}</p>
            {!isFreeTrial && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Lock className="h-2.5 w-2.5" />
                {t('membersOnly')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{durationLabel}</span>
            {activity.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{activity.location}</span>}
            {activity.onlineUrl && <span className="flex items-center gap-1"><Video className="h-3 w-3" />{t('onlineSession')}</span>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
      </div>
    </button>
  )
}

// Step 3 — duration (only if the activity offers more than one) → day → time.
function TimePicker({
  coach,
  activity,
  onPick,
}: {
  coach: AvailCoach
  activity: AvailActivity
  onPick: (startMs: number, durationMinutes: number) => void
}) {
  const t = useTranslations('AppointmentBooking')
  const [dayMs, setDayMs] = useState<number>(activity.days[0]?.dayMs ?? 0)
  const [duration, setDuration] = useState<number>(activity.durations[0]?.minutes ?? 60)

  const day = activity.days.find((d) => d.dayMs === dayMs) ?? activity.days[0]
  const times = day?.slotsByDuration[String(duration)] ?? []

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{activity.activityName}</p>
          {coach.providerName && <p className="text-xs text-muted-foreground">{coach.providerName}</p>}
        </div>
      </div>

      {/* Day */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('pickDay')}</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {activity.days.map((d) => (
            <button
              key={d.dayMs}
              type="button"
              onClick={() => setDayMs(d.dayMs)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                d.dayMs === dayMs ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {fmtDayShort(d.dayMs)}
            </button>
          ))}
        </div>
      </div>

      {/* Duration — only shown when the activity offers more than one length. */}
      {activity.durations.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('pickDuration')}</p>
          <div className="flex gap-2 flex-wrap">
            {activity.durations.map((d) => (
              <button
                key={d.minutes}
                type="button"
                onClick={() => setDuration(d.minutes)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  d.minutes === duration ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {fmtDuration(d.minutes)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Times */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('pickTime')}</p>
        {times.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noTimesThisDay')}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {times.map((startMs) => (
              <button
                key={startMs}
                type="button"
                onClick={() => onPick(startMs, duration)}
                className="rounded-lg border py-1.5 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5"
              >
                {fmtTime(startMs)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────
// Coach-first funnel: coach → activity → duration (only if >1) → day → time.
// Availability is the ONLY source of bookable times — there are no
// pre-generated appointment sessions any more.

export default function AppointmentPicker({ slug }: { slug: string }) {
  const t = useTranslations('AppointmentBooking')
  const { teamId } = usePublicTeam()
  const [coaches, setCoaches] = useState<AvailCoach[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState<{ email: string } | null>(null)
  const [windowBooking, setWindowBooking] = useState<WindowBooking | null>(null)
  const [step, setStep] = useState<PickerStep>('coach')
  const [selectedCoach, setSelectedCoach] = useState<AvailCoach | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<AvailActivity | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const availFn = httpsCallable<
          { teamId: string; days?: number },
          { coaches: AvailCoach[] }
        >(functions, 'listAvailability')
        const res = await availFn({ teamId, days: 60 })
        if (!alive) return
        setCoaches(res.data.coaches ?? [])
      } catch {
        if (alive) setCoaches([])
      } finally {
        if (alive) setLoading(false)
      }
    }
    if (teamId) load()
    else setLoading(false)
    return () => { alive = false }
  }, [teamId])

  if (confirmed) return <ConfirmationScreen email={confirmed.email} />

  function selectCoach(c: AvailCoach) {
    setSelectedCoach(c)
    setSelectedActivity(null)
    setStep('activity')
  }
  function selectActivity(a: AvailActivity) {
    setSelectedActivity(a)
    setStep('time')
  }
  function backToCoaches() {
    setStep('coach')
    setSelectedCoach(null)
    setSelectedActivity(null)
  }
  function backToActivities() {
    setStep('activity')
    setSelectedActivity(null)
  }

  const hasCoaches = coaches.length > 0

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {!loading && !teamId && <EmptyState icon={CalendarClock} text={t('teamNotFound')} />}

        {!loading && teamId && !hasCoaches && (
          <EmptyState icon={CalendarClock} text={t('noCoaches')} hint={t('noCoachesHint')} />
        )}

        {!loading && teamId && hasCoaches && step === 'coach' && (
          <section className="space-y-3">
            {coaches.map((c) => (
              <CoachCard key={c.providerId} coach={c} onSelect={() => selectCoach(c)} />
            ))}
          </section>
        )}

        {!loading && teamId && step === 'activity' && selectedCoach && (
          <section className="space-y-3">
            <BackRow label={t('backToCoaches')} onClick={backToCoaches} />
            <h2 className="text-sm font-semibold">{selectedCoach.providerName || t('unnamedCoach')}</h2>
            {selectedCoach.activities.length === 0 ? (
              <EmptyState icon={CalendarClock} text={t('noCoaches')} hint={t('noCoachesHint')} />
            ) : (
              selectedCoach.activities.map((a) => (
                <ActivityCard key={a.activityId} activity={a} onSelect={() => selectActivity(a)} />
              ))
            )}
          </section>
        )}

        {!loading && teamId && step === 'time' && selectedCoach && selectedActivity && (
          <section className="space-y-3">
            <BackRow label={t('backToActivities')} onClick={backToActivities} />
            <TimePicker
              coach={selectedCoach}
              activity={selectedActivity}
              onPick={(startMs, durationMinutes) =>
                setWindowBooking({
                  providerId: selectedCoach.providerId,
                  providerName: selectedCoach.providerName,
                  activityId: selectedActivity.activityId,
                  activityName: selectedActivity.activityName,
                  startMs,
                  durationMinutes,
                  isFreeTrial: resolveActivityAccessRule({ accessRule: selectedActivity.accessRule }).type === 'open',
                  location: selectedActivity.location,
                  onlineUrl: selectedActivity.onlineUrl,
                })
              }
            />
          </section>
        )}
      </div>

      {windowBooking && teamId && (
        <BookingModal
          key={`${windowBooking.providerId}-${windowBooking.activityId}-${windowBooking.startMs}-${windowBooking.durationMinutes}`}
          title={windowBooking.activityName}
          isFreeTrial={windowBooking.isFreeTrial}
          providerName={windowBooking.providerName}
          location={windowBooking.location}
          onlineUrl={windowBooking.onlineUrl}
          dateLine={`${fmtDate(windowBooking.startMs)} · ${fmtTime(windowBooking.startMs)} – ${fmtTime(windowBooking.startMs + windowBooking.durationMinutes * 60_000)} · ${fmtDuration(windowBooking.durationMinutes)}`}
          teamId={teamId}
          book={(args) =>
            httpsCallable(functions, 'bookAppointment')({
              teamId,
              providerId: windowBooking.providerId,
              activityId: windowBooking.activityId,
              startMs: windowBooking.startMs,
              durationMinutes: windowBooking.durationMinutes,
              ...args,
            }).then(() => undefined)
          }
          onBooked={({ email }) => { setWindowBooking(null); setConfirmed({ email }) }}
          onClose={() => setWindowBooking(null)}
        />
      )}
    </div>
  )
}
