'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collectionGroup, query, where, orderBy, limit,
  getDocs, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarClock, MapPin, Video, Clock, User, Check, Lock } from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

interface PublicSlot {
  id: string           // the session ID (parent of the public_profile doc)
  activityName: string | null
  coachName: string | null
  start: number        // milliseconds
  end: number          // milliseconds
  duration_minutes: number
  max_participants: number
  bookings_count: number
  location: string | null
  onlineUrl: string | null
  isFreeTrial: boolean
  status: 'open' | 'full' | 'cancelled'
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── booking form schema ──────────────────────────────────────────────────────

const bookingSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Enter a valid email'),
  phone: z.string().max(30).optional(),
})
type BookingFormValues = z.infer<typeof bookingSchema>

const emailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})
type EmailValues = z.infer<typeof emailSchema>

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})
type CodeValues = z.infer<typeof codeSchema>

// ─── slot card (open / members-only) ─────────────────────────────────────────

function SlotCard({
  slot,
  teamId,
  onBooked,
}: {
  slot: PublicSlot
  teamId: string
  onBooked: (details: { firstname: string; email: string }) => void
}) {
  const t = useTranslations('CoachingPortal')
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Members-only verification state
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

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
  })
  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })

  async function onSubmitGuest(data: BookingFormValues) {
    setError(null)
    try {
      const fn = httpsCallable(functions, 'bookSession')
      await fn({
        teamId,
        sessionId: slot.id,
        contactDetails: {
          firstname: data.firstname,
          lastname: data.lastname,
          email: data.email,
          phone: data.phone || undefined,
        },
      })
      onBooked({ firstname: data.firstname, email: data.email })
    } catch (err) {
      const e = err as { code?: string; message?: string }
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
        setError('No registered account found for this email. Please contact your coach to join.')
        return
      }
      setReturningEmail(values.email)
      setCodeId(result.data.codeId)
      setCountdown(60)
      setVerifyStep('code')
    } catch (err) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to send code. Please try again.')
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
      if (!contactId) { setError('Could not determine your account. Please try again.'); return }

      const bookFn = httpsCallable(functions, 'bookSession')
      await bookFn({
        teamId,
        sessionId: slot.id,
        authenticatedContactId: contactId,
        verificationCodeId: result.data.codeId,
      })
      onBooked({ firstname: returningEmail.split('@')[0], email: returningEmail })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'already-exists') setError(t('errorAlreadyBooked'))
      else if (e.code === 'permission-denied') setError(e.message || 'Members only. Please contact your coach.')
      else setError(e.message || 'Incorrect code. Please try again.')
    }
  }

  async function onResendCode() {
    if (countdown > 0) return
    setError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions, 'sendBookingVerificationCode',
      )
      const result = await fn({ email: returningEmail, teamId })
      setCodeId(result.data.codeId)
      setCountdown(60)
      codeForm.reset()
    } catch (err) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to resend code.')
    }
  }

  const isFull = slot.status === 'full' || slot.bookings_count >= slot.max_participants

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{slot.activityName}</p>
            {!slot.isFreeTrial && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Lock className="h-2.5 w-2.5" />
                Members only
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{formatDate(slot.start)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />{formatTime(slot.start)} – {formatTime(slot.end)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 opacity-0" />{formatDuration(slot.duration_minutes)}
            </span>
            {slot.coachName && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />{slot.coachName}
              </span>
            )}
            {slot.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />{slot.location}
              </span>
            )}
            {slot.onlineUrl && (
              <span className="flex items-center gap-1">
                <Video className="h-3 w-3" />{t('onlineSession')}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isFull ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">{t('full')}</span>
          ) : (
            <Button size="sm" onClick={() => { setExpanded((v) => !v); setError(null) }} variant={expanded ? 'outline' : 'default'}>
              {expanded ? t('hideForm') : t('book')}
            </Button>
          )}
        </div>
      </div>

      {expanded && !isFull && (
        <div className="border-t bg-muted/30 px-4 pb-4 pt-3">

          {/* ── Guest booking form (isFreeTrial) ── */}
          {slot.isFreeTrial && (
            <form onSubmit={handleSubmit(onSubmitGuest)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`fn-${slot.id}`} className="text-xs">{t('fieldFirstname')}</Label>
                  <Input id={`fn-${slot.id}`} {...register('firstname')} />
                  {errors.firstname && <p className="text-destructive text-xs">{errors.firstname.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`ln-${slot.id}`} className="text-xs">{t('fieldLastname')}</Label>
                  <Input id={`ln-${slot.id}`} {...register('lastname')} />
                  {errors.lastname && <p className="text-destructive text-xs">{errors.lastname.message}</p>}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`em-${slot.id}`} className="text-xs">{t('fieldEmail')}</Label>
                <Input id={`em-${slot.id}`} type="email" {...register('email')} />
                {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`ph-${slot.id}`} className="text-xs">{t('fieldPhone')}</Label>
                <Input id={`ph-${slot.id}`} type="tel" {...register('phone')} />
              </div>
              {error && (
                <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>{t('cancel')}</Button>
                <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? t('submitting') : t('submit')}</Button>
              </div>
            </form>
          )}

          {/* ── Members-only: email step ── */}
          {!slot.isFreeTrial && verifyStep === 'email' && (
            <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-3">
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                This slot is for registered members only. Enter your email to verify.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Email address</Label>
                <Input type="email" {...emailForm.register('email')} autoComplete="email" placeholder="your@email.com" />
                {emailForm.formState.errors.email && (
                  <p className="text-destructive text-xs">{emailForm.formState.errors.email.message}</p>
                )}
              </div>
              {error && <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>{t('cancel')}</Button>
                <Button type="submit" size="sm" disabled={emailForm.formState.isSubmitting}>
                  {emailForm.formState.isSubmitting ? 'Sending…' : 'Send verification code'}
                </Button>
              </div>
            </form>
          )}

          {/* ── Members-only: code step ── */}
          {!slot.isFreeTrial && verifyStep === 'code' && (
            <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                We sent a 6-digit code to <strong>{returningEmail}</strong>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Verification code</Label>
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
              {error && <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">{error}</p>}
              <div className="flex justify-between items-center">
                <button type="button" onClick={onResendCode} disabled={countdown > 0}
                  className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                  {countdown > 0 ? `Resend in ${countdown}s` : "Didn't receive it? Resend"}
                </button>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setVerifyStep('email'); setError(null); codeForm.reset() }}>Back</Button>
                  <Button type="submit" size="sm" disabled={codeForm.formState.isSubmitting}>
                    {codeForm.formState.isSubmitting ? 'Verifying…' : 'Confirm booking'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ─── confirmation screen ──────────────────────────────────────────────────────

function ConfirmationScreen({ firstname, email }: { firstname: string; email: string }) {
  const t = useTranslations('CoachingPortal')
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

// ─── main component ───────────────────────────────────────────────────────────

export default function CoachingPortal({ slug }: { slug: string }) {
  const t = useTranslations('CoachingPortal')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState<{ firstname: string; email: string } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        // 1. Resolve teamId from the team's public_profile
        const teamQ = query(
          collectionGroup(db, 'public_profile'),
          where('slug', '==', slug),
          where('type', '==', 'team'),
          limit(1),
        )
        const teamSnap = await getDocs(teamQ)
        if (teamSnap.empty) { setSlots([]); setLoading(false); return }
        const resolvedTeamId = teamSnap.docs[0].ref.parent.parent!.id
        setTeamId(resolvedTeamId)

        // 2. Fetch upcoming open coaching sessions via sessions/{id}/public_profile
        const now = Timestamp.now()
        const windowEnd = Timestamp.fromMillis(now.toMillis() + 60 * 24 * 60 * 60_000)
        const slotsQ = query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', resolvedTeamId),
          where('type', '==', 'coaching_session'),
          where('status', '==', 'open'),
          where('start', '>=', now),
          where('start', '<=', windowEnd),
          orderBy('start', 'asc'),
          limit(50),
        )
        const slotsSnap = await getDocs(slotsQ)
        const loadedSlots: PublicSlot[] = slotsSnap.docs.map((d) => {
          const s = d.data()
          // sessionId is the parent doc's ID (sessions/{sessionId}/public_profile/{sessionId})
          const sessionId = d.ref.parent.parent!.id
          return {
            id: sessionId,
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
        setSlots(loadedSlots)
      } catch {
        setSlots([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [slug])

  if (confirmed) {
    return <ConfirmationScreen firstname={confirmed.firstname} email={confirmed.email} />
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        )}

        {/* Team not found */}
        {!loading && !teamId && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('teamNotFound')}</p>
          </div>
        )}

        {/* No slots */}
        {!loading && teamId && slots?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('noSlots')}</p>
            <p className="text-sm mt-1">{t('noSlotsHint')}</p>
          </div>
        )}

        {/* Slot list */}
        {teamId && slots && slots.length > 0 && (
          <div className="space-y-3">
            {slots.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                teamId={teamId}
                onBooked={({ firstname, email }) => setConfirmed({ firstname, email })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
