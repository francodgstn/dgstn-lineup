'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
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
import {
  resolveActivityAccessRule,
  compareActivities,
  activityRequiresSubscription,
  type ActivityAccessRule,
  type ActivityMemberBenefit,
} from '@linyup/shared'
import { resolveActivityPricingDisplay, type SubLookup } from '@/lib/activityTerms'
import { formatCurrency } from '@/lib/format'
import { useLocale, useTranslations } from 'next-intl'
import { BioLinkShell, BioLinkButton } from '../BioLinkShell'
import { usePublicTeam } from '../PublicTeamProvider'
import { MiniCalendar } from '@/components/booking/MiniCalendar'
import {
  GuestDetailsForm,
  type GuestDetailsFormHandle,
  type GuestDetailsValues,
} from '@/components/booking/GuestDetailsForm'
import {
  ReturningSignIn,
  type ContactData,
} from '@/components/booking/ReturningSignIn'
import { StickyBar, activityGradient } from '@/components/booking/StickyBar'
import { BackButton } from '@/components/booking/BackButton'

// ─── types ───────────────────────────────────────────────────────────────────

interface ActivityProfile {
  id: string
  name: string
  slug: string
  /** Session category — 'appointment' activities route to the appointment flow. */
  activityType?: string
  description?: string
  image?: string | null
  color?: string
  level?: string
  isFreeTrial?: boolean
  order?: number
  accessRule?: ActivityAccessRule
  dropIn?: { enabled: boolean; priceAmount?: number }
  /** CLASS-ONLY: a gated class still accepts a newcomer's free trial booking. */
  trialEnabled?: boolean
  /** CLASS-ONLY: reduced trial price (major units). Absent/null ⇒ the trial is
   *  FREE (today's behaviour); a number ⇒ the trial costs that instead. */
  trialPriceAmount?: number | null
  /** APPOINTMENT-ONLY: priced duration menu (member pricing stripped). */
  durations?: Array<{ minutes: number; priceAmount: number | null }>
  /** APPOINTMENT-ONLY: the one member-benefit rule, mirrored verbatim. */
  memberBenefit?: ActivityMemberBenefit
  prerequisites?: string
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
  providerName?: string
  locationAddress?: string
  locationMapsUrl?: string
  allowBooking: boolean
  bookingMandatory?: boolean
  max_participants?: number
  bookings_count?: number
}

// MatchedContact / ContactData now live in components/booking/ReturningSignIn
// (ContactData imported above; MatchedContact is an internal detail of that
// component, not needed here).

type Step =
  | 'activities'
  | 'sessions'
  | 'who'
  | 'returning'
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

// activityGradient now lives in components/booking/StickyBar (shared with the
// appointment picker) — imported above and reused by the activity cards below.

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  slug: string
  preSelectedActivitySlug?: string
  initialDate?: string
}

// MiniCalendar and StickyBar now live in components/booking/ (shared with the
// appointment picker) — imported at the top of this file.

// ─── component ───────────────────────────────────────────────────────────────

