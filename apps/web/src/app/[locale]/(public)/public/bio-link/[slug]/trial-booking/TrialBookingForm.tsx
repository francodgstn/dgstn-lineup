'use client'

import { useState, useEffect } from 'react'
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

// ─── types ───────────────────────────────────────────────────────────────────

interface SessionPublicProfile {
  id: string
  teamId: string
  activityId?: string
  activityName?: string
  start: Timestamp
  end: Timestamp
  allowBooking: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(start: Timestamp): string {
  return start.toDate().toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sessionDuration(start: Timestamp, end: Timestamp): string {
  const mins = Math.round((end.toDate().getTime() - start.toDate().getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── schema ───────────────────────────────────────────────────────────────────

const formSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email'),
  phone: z.string().max(30).optional(),
})

type FormValues = z.infer<typeof formSchema>

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  teamId: string
  teamName: string
}

type Step = 'select' | 'details' | 'confirmed'

export default function TrialBookingForm({ teamId, teamName }: Props) {
  const [sessions, setSessions] = useState<SessionPublicProfile[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedSession, setSelectedSession] = useState<SessionPublicProfile | null>(null)
  const [step, setStep] = useState<Step>('select')
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [confirmedActivity, setConfirmedActivity] = useState<string>('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  useEffect(() => {
    async function loadSessions() {
      try {
        const q = query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('allowBooking', '==', true),
          where('start', '>=', Timestamp.now()),
          orderBy('start', 'asc'),
          limit(50)
        )
        const snap = await getDocs(q)
        const list: SessionPublicProfile[] = snap.docs
          .map((d) => ({ ...d.data(), id: d.id }) as SessionPublicProfile)
          .filter((s) => s.start && s.end) // session public profiles have start/end
        setSessions(list)
      } catch (err) {
        console.error('Error loading sessions', err)
      } finally {
        setLoadingSessions(false)
      }
    }
    loadSessions()
  }, [teamId])

  const onSubmit = async (values: FormValues) => {
    if (!selectedSession) return
    setBookingError(null)

    try {
      const bookSession = httpsCallable(functions, 'bookSession')
      await bookSession({
        teamId,
        sessionId: selectedSession.id,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          email: values.email,
          phone: values.phone || null,
        },
      })
      setConfirmedActivity(selectedSession.activityName || 'Session')
      setStep('confirmed')
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.code === 'already-exists') {
        setBookingError('You are already registered for this session.')
      } else {
        setBookingError(e.message || 'An error occurred. Please try again.')
      }
    }
  }

  // ── Session selection ──────────────────────────────────────────────────────
  if (step === 'select') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Book a Trial Class</h1>
          <p className="text-muted-foreground mt-1">Choose an available session at {teamName}.</p>
        </div>

        {loadingSessions && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl border bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {!loadingSessions && sessions.length === 0 && (
          <div className="rounded-xl border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground">No sessions currently available for booking.</p>
          </div>
        )}

        {!loadingSessions && sessions.length > 0 && (
          <div className="space-y-3">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedSession(s)
                  setStep('details')
                }}
                className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors flex items-center justify-between gap-4 group"
              >
                <div>
                  <p className="font-semibold">{s.activityName || 'Session'}</p>
                  <p className="text-sm text-muted-foreground">{formatDateTime(s.start)}</p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{sessionDuration(s.start, s.end)}</span>
                  <span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Select →
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Contact details form ───────────────────────────────────────────────────
  if (step === 'details' && selectedSession) {
    return (
      <div className="space-y-6">
        <div>
          <button
            onClick={() => setStep('select')}
            className="text-sm text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold">Your details</h1>
          <p className="text-muted-foreground mt-1">
            Booking: <strong>{selectedSession.activityName || 'Session'}</strong> on{' '}
            {formatDateTime(selectedSession.start)}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">First name</label>
              <input
                type="text"
                {...register('firstname')}
                autoComplete="given-name"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {errors.firstname && (
                <p className="text-xs text-destructive">{errors.firstname.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Last name</label>
              <input
                type="text"
                {...register('lastname')}
                autoComplete="family-name"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {errors.lastname && (
                <p className="text-xs text-destructive">{errors.lastname.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              {...register('email')}
              autoComplete="email"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Phone <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="tel"
              {...register('phone')}
              autoComplete="tel"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {bookingError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {bookingError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Booking…' : 'Confirm Booking'}
          </button>
        </form>
      </div>
    )
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (step === 'confirmed') {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Booking Confirmed!</h1>
          <p className="text-muted-foreground mt-2">
            Your trial <strong>{confirmedActivity}</strong> class at <strong>{teamName}</strong> has
            been booked. Check your email for a confirmation.
          </p>
        </div>
        <button
          onClick={() => {
            setStep('select')
            setSelectedSession(null)
          }}
          className="text-sm text-primary hover:underline"
        >
          Book another class
        </button>
      </div>
    )
  }

  return null
}
