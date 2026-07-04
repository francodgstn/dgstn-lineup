'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
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
import { resolveActivityAccessRule, compareActivities, type ActivityAccessRule } from '@linyup/shared'
import { useLocale, useTranslations } from 'next-intl'
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  isToday,
  isAfter,
  startOfDay,
  format,
} from 'date-fns'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BioLinkShell, BioLinkButton } from '../BioLinkShell'
import { usePublicTeam } from '../PublicTeamProvider'

// ─── types ───────────────────────────────────────────────────────────────────

interface ActivityProfile {
  id: string
  name: string
  slug: string
  description?: string
  image?: string | null
  color?: string
  level?: string
  isFreeTrial?: boolean
  order?: number
  accessRule?: ActivityAccessRule
  dropIn?: { enabled: boolean; priceAmount?: number }
}

interface SessionProfile {
  id: string
  teamId: string
  activityId?: string
  activityName?: string
  activitySlug?: string
  activityColor?: string
  activityImage?: string | null
  activityLevel?: string
  activityIsFreeTrial?: boolean
  start: Timestamp
  end: Timestamp
  location?: string
  instructorName?: string
  locationAddress?: string
  locationMapsUrl?: string
  allowBooking: boolean
  bookingMandatory?: boolean
  max_participants?: number
  bookings_count?: number
}

interface MatchedContact {
  id: string
  firstname: string
  lastname: string
  phone: string
}

interface ContactData {
  id: string
  firstname: string
  lastname: string
  email: string
  phone: string
}

type Step =
  | 'activities'
  | 'sessions'
  | 'who'
  | 'ret-email'
  | 'ret-code'
  | 'ret-select'
  | 'details'
  | 'confirmed'

// ─── helpers ─────────────────────────────────────────────────────────────────

function toDateKey(ts: Timestamp): string {
  const d = ts.toDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateKeyToDate(key: string): Date {
  return new Date(key + 'T00:00:00')
}

function formatDate(ts: Timestamp, locale?: string): string {
  return ts.toDate().toLocaleDateString(locale ?? [], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatTime(ts: Timestamp): string {
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function sessionDuration(
  start: Timestamp,
  end: Timestamp,
  t: ReturnType<typeof useTranslations>
): string {
  const mins = Math.round((end.toDate().getTime() - start.toDate().getTime()) / 60000)
  if (mins < 60) return t('durationMinutes', { mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? t('durationHoursMinutes', { h, m }) : t('durationHours', { h })
}

function activityGradient(name: string): string {
  const colors = [
    '#6366f1',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
  ]
  const i = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  return `linear-gradient(135deg, ${colors[i]}, ${colors[(i + 2) % colors.length]})`
}

const FITNESS_APPS = ['Fitpass', 'ClassPass', 'Urban Sports Club', 'Gymlib', 'Wellhub', 'Other']

// ─── schemas ─────────────────────────────────────────────────────────────────

function createNewGuestSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    firstname: z.string().min(1, t('errorRequired')).max(60),
    lastname: z.string().min(1, t('errorRequired')).max(60),
    email: z.string().email(t('errorInvalidEmail')),
    phone: z.string().max(30).optional(),
    aggregatorApp: z.string().optional(),
  })
}

function createEmailSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    email: z.string().email(t('errorInvalidEmailAddress')),
  })
}

function createCodeSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    code: z.string().regex(/^\d{6}$/, t('errorEnterCode')),
  })
}

type NewGuestValues = z.infer<ReturnType<typeof createNewGuestSchema>>
type EmailValues = z.infer<ReturnType<typeof createEmailSchema>>
type CodeValues = z.infer<ReturnType<typeof createCodeSchema>>

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  slug: string
  preSelectedActivitySlug?: string
  initialDate?: string
}

// ─── MiniCalendar ─────────────────────────────────────────────────────────────

interface MiniCalendarProps {
  availableDates: string[] // YYYY-MM-DD keys
  selectedDate: string | null
  onSelect: (dateKey: string) => void
  maxDateKey: string // YYYY-MM-DD, last bookable date
}

