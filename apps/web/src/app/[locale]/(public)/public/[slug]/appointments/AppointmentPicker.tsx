'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { usePublicTeam } from '../PublicTeamProvider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WeeklyCalendar, type PlannerSession } from '@/components/schedule/WeeklyCalendar'
import {
  CalendarClock,
  CalendarRange,
  List,
  MapPin,
  Video,
  Clock,
  User,
  Check,
  Lock,
  ChevronRight,
  Sparkles,
} from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

interface PublicSlot {
  id: string // the session ID (parent of the public_profile doc)
  activityName: string | null
  coachName: string | null
  start: number // milliseconds
  end: number // milliseconds
  duration_minutes: number
  max_participants: number
  bookings_count: number
  location: string | null
  onlineUrl: string | null
  isFreeTrial: boolean
  status: 'open' | 'full' | 'cancelled'
}

// Availability returned by listAvailability (open-window mode).
interface AvailCoach {
  coachId: string
  coachName: string | null
  templateId: string
  title: string
  location: string | null
  onlineUrl: string | null
  isFreeTrial: boolean
  durations: number[]
  days: { dayMs: number; slotsByDuration: Record<string, number[]> }[]
}

// What a window time-chip opens the booking modal with.
interface WindowBooking {
  templateId: string
  coachId: string
  coachName: string | null
  title: string
  startMs: number
  durationMinutes: number
  isFreeTrial: boolean
  location: string | null
  onlineUrl: string | null
}

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

const isSlotFull = (s: PublicSlot) => s.status === 'full' || s.bookings_count >= s.max_participants

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