export default function BookingForm({ slug, preSelectedActivitySlug, initialDate }: Props) {
  // Team already resolved once by the parent PublicTeamProvider (the layout).
  const { teamId, team } = usePublicTeam()
  const locale = useLocale()
  const t = useTranslations('PublicBooking')
  const tShop = useTranslations('Shop')
  const teamName = team.name || ''
  const accentColor = team.bioLinkAccentColor ?? null
  const bookingSettings = team.bookingSettings
  const showBranding = team.showBranding === true
  const currency = team.default_currency ?? 'CHF'

  // Subscription plans (id → name + price label) for the activity cards' access
  // lines ("Included with Premium — CHF 89 / month"). Same source the shop reads:
  // the team public_profile's aggregator, already on `team` via PublicTeamProvider.
  const subLookup = useMemo<SubLookup>(() => {
    const plans =
      (team as { aggregator_subscription_types?: Array<{ id: string; name: string; prices?: Array<{ amount: number; recurrence: string }> }> })
        .aggregator_subscription_types ?? []
    const byId = new Map(plans.map((p) => [p.id, p]))
    return (id: string) => {
      const p = byId.get(id)
      if (!p) return null
      const price = p.prices?.[0]
      let priceLabel: string | null = null
      if (price) {
        const key = `recurrence.${price.recurrence}`
        const suffix = tShop.has(key as Parameters<typeof tShop.has>[0])
          ? ` ${tShop(key as Parameters<typeof tShop>[0])}`
          : ''
        priceLabel = `${formatCurrency(price.amount, currency, locale)}${suffix}`
      }
      return { name: p.name, priceLabel }
    }
  }, [team, currency, locale, tShop])

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
  // Which guest door the visitor chose on the "who" step. A gated class can now
  // offer BOTH doors at once (trialEnabled + drop-in), and they submit
  // differently: 'trial' books free via bookSession (the backend admits gated
  // trial guests), 'dropin' pays via checkout. Null = not chosen (open classes
  // only ever have the free path, so null behaves like 'trial').
  const [guestPath, setGuestPath] = useState<'trial' | 'dropin' | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Confirmation
  const [confirmedSession, setConfirmedSession] = useState<SessionProfile | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Ref to trigger the shared guest-details form's submit from the sticky bar
  // (the Confirm button lives outside the <form> element).
  const guestFormRef = useRef<GuestDetailsFormHandle>(null)

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
              activityType: data.activityType ?? undefined,
              description: data.description ?? undefined,
              image: data.image_url ?? null,
              color: data.color ?? undefined,
              level: data.level ?? undefined,
              isFreeTrial: data.isFreeTrial ?? false,
              order: typeof data.order === 'number' ? data.order : undefined,
              accessRule: data.accessRule ?? undefined,
              dropIn: data.dropIn ?? undefined,
              trialEnabled: data.trialEnabled === true,
              trialPriceAmount: typeof data.trialPriceAmount === 'number' ? data.trialPriceAmount : null,
              durations: Array.isArray(data.durations) ? data.durations : undefined,
              memberBenefit: data.memberBenefit ?? undefined,
              prerequisites: data.prerequisites ?? undefined,
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
          // A real studio with several daily classes easily exceeds 100 upcoming
          // sessions across a multi-month booking window; the calendar still
          // paginates by day, this just caps how many are fetched up front.
          limit(200)
        )
        const sessSnap = await getDocs(sessQ)
        const sessList: SessionProfile[] = sessSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }) as SessionProfile)
          .filter((s) => s.start && s.end && s.start.toDate() <= windowEnd)
        setSessions(sessList)

        // Determine initial step / auto-select
        if (preSelectedActivitySlug) {
          const matched = actList.find((a) => a.slug === preSelectedActivitySlug)
          if (matched?.activityType === 'appointment') {
            // Appointments have their own booking flow (per-coach slot picker) —
            // the class calendar can't render 1:1 slots, so hand the visitor over.
            // The activity id carries over so the picker preselects the same
            // offering instead of forgetting what was clicked.
            window.location.replace(`/public/${slug}/appointments?activity=${matched.id}`)
            return
          }
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

  const onSubmitGuest = async (values: GuestDetailsValues) => {
    if (!selectedSession || !teamId) return
    setIsSubmitting(true)
    setBookingError(null)

    // Shared checkout call — drop-in (pay-per-class) and priced-trial bookings
    // both redirect to Stripe Checkout; `trial: true` charges the activity's
    // TRIAL price instead of the drop-in price (`createDropInCheckout`'s
    // `trial` input). Also reused defensively from the catch block below when
    // the server reports `payment_required` for what the client thought was free.
    const checkout = async (trial: boolean) => {
      const fn = httpsCallable<Record<string, unknown>, { url?: string }>(
        functions,
        'createDropInCheckout'
      )
      const res = await fn({
        teamId,
        sessionId: selectedSession!.id,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          email: values.email,
          phone: showPhone ? values.phone || null : null,
        },
        slug,
        locale,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        ...(trial ? { trial: true } : {}),
      })
      return res.data?.url
    }

    try {
      // Gated class with drop-in enabled → pay-per-class; the webhook confirms the
      // booking on payment success. Redirect to Stripe Checkout. NOT when the
      // visitor explicitly took the free-trial door — a trial newcomer must never
      // be charged unless the trial itself is priced (isPricedTrial below);
      // bookSession admits gated trial guests (Activity.trialEnabled).
      const isPricedTrial =
        guestPath === 'trial' && typeof selectedActivity?.trialPriceAmount === 'number'

      if ((dropInAvailable && guestPath !== 'trial') || isPricedTrial) {
        const url = await checkout(isPricedTrial)
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
      const e = err as { message?: string; code?: string; details?: { reason?: string } }
      const reason = e.details?.reason
      if (reason === 'trial_used') {
        setBookingError(t('errorTrialUsed'))
      } else if (reason === 'payment_required') {
        // Defensive: the server determined this booking requires payment even
        // though the client took the free path (e.g. a stale/mismatched trial
        // price) — recover by sending the guest straight to checkout instead of
        // leaving them at a dead end.
        try {
          const url = await checkout(true)
          if (url) {
            window.location.href = url
            return
          }
        } catch {
          // fall through to the generic checkout-failed message below
        }
        setBookingError(t('errorCheckoutFailed'))
      } else if (e.code === 'already-exists') {
        setBookingError(t('errorAlreadyRegistered'))
      } else {
        setBookingError(e.message || t('errorGeneric'))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Returning member — post-verify (class-specific: subscription coverage
  // check, then book). ReturningSignIn owns the email→code→select steps
  // themselves; this only runs once a contact is confirmed. Throwing here
  // surfaces the error on ReturningSignIn's current step, matching the
  // original inline behaviour. ──────────────────────────────────────────────

  async function onVerified({
    contactId,
    verificationCodeId,
    contactData,
  }: {
    contactId: string
    verificationCodeId: string
    contactData: ContactData
  }) {
    if (!selectedSession) return
    // Personalised gate warning: the identified contact holds no subscription the
    // activity accepts — tell them in their language instead of surfacing
    // bookSession's raw permission error. Skipped when drop-in is offered so the
    // contact can back out to the guest pay-per-class path (bookSession itself has
    // no drop-in handling and would still reject them here). A subscription-gated
    // activity with an EMPTY allow-list (misconfig) also skips this and falls
    // through to the server error. bookSession stays authoritative either way.
    const required = selectedActivity
      ? activityRequiresSubscription(resolveActivityAccessRule(selectedActivity))
      : null
    if (
      required?.length &&
      contactData.held_subscription_type_ids &&
      !contactData.held_subscription_type_ids.some((id) => required.includes(id)) &&
      !dropInAvailable
    ) {
      throw new Error(t('errorNoSubscriptionForActivity'))
    }
    const bookSessionFn = httpsCallable(functions, 'bookSession')
    await bookSessionFn({
      teamId,
      sessionId: selectedSession.id,
      authenticatedContactId: contactId,
      verificationCodeId,
    })
    setConfirmedSession(selectedSession)
    setStep('confirmed')
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
    setBookingError(null)
    if (preSelectedActivitySlug || activities.length === 1) {
      setStep('sessions')
    } else {
      setStep('activities')
    }
  }

  // BackButton now lives in components/booking/BackButton (shared with the
  // appointment picker) — imported above; call sites pass label={t('back')}.

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
            title={selectedActivity.name}
            imageUrl={selectedActivity.image}
            providerLabel={
              selectedSession?.providerName
                ? t('withInstructor', { name: selectedSession.providerName })
                : null
            }
            dateTimeLabel={
              selectedSession
                ? `${formatDate(selectedSession.start)} · ${formatTime(selectedSession.start)}–${formatTime(selectedSession.end)}`
                : null
            }
            location={selectedSession?.location ?? null}
            accentColor={accentColor}
            showConfirm={step === 'details'}
            submitting={isSubmitting}
            confirmLabel={t('ctaConfirm')}
            submittingLabel={t('ctaBooking')}
            onConfirm={() => guestFormRef.current?.submit()}
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
            // Appointment activities book through their own flow (per-coach slot
            // picker on /appointments) — the card stays enabled and hands over.
            const isAppointment = a.activityType === 'appointment'
            const hasSessions =
              isAppointment ||
              sessions.some((s) => s.activityId === a.id || s.activitySlug === a.slug)
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
                  if (isAppointment) {
                    window.location.assign(`/public/${slug}/appointments?activity=${a.id}`)
                    return
                  }
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
                  {(() => {
                    // Structured commercial display (locked with the user): the ONLY
                    // things shown are two chips — Free trial + the type (Class /
                    // Appointment) — and NAMED pricing lines: "Included with {sub} —
                    // {price}" per granting subscription, "Discount with {sub} — {%}"
                    // per appointment-discount subscription, the drop-in price, and
                    // an appointment's direct price. No generic "Subscription
                    // required" / "Members only" gate badges, no generic "Included".
                    const d = resolveActivityPricingDisplay({ ...a, type: a.activityType }, subLookup)
                    const lines: string[] = []
                    for (const s of d.includedWith)
                      lines.push(
                        s.priceLabel
                          ? t('includedWithSubPriced', { name: s.name, price: s.priceLabel })
                          : t('includedWithSub', { name: s.name })
                      )
                    for (const s of d.discountWith)
                      lines.push(t('discountWithSub', { name: s.name, percent: s.percent }))
                    if (d.dropInAmount != null)
                      lines.push(t('badgeDropInPrice', { price: formatCurrency(d.dropInAmount, currency, locale) }))
                    if (d.appointmentPrice)
                      lines.push(
                        d.appointmentPrice.min === d.appointmentPrice.max
                          ? t('badgeFromPrice', { price: formatCurrency(d.appointmentPrice.min, currency, locale) })
                          : t('badgePriceRange', {
                              min: formatCurrency(d.appointmentPrice.min, currency, locale),
                              max: formatCurrency(d.appointmentPrice.max, currency, locale),
                            })
                      )
                    return (
                      <>
                        <div className="flex items-start gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm leading-tight">{a.name}</p>
                          {/* Type chip — Class or Appointment (always present) */}
                          <span className="rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-medium">
                            {d.type === 'appointment' ? t('badgeAppointment') : t('chipClass')}
                          </span>
                          {/* Trial — free (the one positive/free signal) or priced */}
                          {d.trial && (
                            <span className="rounded-full bg-green-100 text-green-700 text-xs px-2 py-0.5 font-medium">
                              {d.trial.priceAmount != null
                                ? t('badgeTrialPriced', {
                                    price: formatCurrency(d.trial.priceAmount, currency, locale),
                                  })
                                : t('badgeFreeTrial')}
                            </span>
                          )}
                          {!hasSessions && (
                            <span className="rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5">
                              {t('badgeNoOpenSessions')}
                            </span>
                          )}
                        </div>
                        {lines.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {lines.map((line, i) => (
                              <p key={i} className="text-xs text-muted-foreground">{line}</p>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  })()}
                  {showDesc && a.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {a.description}
                    </p>
                  )}
                  {a.prerequisites && (
                    <p className="text-xs text-amber-700 mt-1.5">
                      <span className="font-medium">{t('prerequisitesLabel')}</span>{' '}
                      {a.prerequisites}
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
          <BackButton label={t('back')} onClick={backFromSessions} />
          <h1 className="text-2xl font-bold">
            {selectedActivity ? selectedActivity.name : t('titleSessionsFallback')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('pickDateTimeSubtitle')}</p>
        </div>

        {selectedActivity?.prerequisites && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">{t('prerequisitesLabel')}</span>{' '}
            {selectedActivity.prerequisites}
          </div>
        )}

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
                        setGuestPath(null)
                        // Members-only → sign in. But if there's a guest door —
                        // drop-in (pay per class) or a free trial for newcomers —
                        // go to the chooser ('who') instead.
                        const gated = selectedActivity?.isFreeTrial === false
                        const canGuest = dropInAvailable || selectedActivity?.trialEnabled === true
                        const nextStep = gated && !canGuest ? 'returning' : 'who'
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
                          {s.providerName && (
                            <p className="text-xs text-muted-foreground">{s.providerName}</p>
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
    const trialPriceLabel =
      typeof selectedActivity?.trialPriceAmount === 'number'
        ? formatCurrency(selectedActivity.trialPriceAmount, currency, locale)
        : null
    return withBar(
      <>
        <div>
          <BackButton label={t('back')} onClick={() => setStep('sessions')} />
          <h1 className="text-2xl font-bold">{t('titleWhosBooking')}</h1>
        </div>

        <div className="space-y-3">
          {(!isMembersOnly || selectedActivity?.trialEnabled) && (
            <button
              onClick={() => { setGuestPath('trial'); setStep('details') }}
              className="w-full text-left rounded-xl border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors group flex items-center gap-3"
            >
              <div className="flex-1">
                <p className="font-semibold text-sm">{t('firstTimeTitle')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {trialPriceLabel
                    ? t('firstTimeSubtitlePriced', { price: trialPriceLabel })
                    : t('firstTimeSubtitle')}
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
          {isMembersOnly && dropInAvailable && (
            <button
              onClick={() => { setGuestPath('dropin'); setStep('details') }}
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
            onClick={() => setStep('returning')}
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

  // ─── Step: Returning — email → code → (optional) contact select ──────────
  // ReturningSignIn owns all three internal steps; class-specific post-verify
  // logic (subscription coverage check, then bookSession) lives in onVerified
  // above.

  if (step === 'returning' && selectedSession) {
    const isMembersOnly = selectedActivity?.isFreeTrial === false
    // Back goes to wherever the visitor came from: gated classes with a guest
    // door (drop-in or trial) DID pass through the 'who' chooser.
    const hadWhoStep =
      !isMembersOnly || dropInAvailable || selectedActivity?.trialEnabled === true
    return withBar(
      <ReturningSignIn
        teamId={teamId}
        onVerified={onVerified}
        onBack={() => setStep(hadWhoStep ? 'who' : 'sessions')}
        accentColor={accentColor}
        noAccountMessage={isMembersOnly ? t('errorNoAccountMembersOnly') : t('errorNoAccountGeneral')}
      />
    )
  }

  // ─── Step: New guest — contact details ───────────────────────────────────

  if (step === 'details' && selectedSession) {
    return withBar(
      <>
        <div>
          <BackButton label={t('back')} onClick={() => setStep('who')} />
          <h1 className="text-2xl font-bold">{t('yourDetailsTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('detailsSubtitle')}
          </p>
        </div>

        <GuestDetailsForm
          ref={guestFormRef}
          showPhone={showPhone}
          showAggregatorField={showFitnessApp}
          submitting={isSubmitting}
          error={bookingError}
          onSubmit={onSubmitGuest}
        />

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
              {confirmedSession.providerName && (
                <p>
                  <span className="font-medium text-foreground">{t('labelInstructor')}</span>
                  {confirmedSession.providerName}
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
