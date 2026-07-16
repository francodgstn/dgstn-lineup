'use client'

// Walk-in registration overlay — a kiosk-shaped adaptation of
// trial-booking/TrialBookingForm.tsx's session → details → confirmed flow, reusing
// the same bookSession callable payload shape. The provided Kiosk.walkInNameLabel
// copy ("Full name") calls for a single name field rather than TrialBookingForm's
// first/last split, so the single value is split on the first space before it's
// sent to bookSession (which requires firstname + lastname separately).
//
// PRIVACY: this component keeps NO persistence of its own — no localStorage, no
// cookies. All form state is plain React state and is fully discarded on
// successful submit (reset()) and whenever the kiosk enters standby (KioskApp
// force-remounts this component via a `key` bump, which throws away all local
// state as a side effect of the unmount/remount).
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { useTranslations } from 'next-intl'
import { X, ChevronLeft, UserPlus, CheckCircle2 } from 'lucide-react'
import { functions } from '@/lib/firebase'
import type { KioskSession } from './useKioskSessions'

const formSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
})

type FormValues = z.infer<typeof formSchema>

type Step = 'select' | 'details' | 'confirmed'

interface Props {
  teamId: string
  sessions: KioskSession[]
  walkInActivityIds?: string[]
}

const fmtDateTime = (d: Date) =>
  d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// bookSession requires firstname + lastname separately; split the single "Full
// name" field on the first space (mirrors the common quick-signup convention).
function splitName(fullName: string): { firstname: string; lastname: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ')
  const idx = trimmed.indexOf(' ')
  if (idx === -1) return { firstname: trimmed, lastname: trimmed }
  return { firstname: trimmed.slice(0, idx), lastname: trimmed.slice(idx + 1) }
}

export default function WalkIn({ teamId, sessions, walkInActivityIds }: Props) {
  const t = useTranslations('Kiosk')
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [selected, setSelected] = useState<KioskSession | null>(null)
  const [confirmedActivity, setConfirmedActivity] = useState('')
  const [bookingError, setBookingError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  const eligible = useMemo(() => {
    const now = Date.now()
    const restrict = walkInActivityIds && walkInActivityIds.length > 0
    return sessions
      // Appointments are availability-only and exist only once booked — there is
      // no such thing as an open, walk-in-able appointment slot any more. Only
      // group classes are eligible for walk-in registration.
      .filter((s) => s.type !== 'appointment_session')
      .filter((s) => s.end.toDate().getTime() > now)
      .filter((s) => !restrict || (s.activityId && walkInActivityIds!.includes(s.activityId)))
  }, [sessions, walkInActivityIds])

  // Group eligible sessions per day for the horizontal day-chip picker.
  const days = useMemo(() => {
    const map = new Map<string, { key: string; date: Date; sessions: KioskSession[] }>()
    for (const s of eligible) {
      const d = s.start.toDate()
      const key = dayKey(d)
      let g = map.get(key)
      if (!g) {
        g = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), sessions: [] }
        map.set(key, g)
      }
      g.sessions.push(s)
    }
    return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [eligible])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // Fall back to the first (nearest) day when nothing is picked / the pick is stale.
  const activeDay = days.find((d) => d.key === selectedDay) ?? days[0]

  function resetAll() {
    setStep('select')
    setSelected(null)
    setConfirmedActivity('')
    setBookingError(null)
    resetForm()
  }

  function close() {
    setOpen(false)
    resetAll()
  }

  const onSubmit = async (values: FormValues) => {
    if (!selected) return
    setBookingError(null)
    try {
      const { firstname, lastname } = splitName(values.name)
      const bookSession = httpsCallable(functions, 'bookSession')
      await bookSession({
        teamId,
        sessionId: selected.id,
        contactDetails: {
          firstname,
          lastname,
          email: values.email,
          phone: values.phone || null,
        },
      })
      setConfirmedActivity(selected.activityName || '')
      setStep('confirmed')
      resetForm()
    } catch {
      setBookingError(t('walkInError'))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] sm:bottom-10 sm:right-10"
      >
        <UserPlus className="h-5 w-5" />
        {t('walkInCta')}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        {step === 'details' ? (
          <button
            type="button"
            onClick={() => setStep('select')}
            className="flex items-center gap-1 text-muted-foreground transition-opacity hover:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-y-auto px-6 py-8">
        {step === 'select' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">{t('walkInTitle')}</h1>
              <p className="mt-1 text-muted-foreground">{t('walkInPickSession')}</p>
            </div>
            {eligible.length === 0 ? (
              <div className="rounded-xl border bg-muted/30 p-8 text-center text-muted-foreground">
                {t('noUpcoming')}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Day picker — horizontally scrollable chips */}
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {days.map((g) => {
                    const isActive = g.key === activeDay?.key
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setSelectedDay(g.key)}
                        className={`flex shrink-0 flex-col items-center rounded-xl border px-4 py-2 transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="text-xs font-medium uppercase tracking-wide">
                          {g.date.toLocaleDateString(undefined, { weekday: 'short' })}
                        </span>
                        <span className="text-lg font-bold tabular-nums">{g.date.getDate()}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Sessions for the selected day */}
                <div className="space-y-3">
                  {activeDay?.sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelected(s)
                        setStep('details')
                      }}
                      className="flex w-full items-center justify-between gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <div>
                        <p className="font-semibold">
                          {s.activityName ?? 'Session'}
                          {s.providerName ? ` · ${s.providerName}` : ''}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {fmtTime(s.start.toDate())}
                          {s.location ? ` · ${s.location}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'details' && selected && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">{t('walkInTitle')}</h1>
              <p className="mt-1 text-muted-foreground">
                {selected.activityName ?? 'Session'}
                {selected.providerName ? ` · ${selected.providerName}` : ''} ·{' '}
                {fmtDateTime(selected.start.toDate())}
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('walkInNameLabel')}</label>
                <input
                  type="text"
                  {...register('name')}
                  autoComplete="off"
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {errors.name && <p className="text-xs text-destructive">{t('walkInError')}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">{t('walkInEmailLabel')}</label>
                <input
                  type="email"
                  {...register('email')}
                  autoComplete="off"
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {errors.email && <p className="text-xs text-destructive">{t('walkInError')}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">{t('walkInPhoneLabel')}</label>
                <input
                  type="tel"
                  {...register('phone')}
                  autoComplete="off"
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {bookingError && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {bookingError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting ? t('walkInSubmitting') : t('walkInSubmit')}
              </button>
            </form>
          </div>
        )}

        {step === 'confirmed' && (
          <div className="flex flex-1 flex-col items-center justify-center space-y-6 py-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">{t('registered')}</h1>
              {confirmedActivity && <p className="mt-2 text-muted-foreground">{confirmedActivity}</p>}
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full bg-primary px-8 py-3 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              {t('startOver')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