function MiniCalendar({ availableDates, selectedDate, onSelect, maxDateKey }: MiniCalendarProps) {
  const t = useTranslations('PublicBooking')
  const initialMonth = useMemo(() => {
    if (availableDates.length > 0) return dateKeyToDate(availableDates[0])
    return new Date()
  }, [availableDates])

  const [currentMonth, setCurrentMonth] = useState(initialMonth)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Mon=0 offset
  const firstDow = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1
  const paddedDays = [...Array(firstDow).fill(null), ...days]
  while (paddedDays.length % 7 !== 0) paddedDays.push(null)

  const maxDate = dateKeyToDate(maxDateKey)
  const isAtMax = isAfter(startOfMonth(addMonths(currentMonth, 1)), startOfMonth(maxDate))
  const today = startOfDay(new Date())
  const isAtStart = !isAfter(currentMonth, today)

  const availableSet = new Set(availableDates)
  const WEEKDAYS = [
    t('weekdayMon'),
    t('weekdayTue'),
    t('weekdayWed'),
    t('weekdayThu'),
    t('weekdayFri'),
    t('weekdaySat'),
    t('weekdaySun'),
  ]

  return (
    <div className="select-none">
      {/* Month header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          disabled={isAtStart}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-30"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold">{format(currentMonth, 'MMMM yyyy')}</span>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          disabled={isAtMax}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-30"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {isAtMax && (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-2 py-1 mb-2 text-center">
          {t('showingBookableWindowOnly')}
        </p>
      )}

      {/* Weekday labels */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-xs text-muted-foreground py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {paddedDays.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />
          const key = toDateKey(Timestamp.fromDate(day))
          const available = availableSet.has(key)
          const isSelected = selectedDate === key
          const isTodayDay = isToday(day)

          return (
            <button
              key={key}
              onClick={() => available && onSelect(key)}
              disabled={!available}
              className={[
                'aspect-square rounded-full text-xs font-medium transition-all flex items-center justify-center mx-auto w-8 h-8',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm scale-110'
                  : available
                    ? 'hover:bg-primary/10 hover:text-primary cursor-pointer'
                    : 'text-muted-foreground/40 cursor-default',
                isTodayDay && !isSelected ? 'ring-1 ring-primary/40' : '',
              ].join(' ')}
              style={undefined}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── StickyBar ────────────────────────────────────────────────────────────────

interface StickyBarProps {
  activity: ActivityProfile
  session: SessionProfile | null
  accentColor: string | null
  showConfirm: boolean
  submitting: boolean
  onConfirm: () => void
}

function StickyBar({
  activity,
  session,
  accentColor,
  showConfirm,
  submitting,
  onConfirm,
}: StickyBarProps) {
  const t = useTranslations('PublicBooking')
  const bg = activity.image ? `url("${activity.image}")` : activityGradient(activity.name)

  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-2xl z-[100] flex items-center gap-3 p-3 sm:p-4 rounded-t-2xl border border-b-0 bg-background/95 backdrop-blur-md"
      style={{
        boxShadow: '0 -8px 32px rgba(0,0,0,0.10), 0 -2px 8px rgba(0,0,0,0.06)',
        animation: 'slideUpBar 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <style>{`
        @keyframes slideUpBar {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Activity thumbnail */}
      <div
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg shrink-0 bg-muted"
        style={{
          background: bg,
          backgroundSize: activity.image ? 'cover' : '100% 100%',
          backgroundPosition: 'center',
        }}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{activity.name}</p>
        {session?.instructorName && (
          <p className="text-xs text-muted-foreground italic">
            {t('withInstructor', { name: session.instructorName })}
          </p>
        )}
        {session && (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg
                className="h-3 w-3 shrink-0 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>
                {formatDate(session.start)} · {formatTime(session.start)}–{formatTime(session.end)}
              </span>
            </div>
            {session.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <svg
                  className="h-3 w-3 shrink-0 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span className="truncate">{session.location}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm button */}
      {showConfirm && (
        <button
          onClick={onConfirm}
          disabled={submitting}
          style={accentColor ? { backgroundColor: accentColor } : undefined}
          className="shrink-0 rounded-xl bg-primary text-primary-foreground font-semibold px-5 py-2.5 text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {submitting ? t('ctaBooking') : t('ctaConfirm')}
        </button>
      )}
    </div>
  )
}

// ─── component ───────────────────────────────────────────────────────────────

export default function BookingForm({ slug, preSelectedActivitySlug, initialDate }: Props) {
  // Team already resolved once by the parent PublicTeamProvider (the layout).
  const { teamId, team } = usePublicTeam()
  const locale = useLocale()
  const t = useTranslations('PublicBooking')
  const teamName = team.name || ''
  const accentColor = team.bioLinkAccentColor ?? null
  const bookingSettings = team.bookingSettings
  const showBranding = team.showBranding === true

  const bookingWindowMonths = bookingSettings?.windowMonths ?? 2
  const showPhone = bookingSettings?.showPhone !== false
  const showDesc = bookingSettings?.showActivityDescription !== false
  const showFitnessApp = bookingSettings?.showFitnessAppField === true

  // Data loading
  const [activities, setActivities] = useState<ActivityProfile[]>([])
  const [sessions, setSessions] = useState<SessionProfile[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Flow state
  const [step, setStep] = useState<Step>('activities')
  const [selectedActivity, setSelectedActivity] = useState<ActivityProfile | null>(null)
  const [selectedSession, setSelectedSession] = useState<SessionProfile | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Returning member state
  const [returningEmail, setReturningEmail] = useState('')
  const [returningCodeId, setReturningCodeId] = useState('')
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([])
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [verifiedContactData, setVerifiedContactData] = useState<ContactData | null>(null) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [countdown, setCountdown] = useState(0)
  const [returningError, setReturningError] = useState<string | null>(null)

  // Confirmation
  const [confirmedSession, setConfirmedSession] = useState<SessionProfile | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const newGuestSchema = useMemo(() => createNewGuestSchema(t), [t])
  const emailSchema = useMemo(() => createEmailSchema(t), [t])
  const codeSchema = useMemo(() => createCodeSchema(t), [t])

  const guestForm = useForm<NewGuestValues>({ resolver: zodResolver(newGuestSchema) })
  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })

  // Ref to trigger guest form submit from the sticky bar
  const triggerGuestSubmit = useRef<(() => void) | undefined>(undefined)

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return
    const timeoutId = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timeoutId)
  }, [countdown])

  // Load activities + sessions for the resolved team
  useEffect(() => {
    async function loadData() {
      try {
        const windowMonths = bookingSettings?.windowMonths ?? 2

        // Load activities
        const actQ = query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('type', '==', 'activity')
        )
        const actSnap = await getDocs(actQ)
        const actList: ActivityProfile[] = actSnap.docs
          .map((d) => {
            const data = d.data()
            return {
              id: d.id,
              name: data.name || '',
              slug: data.slug || '',
              description: data.description ?? undefined,
              image: data.image_url ?? null,
              color: data.color ?? undefined,
              level: data.level ?? undefined,
              isFreeTrial: data.isFreeTrial ?? false,
              order: typeof data.order === 'number' ? data.order : undefined,
              accessRule: data.accessRule ?? undefined,
              dropIn: data.dropIn ?? undefined,
            }
          })
          .sort(compareActivities)
        setActivities(actList)

        // Load sessions
        const windowEnd = new Date()
        windowEnd.setDate(windowEnd.getDate() + windowMonths * 30)

        const sessQ = query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('type', '==', 'session'),
          where('allowBooking', '==', true),
          where('start', '>=', Timestamp.now()),
          orderBy('start', 'asc'),
          limit(100)
        )
        const sessSnap = await getDocs(sessQ)
        const sessList: SessionProfile[] = sessSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }) as SessionProfile)
          .filter((s) => s.start && s.end && s.start.toDate() <= windowEnd)
        setSessions(sessList)

        // Determine initial step / auto-select
        if (preSelectedActivitySlug) {
          const matched = actList.find((a) => a.slug === preSelectedActivitySlug)
          if (matched) {
            setSelectedActivity(matched)
            setStep('sessions')
          } else {
            setStep(actList.length === 1 ? 'sessions' : 'activities')
            if (actList.length === 1) setSelectedActivity(actList[0])
          }
        } else if (actList.length === 1) {
          setSelectedActivity(actList[0])
          setStep('sessions')
        } else {
          setStep('activities')
        }
      } catch (err) {
        console.error('Error loading booking data', err)
      } finally {
        setLoadingData(false)
      }
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  // Sessions filtered by selected activity
  const activitySessions = useMemo(() => {
    if (!selectedActivity) return sessions
    return sessions.filter(
      (s) => s.activityId === selectedActivity.id || s.activitySlug === selectedActivity.slug
    )
  }, [sessions, selectedActivity])

  const availableDates: string[] = useMemo(
    () => Array.from(new Set(activitySessions.map((s) => toDateKey(s.start)))).sort(),
    [activitySessions]
  )

  const maxDateKey = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + bookingWindowMonths * 30)
    return toDateKey(Timestamp.fromDate(d))
  }, [bookingWindowMonths])

  // Set default selected date
  useEffect(() => {
    if (availableDates.length === 0) return
    const candidate =
      initialDate && availableDates.includes(initialDate) ? initialDate : availableDates[0]
    setSelectedDate(candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActivity?.id, sessions.length])

  const filteredSessions = useMemo(
    () =>
      selectedDate
        ? activitySessions.filter((s) => toDateKey(s.start) === selectedDate)
        : activitySessions,
    [selectedDate, activitySessions]
  )

  // Drop-in (pay-per-class): a gated class where the studio lets uncovered contacts
  // pay a per-class fee to book. Members who are covered still book free via sign-in.
  const selectedDropInPrice =
    selectedActivity &&
    selectedActivity.isFreeTrial === false &&
    selectedActivity.dropIn?.enabled &&
    typeof selectedActivity.dropIn.priceAmount === 'number'
      ? selectedActivity.dropIn.priceAmount
      : null
  const dropInAvailable = selectedDropInPrice != null

  // ── Guest booking ─────────────────────────────────────────────────────────

  const onSubmitGuest = async (values: NewGuestValues) => {
    if (!selectedSession || !teamId) return
    setIsSubmitting(true)
    setBookingError(null)
    try {
      // Gated class with drop-in enabled → pay-per-class; the webhook confirms the
      // booking on payment success. Redirect to Stripe Checkout.
      if (dropInAvailable) {
        const fn = httpsCallable<Record<string, unknown>, { url?: string }>(
          functions,
          'createDropInCheckout'
        )
        const res = await fn({
          teamId,
          sessionId: selectedSession.id,
          contactDetails: {
            firstname: values.firstname,
            lastname: values.lastname,
            email: values.email,
            phone: showPhone ? values.phone || null : null,
          },
          slug,
          locale,
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        })
        const url = res.data?.url
        if (url) {
          window.location.href = url
          return
        }
        throw new Error(t('errorCheckoutFailed'))
      }

      const bookSessionFn = httpsCallable(functions, 'bookSession')
      await bookSessionFn({
        teamId,
        sessionId: selectedSession.id,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          email: values.email,
          phone: showPhone ? values.phone || null : null,
          aggregatorApp: showFitnessApp ? values.aggregatorApp || null : null,
        },
      })
      setConfirmedSession(selectedSession)
      setStep('confirmed')
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.code === 'already-exists') {
        setBookingError(t('errorAlreadyRegistered'))
      } else {
        setBookingError(e.message || t('errorGeneric'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // Wire up sticky bar trigger whenever onSubmitGuest changes
  useEffect(() => {
    triggerGuestSubmit.current = guestForm.handleSubmit(onSubmitGuest)
  })

  // ── Returning member ──────────────────────────────────────────────────────

  const onSendCode = async (values: EmailValues) => {
    if (!teamId) return
    setReturningError(null)
    try {
      const fn = httpsCallable<
        { email: string; teamId: string },
        { codeId: string; hasContacts?: boolean }
      >(functions, 'sendBookingVerificationCode')
      const result = await fn({ email: values.email, teamId })
      if (result.data.hasContacts === false) {
        const isMembersOnly = selectedActivity?.isFreeTrial === false
        setReturningError(
          isMembersOnly
            ? t('errorNoAccountMembersOnly')
            : t('errorNoAccountGeneral')
        )
        return
      }
      setReturningEmail(values.email)
      setReturningCodeId(result.data.codeId)
      setCountdown(60)
      setStep('ret-code')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setReturningError(e.message || t('errorSendCodeFailed'))
    }
  }

  const onVerifyCode = async (values: CodeValues) => {
    if (!selectedSession) return
    setReturningError(null)
    try {
      const fn = httpsCallable<
        { codeId: string; code: string },
        {
          verified: boolean
          codeId: string
          requiresContactSelection: boolean
          selectedContactId?: string
          contactData?: ContactData
          matchedContacts?: MatchedContact[]
        }
      >(functions, 'verifyBookingCode')
      const result = await fn({ codeId: returningCodeId, code: values.code })

      if (result.data.requiresContactSelection) {
        setMatchedContacts(result.data.matchedContacts ?? [])
        setStep('ret-select')
      } else {
        const cId = result.data.selectedContactId!
        setSelectedContactId(cId)
        setVerifiedContactData(result.data.contactData ?? null)
        await doAuthenticatedBooking(cId, returningCodeId, selectedSession)
      }
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.code === 'already-exists') {
        setReturningError(t('errorAlreadyRegistered'))
      } else {
        setReturningError(e.message || t('errorIncorrectCode'))
      }
    }
  }

  const onSelectContact = async (contactId: string) => {
    if (!selectedSession) return
    setReturningError(null)
    try {
      const fn = httpsCallable<
        { codeId: string; selectedContactId: string },
        { verified: boolean; codeId: string; selectedContactId?: string; contactData?: ContactData }
      >(functions, 'verifyBookingCode')
      const result = await fn({ codeId: returningCodeId, selectedContactId: contactId })
      const cId = result.data.selectedContactId!
      setSelectedContactId(cId)
      setVerifiedContactData(result.data.contactData ?? null)
      await doAuthenticatedBooking(cId, returningCodeId, selectedSession)
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.code === 'already-exists') {
        setReturningError(t('errorAlreadyRegistered'))
      } else {
        setReturningError(e.message || t('errorSelectContactFailed'))
      }
    }
  }

  async function doAuthenticatedBooking(
    contactId: string,
    codeId: string,
    session: SessionProfile
  ) {
    const bookSessionFn = httpsCallable(functions, 'bookSession')
    await bookSessionFn({
      teamId,
      sessionId: session.id,
      authenticatedContactId: contactId,
      verificationCodeId: codeId,
    })
    setConfirmedSession(session)
    setStep('confirmed')
  }

  const onResendCode = async () => {
    if (countdown > 0 || !teamId) return
    setReturningError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions,
        'sendBookingVerificationCode'
      )
      const result = await fn({ email: returningEmail, teamId })
      setReturningCodeId(result.data.codeId)
      setCountdown(60)
      codeForm.reset()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setReturningError(e.message || t('errorResendCodeFailed'))
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function backFromSessions() {
    if (preSelectedActivitySlug || activities.length === 1) {
      window.location.href = `/public/${slug}`
    } else {
      setStep('activities')
    }
  }

  function resetToStart() {
    setSelectedSession(null)
    setReturningEmail('')
    setReturningCodeId('')
    setMatchedContacts([])
    setSelectedContactId(null)
    setBookingError(null)
    setReturningError(null)
    codeForm.reset()
    guestForm.reset()
    if (preSelectedActivitySlug || activities.length === 1) {
      setStep('sessions')
    } else {
      setStep('activities')
    }
  }

  // ─── Common back button ───────────────────────────────────────────────────

  function BackButton({ onClick }: { onClick: () => void }) {
    const t = useTranslations('PublicBooking')
    return (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        {t('back')}
      </button>
    )
  }

  // ─── Sticky bar: shown on all non-activity, non-confirmed steps ───────────

  const showBar = selectedActivity && step !== 'activities' && step !== 'confirmed'
  const STICKY_H = 100

  function withBar(content: React.ReactNode, wide?: boolean) {
    return (
      <>
        <BioLinkShell
          teamName={teamName}
          slug={slug}
          accentColor={accentColor}
          wide={wide}
          stickyBarHeight={showBar ? STICKY_H : undefined}
          showBranding={showBranding}
        >
          {content}
        </BioLinkShell>
        {showBar && selectedActivity && (
          <StickyBar
            activity={selectedActivity}
            session={selectedSession}
            accentColor={accentColor}
            showConfirm={step === 'details'}
            submitting={isSubmitting}
            onConfirm={() => triggerGuestSubmit.current?.()}
          />
        )}
      </>
    )
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loadingData) {
    return (
      <BioLinkShell teamName="" slug={slug} accentColor={null} showBranding={showBranding}>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </BioLinkShell>
    )
  }

  // ─── Step: Activity selection ─────────────────────────────────────────────

  if (step === 'activities') {
    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div>
          <h1 className="text-2xl font-bold">{t('titleBookSession')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('chooseActivitySubtitle')}</p>
        </div>

        {activities.length === 0 && (
          <div className="rounded-xl border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground text-sm">{t('noActivitiesAvailable')}</p>
          </div>
        )}

        <div className="space-y-3">
          {activities.map((a) => {
            const hasSessions = sessions.some(
              (s) => s.activityId === a.id || s.activitySlug === a.slug
            )
            const bg = a.image
              ? `url("${a.image}")`
              : a.color
                ? `linear-gradient(135deg, ${a.color}cc, ${a.color}88)`
                : activityGradient(a.name)
            return (
              <button
                key={a.id}
                onClick={() => {
                  if (!hasSessions) return
                  setSelectedActivity(a)
                  setStep('sessions')
                }}
                disabled={!hasSessions}
                className="w-full text-left rounded-xl border bg-card hover:border-primary hover:bg-primary/5 transition-colors flex items-stretch overflow-hidden min-h-24 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {/* Thumbnail — square (1:1) for typical items via w-24 + item min-h-24 */}
                <div
                  className="w-24 shrink-0 bg-muted"
                  style={{
                    background: bg,
                    backgroundSize: a.image ? 'cover' : '100% 100%',
                    backgroundPosition: 'center',
                  }}
                />
                {/* Content */}
                <div className="flex-1 p-4 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="font-semibold text-sm leading-tight">{a.name}</p>
                    {(() => {
                      const rule = resolveActivityAccessRule(a)
                      if (rule.type === 'subscription')
                        return (
                          <span className="rounded-full bg-amber-100 text-amber-700 text-xs px-2 py-0.5 font-medium">
                            {t('badgeMembershipRequired')}
                          </span>
                        )
                      if (rule.type === 'members')
                        return (
                          <span className="rounded-full bg-blue-100 text-blue-700 text-xs px-2 py-0.5 font-medium">
                            {t('badgeMembersOnly')}
                          </span>
                        )
                      return a.isFreeTrial ? (
                        <span className="rounded-full bg-green-100 text-green-700 text-xs px-2 py-0.5 font-medium">
                          {t('badgeFreeTrial')}
                        </span>
                      ) : null
                    })()}
                    {a.level && (
                      <span className="rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5">
                        {a.level}
                      </span>
                    )}
                    {!hasSessions && (
                      <span className="rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5">
                        {t('badgeNoOpenSessions')}
                      </span>
                    )}
                  </div>
                  {showDesc && a.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {a.description}
                    </p>
                  )}
                </div>
                {hasSessions && (
                  <div className="flex items-center pr-4 text-muted-foreground">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </BioLinkShell>
    )
  }

  // ─── Step: Session selection (calendar + time slots) ─────────────────────

  if (step === 'sessions') {
    return withBar(
      <>
        <div>
          <BackButton onClick={backFromSessions} />
          <h1 className="text-2xl font-bold">
            {selectedActivity ? selectedActivity.name : t('titleSessionsFallback')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('pickDateTimeSubtitle')}</p>
        </div>

        {availableDates.length === 0 ? (
          <div className="rounded-xl border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {t('noSessionsAvailable')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 items-start">
            {/* Calendar */}
            <div className="bg-card border rounded-xl p-4">
              <MiniCalendar
                availableDates={availableDates}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                maxDateKey={maxDateKey}
              />
            </div>

            {/* Time slots */}
            <div>
              {selectedDate && (
                <p className="text-sm font-medium mb-3 text-muted-foreground">
                  {formatDateFull(dateKeyToDate(selectedDate))}
                </p>
              )}

              {filteredSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t('noSessionsOnDate')}</p>
              ) : (
                <div className="space-y-2">
                  {filteredSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSession(s)
                        // Members-only → sign in. But if drop-in is available, go to the
                        // chooser ('who') so a non-member can pay to book.
                        const gated = selectedActivity?.isFreeTrial === false
                        const nextStep = gated && !dropInAvailable ? 'ret-email' : 'who'
                        setStep(nextStep)
                      }}
                      className="w-full text-left rounded-xl border bg-card p-3.5 hover:border-primary hover:bg-primary/5 transition-colors flex items-stretch gap-3 group"
                    >
                      <div
                        className="w-1 rounded-full shrink-0"
                        style={{ background: s.activityColor || 'var(--primary)' }}
                      />
                      <div className="flex-1 min-w-0">
                        {!selectedActivity && s.activityName && (
                          <p className="text-xs font-medium text-muted-foreground mb-0.5">
                            {s.activityName}
                          </p>
                        )}
                        <p className="font-semibold text-sm">
                          {formatTime(s.start)} – {formatTime(s.end)}
                        </p>
                        <div className="flex flex-wrap gap-x-3 mt-0.5">
                          {s.instructorName && (
                            <p className="text-xs text-muted-foreground">{s.instructorName}</p>
                          )}
                          {s.location && (
                            <p className="text-xs text-muted-foreground">{s.location}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.bookingMandatory && (
                          <span className="text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary font-medium">
                            {t('bookingRequired')}
                          </span>
                        )}
                        <span className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                          {sessionDuration(s.start, s.end, t)}
                        </span>
                        <svg
                          className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </>,
      true // wide layout
    )
  }

  // ─── Step: Who? ───────────────────────────────────────────────────────────

  if (step === 'who' && selectedSession) {
    const isMembersOnly = selectedActivity?.isFreeTrial === false
    return withBar(
      <>
        <div>
          <BackButton onClick={() => setStep('sessions')} />
          <h1 className="text-2xl font-bold">{t('titleWhosBooking')}</h1>
        </div>

        <div className="space-y-3">
          {!isMembersOnly && (
            <button
              onClick={() => setStep('details')}
              className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors group flex items-center gap-3"
            >
              <div className="flex-1">
                <p className="font-semibold text-sm">{t('firstTimeTitle')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('firstTimeSubtitle')}</p>
              </div>
              <svg
                className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {isMembersOnly && dropInAvailable && (
            <button
              onClick={() => setStep('details')}
              className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors group flex items-center gap-3"
            >
              <div className="flex-1">
                <p className="font-semibold text-sm">{t('dropInTitle')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('dropInSubtitle', { price: selectedDropInPrice ?? 0 })}
                </p>
              </div>
              <svg
                className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setStep('ret-email')}
            className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors group flex items-center gap-3"
          >
            <div className="flex-1">
              <p className="font-semibold text-sm">{t('returningTitle')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('returningSubtitle')}
              </p>
            </div>
            <svg
              className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </>
    )
  }

  // ─── Step: Returning — enter email ────────────────────────────────────────

  if (step === 'ret-email' && selectedSession) {
    const isMembersOnly = selectedActivity?.isFreeTrial === false
    return withBar(
      <>
        <div>
          <BackButton
            onClick={() => {
              setStep(isMembersOnly ? 'sessions' : 'who')
              setReturningError(null)
              emailForm.reset()
            }}
          />
          <h1 className="text-2xl font-bold">{t('welcomeBackTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('welcomeBackSubtitle')}
          </p>
        </div>

        <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('labelEmailAddress')}</label>
            <input
              type="email"
              {...emailForm.register('email')}
              autoComplete="email"
              placeholder={t('placeholderEmailExample')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {emailForm.formState.errors.email && (
              <p className="text-xs text-destructive">{emailForm.formState.errors.email.message}</p>
            )}
          </div>
          {returningError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {returningError}
            </div>
          )}
          <BioLinkButton
            type="submit"
            disabled={emailForm.formState.isSubmitting}
            accentColor={accentColor}
          >
            {emailForm.formState.isSubmitting ? t('sendingEllipsis') : t('sendVerificationCode')}
          </BioLinkButton>
        </form>
      </>
    )
  }

  // ─── Step: Returning — verify code ───────────────────────────────────────

  if (step === 'ret-code' && selectedSession) {
    return withBar(
      <>
        <div>
          <BackButton
            onClick={() => {
              setStep('ret-email')
              setReturningError(null)
              codeForm.reset()
            }}
          />
          <h1 className="text-2xl font-bold">{t('checkEmailTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('sentCodeTo')} <strong>{returningEmail}</strong>
          </p>
        </div>

        <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('labelVerificationCode')}</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              {...codeForm.register('code', {
                onChange: (e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
                },
              })}
              placeholder={t('placeholderCode')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {codeForm.formState.errors.code && (
              <p className="text-xs text-destructive">{codeForm.formState.errors.code.message}</p>
            )}
          </div>
          {returningError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {returningError}
            </div>
          )}
          <BioLinkButton
            type="submit"
            disabled={codeForm.formState.isSubmitting}
            accentColor={accentColor}
          >
            {codeForm.formState.isSubmitting ? t('verifyingEllipsis') : t('confirmBookingCta')}
          </BioLinkButton>
        </form>

        <div className="text-center">
          <button
            onClick={onResendCode}
            disabled={countdown > 0}
            className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {countdown > 0 ? t('resendIn', { countdown }) : t('resendPrompt')}
          </button>
        </div>
      </>
    )
  }

  // ─── Step: Returning — select contact ────────────────────────────────────

  if (step === 'ret-select' && selectedSession) {
    return withBar(
      <>
        <div>
          <BackButton onClick={() => setStep('ret-code')} />
          <h1 className="text-2xl font-bold">{t('titleWhosBooking')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('multipleProfilesFound')}
          </p>
        </div>
        {returningError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {returningError}
          </div>
        )}
        <div className="space-y-3">
          {matchedContacts.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelectContact(c.id)}
              disabled={selectedContactId === c.id}
              className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <p className="font-semibold text-sm">
                {c.firstname} {c.lastname}
              </p>
              {c.phone && <p className="text-xs text-muted-foreground mt-0.5">{c.phone}</p>}
            </button>
          ))}
        </div>
      </>
    )
  }

  // ─── Step: New guest — contact details ───────────────────────────────────

  if (step === 'details' && selectedSession) {
    return withBar(
      <>
        <div>
          <BackButton onClick={() => setStep('who')} />
          <h1 className="text-2xl font-bold">{t('yourDetailsTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('detailsSubtitle')}
          </p>
        </div>

        <form
          id="guest-form"
          onSubmit={guestForm.handleSubmit(onSubmitGuest)}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('labelFirstName')} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                {...guestForm.register('firstname')}
                autoComplete="given-name"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {guestForm.formState.errors.firstname && (
                <p className="text-xs text-destructive">
                  {guestForm.formState.errors.firstname.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('labelLastName')} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                {...guestForm.register('lastname')}
                autoComplete="family-name"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {guestForm.formState.errors.lastname && (
                <p className="text-xs text-destructive">
                  {guestForm.formState.errors.lastname.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelEmail')} <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              {...guestForm.register('email')}
              autoComplete="email"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {guestForm.formState.errors.email && (
              <p className="text-xs text-destructive">{guestForm.formState.errors.email.message}</p>
            )}
          </div>

          {showPhone && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('labelPhone')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
              </label>
              <input
                type="tel"
                {...guestForm.register('phone')}
                autoComplete="tel"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {showFitnessApp && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t('labelFitnessApp')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
              </label>
              <Controller
                name="aggregatorApp"
                control={guestForm.control}
                render={({ field }) => (
                  <Select
                    value={field.value || '__none__'}
                    onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('notUsingFitnessApp')}</SelectItem>
                      {FITNESS_APPS.map((app) => (
                        <SelectItem key={app} value={app}>
                          {app}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          {bookingError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {bookingError}
            </div>
          )}

          {/* Hidden submit — triggered by sticky bar Confirm button */}
          <button type="submit" className="sr-only" aria-hidden="true">
            {t('srOnlySubmit')}
          </button>
        </form>

        <p className="text-xs text-muted-foreground">
          {t('consentText')}
        </p>
      </>
    )
  }

  // ─── Step: Confirmed ──────────────────────────────────────────────────────

  if (step === 'confirmed' && confirmedSession) {
    const ctaUrl = bookingSettings?.ctaUrl
    const ctaLabel = bookingSettings?.ctaLabel ?? t('ctaContactUsDefault')

    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div className="py-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t('bookingConfirmedTitle')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('bookingConfirmedSubtitle')}
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              {confirmedSession.activityColor && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: confirmedSession.activityColor }}
                />
              )}
              <span className="font-semibold">{confirmedSession.activityName || t('sessionFallback')}</span>
            </div>
            <div className="text-sm space-y-1.5 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{t('labelDate')}</span>
                {formatDate(confirmedSession.start)}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('labelTime')}</span>
                {formatTime(confirmedSession.start)} – {formatTime(confirmedSession.end)}
              </p>
              {confirmedSession.instructorName && (
                <p>
                  <span className="font-medium text-foreground">{t('labelInstructor')}</span>
                  {confirmedSession.instructorName}
                </p>
              )}
              {confirmedSession.location && (
                <p>
                  <span className="font-medium text-foreground">{t('labelLocation')}</span>
                  {confirmedSession.location}
                </p>
              )}
            </div>
          </div>

          {ctaUrl && (
            <a href={ctaUrl} target="_blank" rel="noopener noreferrer">
              <BioLinkButton accentColor={accentColor}>{ctaLabel}</BioLinkButton>
            </a>
          )}

          <button
            onClick={resetToStart}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            {t('bookAnotherSession')}
          </button>
        </div>
      </BioLinkShell>
    )
  }

  return null
}