// ─── booking form (guest / members-only), booking-target-agnostic ─────────────
// `book` performs the actual booking (bookSession for a fixed slot,
// bookAppointment for an open-window time) so this form is shared.

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
  coachName,
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
  coachName: string | null
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
            {coachName && (
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{coachName}</span>
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

// ─── slot row (fixed-slot list view) ───────────────────────────────────────────

function SlotRow({ slot, onSelect }: { slot: PublicSlot; onSelect: (s: PublicSlot) => void }) {
  const t = useTranslations('AppointmentBooking')
  const full = isSlotFull(slot)
  return (
    <button
      type="button"
      disabled={full}
      onClick={() => onSelect(slot)}
      className="w-full rounded-xl border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{slot.activityName}</p>
            {!slot.isFreeTrial && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Lock className="h-2.5 w-2.5" />
                {t('membersOnly')}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{fmtDate(slot.start)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(slot.start)} – {fmtTime(slot.end)}</span>
            <span>{fmtDuration(slot.duration_minutes)}</span>
            {slot.coachName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{slot.coachName}</span>}
            {slot.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{slot.location}</span>}
            {slot.onlineUrl && <span className="flex items-center gap-1"><Video className="h-3 w-3" />{t('onlineSession')}</span>}
          </div>
        </div>
        <div className="shrink-0 self-center">
          {full ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">{t('full')}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">{t('book')}<ChevronRight className="h-3.5 w-3.5" /></span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── open-window picker (day → duration → time) ────────────────────────────────

function WindowPicker({ coach, onPick }: { coach: AvailCoach; onPick: (startMs: number, durationMinutes: number) => void }) {
  const t = useTranslations('AppointmentBooking')
  const [dayMs, setDayMs] = useState<number>(coach.days[0]?.dayMs ?? 0)
  const [duration, setDuration] = useState<number>(coach.durations[0] ?? 60)

  const day = coach.days.find((d) => d.dayMs === dayMs) ?? coach.days[0]
  // Days that have any slot for the chosen duration (fall back to any-slot days).
  const times = day?.slotsByDuration[String(duration)] ?? []

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{coach.title}</p>
          {coach.coachName && <p className="text-xs text-muted-foreground">{coach.coachName}</p>}
        </div>
      </div>

      {/* Day */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('pickDay')}</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {coach.days.map((d) => (
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

      {/* Duration */}
      {coach.durations.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('pickDuration')}</p>
          <div className="flex gap-2 flex-wrap">
            {coach.durations.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  d === duration ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {fmtDuration(d)}
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

function ViewToggle({ view, onChange }: { view: 'list' | 'calendar'; onChange: (v: 'list' | 'calendar') => void }) {
  const t = useTranslations('AppointmentBooking')
  const btn = (mode: 'list' | 'calendar', Icon: typeof List, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={view === mode}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        view === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
  return (
    <div className="inline-flex items-center gap-1 rounded-full border p-1">
      {btn('calendar', CalendarRange, t('viewCalendar'))}
      {btn('list', List, t('viewList'))}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function AppointmentPicker({ slug }: { slug: string }) {
  const t = useTranslations('AppointmentBooking')
  const { teamId } = usePublicTeam()
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [windows, setWindows] = useState<AvailCoach[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState<{ email: string } | null>(null)
  const [selected, setSelected] = useState<PublicSlot | null>(null)
  const [windowBooking, setWindowBooking] = useState<WindowBooking | null>(null)
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const [coachFilter, setCoachFilter] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const now = Timestamp.now()
        const windowEnd = Timestamp.fromMillis(now.toMillis() + 60 * 24 * 60 * 60_000)
        const slotsQ = query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('type', '==', 'appointment_session'),
          where('status', '==', 'open'),
          where('start', '>=', now),
          where('start', '<=', windowEnd),
          orderBy('start', 'asc'),
          limit(100)
        )
        // Fixed slots + open-window availability load in parallel.
        const availFn = httpsCallable<
          { teamId: string; days: number },
          { coaches: AvailCoach[] }
        >(functions, 'listAvailability')
        const [slotsSnap, availRes] = await Promise.all([
          getDocs(slotsQ),
          availFn({ teamId, days: 60 }).catch(() => ({ data: { coaches: [] } })),
        ])
        if (!alive) return
        setSlots(
          slotsSnap.docs.map((d) => {
            const s = d.data()
            return {
              id: d.ref.parent.parent!.id,
              activityName: (s.activityName as string) || null,
              coachName: (s.coachName as string) || null,
              start: (s.start as Timestamp).toMillis(),
              end: (s.end as Timestamp).toMillis(),
              duration_minutes: (s.duration_minutes as number) || 60,
              max_participants: (s.max_participants as number) || 1,
              bookings_count: (s.bookings_count as number) || 0,
              location: (s.location as string) || null,
              onlineUrl: (s.onlineUrl as string) || null,
              isFreeTrial: s.isFreeTrial !== false,
              status: (s.status as 'open' | 'full' | 'cancelled') || 'open',
            }
          })
        )
        setWindows(availRes.data.coaches ?? [])
      } catch {
        if (alive) { setSlots([]); setWindows([]) }
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [teamId])

  const coaches = useMemo(() => {
    const set = new Set<string>()
    for (const s of slots ?? []) if (s.coachName) set.add(s.coachName)
    return [...set].sort()
  }, [slots])

  const visibleSlots = useMemo(
    () => (slots ?? []).filter((s) => !coachFilter || s.coachName === coachFilter),
    [slots, coachFilter]
  )

  const plannerSessions: PlannerSession[] = useMemo(
    () =>
      visibleSlots.map((s) => ({
        id: s.id,
        start: { toDate: () => new Date(s.start) },
        end: { toDate: () => new Date(s.end) },
        activityName: s.activityName,
        coachName: s.coachName,
        location: s.location,
      })),
    [visibleSlots]
  )
  const byId = useMemo(() => new Map(visibleSlots.map((s) => [s.id, s])), [visibleSlots])

  if (confirmed) return <ConfirmationScreen email={confirmed.email} />

  const hasSlots = !!slots && slots.length > 0
  const hasWindows = windows.length > 0

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          {hasSlots && <ViewToggle view={view} onChange={setView} />}
        </div>

        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        )}

        {!loading && !teamId && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('teamNotFound')}</p>
          </div>
        )}

        {/* Open-window picker(s) */}
        {!loading && hasWindows && (
          <section className="space-y-3">
            {hasSlots && <h2 className="text-sm font-semibold">{t('windowSectionTitle')}</h2>}
            {windows.map((coach) => (
              <WindowPicker
                key={coach.templateId}
                coach={coach}
                onPick={(startMs, durationMinutes) =>
                  setWindowBooking({
                    templateId: coach.templateId,
                    coachId: coach.coachId,
                    coachName: coach.coachName,
                    title: coach.title,
                    startMs,
                    durationMinutes,
                    isFreeTrial: coach.isFreeTrial,
                    location: coach.location,
                    onlineUrl: coach.onlineUrl,
                  })
                }
              />
            ))}
          </section>
        )}

        {/* Fixed slots */}
        {!loading && teamId && hasSlots && (
          <section className="space-y-3">
            {hasWindows && <h2 className="text-sm font-semibold">{t('fixedSectionTitle')}</h2>}
            {coaches.length > 1 && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
                {[null, ...coaches].map((c) => (
                  <button
                    key={c ?? '__all'}
                    type="button"
                    onClick={() => setCoachFilter(c)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      coachFilter === c ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {c ?? t('allCoaches')}
                  </button>
                ))}
              </div>
            )}
            {view === 'calendar' ? (
              <WeeklyCalendar
                sessions={plannerSessions}
                windowDays={60}
                onSelect={(s) => {
                  const slot = byId.get(s.id)
                  if (slot) setSelected(slot)
                }}
              />
            ) : (
              <div className="space-y-3">
                {visibleSlots.map((slot) => (
                  <SlotRow key={slot.id} slot={slot} onSelect={setSelected} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Nothing at all */}
        {!loading && teamId && !hasSlots && !hasWindows && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('noSlots')}</p>
            <p className="text-sm mt-1">{t('noSlotsHint')}</p>
          </div>
        )}
      </div>

      {/* Fixed-slot booking */}
      {selected && teamId && (
        <BookingModal
          key={selected.id}
          title={selected.activityName}
          isFreeTrial={selected.isFreeTrial}
          coachName={selected.coachName}
          location={selected.location}
          onlineUrl={selected.onlineUrl}
          dateLine={`${fmtDate(selected.start)} · ${fmtTime(selected.start)} – ${fmtTime(selected.end)} · ${fmtDuration(selected.duration_minutes)}`}
          teamId={teamId}
          book={(args) =>
            httpsCallable(functions, 'bookSession')({ teamId, sessionId: selected.id, ...args }).then(() => undefined)
          }
          onBooked={({ email }) => { setSelected(null); setConfirmed({ email }) }}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Open-window booking */}
      {windowBooking && teamId && (
        <BookingModal
          key={`${windowBooking.templateId}-${windowBooking.startMs}-${windowBooking.durationMinutes}`}
          title={windowBooking.title}
          isFreeTrial={windowBooking.isFreeTrial}
          coachName={windowBooking.coachName}
          location={windowBooking.location}
          onlineUrl={windowBooking.onlineUrl}
          dateLine={`${fmtDate(windowBooking.startMs)} · ${fmtTime(windowBooking.startMs)} – ${fmtTime(windowBooking.startMs + windowBooking.durationMinutes * 60_000)} · ${fmtDuration(windowBooking.durationMinutes)}`}
          teamId={teamId}
          book={(args) =>
            httpsCallable(functions, 'bookAppointment')({
              teamId,
              templateId: windowBooking.templateId,
              coachId: windowBooking.coachId,
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
