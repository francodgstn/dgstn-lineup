'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { Route } from 'next'
import {
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  doc,
  getDoc,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import {
  resolveActivityAccessRule,
  compareActivities,
  activityRequiresSubscription,
  resolvePaymentOptions,
  type ActivityAccessRule,
  type ActivityMemberBenefit,
  type Benefit,
  type PublicFrom,
  type FormField,
  parseDateKey,
  parseDocId,
} from '@linyup/shared'
import { FieldInput, isFieldAnswered } from '@/components/forms/FieldInput'
import { publicHref, publicHrefLocalized, returnHref } from '@/lib/publicRoutes'
import { useStepUrl } from '@/hooks/useStepUrl'
import { clientPaymentSnapshot } from '@/lib/paymentSnapshot'
import { resolveActivityPricingDisplay, type SubLookup } from '@/lib/activityTerms'
import { formatCurrency } from '@/lib/format'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpRight } from 'lucide-react'
import { Link, useRouter } from '@/i18n/navigation'
import { BioLinkButton } from '../BioLinkShell'
import { FlowShell } from '@/components/booking/FlowShell'
import { useBookingChrome } from '@/components/booking/BookingChrome'
import { usePublicTeam } from '../PublicTeamProvider'
import { usePublicContactAuth } from '../PublicContactAuthProvider'
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
import {
  GiftCardRedeemField,
  giftCardCheckoutErrorMessage,
  type AppliedGiftCard,
} from '@/components/booking/GiftCardRedeemField'

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
  /** The one member-benefit rule, mirrored verbatim — appointments (every
   *  priced duration) and classes (the drop-in price). Accepts the legacy
   *  appointment shape or the generalized `Benefit`. */
  memberBenefit?: ActivityMemberBenefit | Benefit
  prerequisites?: string
  meetingPoint?: string
  whatsIncluded?: string
  whatsNotIncluded?: string
  faq?: string
  cancellationPolicy?: string
  /** Per-activity book-form questions (shared FormField schema). */
  bookingQuestions?: FormField[]
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
  headline?: string
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

/**
 * Why a `?session=` / `?date=` deep link couldn't be honoured. The visitor is
 * degraded to the nearest useful step and told why — never silently dumped on
 * the blank activity picker, which is the whole reason deep links exist.
 */
type DeepLinkNotice = 'past' | 'full' | 'gone' | 'dateEmpty' | 'closed'

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

/** Drop-in (pay-per-class) price for a gated class, else null. */
function dropInPriceOf(a: ActivityProfile | null | undefined): number | null {
  if (!a || a.isFreeTrial !== false) return null
  if (!a.dropIn?.enabled) return null
  return typeof a.dropIn.priceAmount === 'number' ? a.dropIn.priceAmount : null
}

/**
 * Which step follows picking a session. Members-only → sign in ('returning');
 * but if the class has a guest door — drop-in (pay per class) or a trial for
 * newcomers — the visitor gets the chooser ('who') instead.
 *
 * The ONLY place this rule lives. Both the session click handler and the
 * `?session=` deep-link resolver call it, or the click path and the link path
 * silently diverge.
 */
function nextStepAfterSession(a: ActivityProfile | null | undefined): Step {
  const gated = a?.isFreeTrial === false
  const canGuest = dropInPriceOf(a) != null || a?.trialEnabled === true
  return gated && !canGuest ? 'returning' : 'who'
}

/** A session is bookable only while it's upcoming, has a free seat, and (if the
 *  studio set one) is still before the online booking cutoff. Client-side
 *  mirror of the server's authoritative check (isPastBookingCutoff, bookSession
 *  / createDropInCheckout) — never trust this alone. */
function sessionBlockReason(
  s: SessionProfile,
  cutoffMinutes?: number
): DeepLinkNotice | null {
  if (s.allowBooking !== true) return 'gone'
  if (s.start.toDate().getTime() <= Date.now()) return 'past'
  if (typeof s.max_participants === 'number' && (s.bookings_count ?? 0) >= s.max_participants)
    return 'full'
  if (cutoffMinutes && cutoffMinutes > 0 && Date.now() >= s.start.toDate().getTime() - cutoffMinutes * 60_000)
    return 'closed'
  return null
}

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  slug: string
  /** `/booking/{activitySlug}` path form. Inbound alias only — never pushed. */
  preSelectedActivitySlug?: string
  initialDate?: string
  /** `?session=` — highest precedence: lands on the "who's booking" step. */
  initialSession?: string
  /** `?activity=` — activity ID (the form the cancellation/rebook emails send). */
  initialActivityId?: string
  /** `?referral=` — carried through to `bookSession({ referralCode })`. */
  referral?: string
  /** `?from=` — which surface to return to. See `returnHref`. */
  from?: PublicFrom
  /**
   * Suppress this flow's own history writes. Set by an overlay host, which owns
   * the address bar while the panel is open — two writers would fight, and Back
   * would take two presses to close the overlay.
   */
  disableStepUrl?: boolean
  /**
   * Open directly on the confirmation step for this session — the visitor has
   * just returned from a successful Stripe payment. Only ever set from a
   * verified payment result, never from a URL: see lib/bookingReturn.ts.
   */
  confirmedSessionId?: string
}

// MiniCalendar and StickyBar now live in components/booking/ (shared with the
// appointment picker) — imported at the top of this file.

// ─── component ───────────────────────────────────────────────────────────────

export default function BookingForm({
  slug,
  preSelectedActivitySlug,
  initialDate,
  initialSession,
  initialActivityId,
  referral,
  from,
  disableStepUrl,
  confirmedSessionId,
}: Props) {
  // Team already resolved once by the parent PublicTeamProvider (the layout).
  const { teamId, team } = usePublicTeam()
  // The team-root sign-in bar's session — a contact may already be signed in
  // from another surface (Space/Shop). Used ONLY to preview the drop-in
  // member rate here; checkout/booking always re-resolve authoritatively
  // server-side (the callable trusts its own session token, not this).
  const { contact, isAuthenticated } = usePublicContactAuth()
  // 'page' unless an overlay host wraps this flow — see BookingChrome.
  const chrome = useBookingChrome()
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('PublicBooking')
  const tShop = useTranslations('Shop')
  const tSurfaces = useTranslations('PublicSurfaceLinks')
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
      return { id: p.id, name: p.name, priceLabel }
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

  // Why an inbound deep link couldn't be honoured verbatim (see DeepLinkNotice).
  const [deepLinkNotice, setDeepLinkNotice] = useState<DeepLinkNotice | null>(null)
  // `applyEntry` may pick the date itself (from the deep-linked session). Set once
  // it has, so the default-date effect below doesn't immediately overwrite it.
  const entryResolvedRef = useRef(false)

  // Confirmation
  const [confirmedSession, setConfirmedSession] = useState<SessionProfile | null>(null)
  // Short human-readable code from bookSession's return value — only the FREE
  // path returns it synchronously (a paid booking confirms later via the
  // Stripe webhook, off this request), so absent is expected there.
  const [bookingReference, setBookingReference] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Optional gift-card redemption — only meaningful on a paying booking (drop-in
  // or priced trial). Reset whenever the guest door changes.
  const [giftCardApplied, setGiftCardApplied] = useState<AppliedGiftCard | null>(null)

  // Answers to the activity's book-form questions, keyed by FormField.id. The
  // server re-narrows these to the activity's own questions before storing
  // (sanitizeBookingAnswers) — this map is convenience, not trust.
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [answersError, setAnswersError] = useState<string | null>(null)
  const bookingQuestions = selectedActivity?.bookingQuestions ?? []

  /** Every required question answered? Gates submit on both booking paths. */
  function missingRequiredAnswer(): boolean {
    return bookingQuestions.some((q) => q.required && !isFieldAnswered(q, answers[q.id]))
  }

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
              meetingPoint: data.meetingPoint ?? undefined,
              whatsIncluded: data.whatsIncluded ?? undefined,
              whatsNotIncluded: data.whatsNotIncluded ?? undefined,
              faq: data.faq ?? undefined,
              cancellationPolicy: data.cancellationPolicy ?? undefined,
              bookingQuestions: Array.isArray(data.bookingQuestions)
                ? (data.bookingQuestions as FormField[])
                : undefined,
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

        // Determine initial step / auto-select from the inbound deep link.
        if ((await applyEntry(actList, sessList)) === 'navigated') return
      } catch (err) {
        console.error('Error loading booking data', err)
      } finally {
        setLoadingData(false)
      }
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  /**
   * Resolve the inbound deep link to a starting step, in precedence order:
   *   ?session=  >  ?activity=  >  /booking/{activitySlug}  >  single activity  >  picker
   *
   * A `?session=` that can't be honoured (past, full, unpublished) DEGRADES to
   * that activity's date list with a notice — it never falls through to the blank
   * picker, which is the failure this whole contract exists to prevent.
   *
   * Returns 'navigated' when it hands the visitor over to the appointment flow,
   * so the caller stops (a router.replace does not halt the surrounding function).
   */
  async function applyEntry(
    actList: ActivityProfile[],
    sessList: SessionProfile[]
  ): Promise<'navigated' | 'applied'> {
    const findActivityFor = (s: SessionProfile) =>
      actList.find((a) => a.id === s.activityId || (!!s.activitySlug && a.slug === s.activitySlug)) ??
      null

    // ── Returning from a successful payment ──────────────────────────────────
    // Straight to the confirmation, no re-booking. The session must still
    // resolve; if it doesn't, fall through and the normal funnel applies.
    if (confirmedSessionId) {
      const paid = sessList.find((s) => s.id === confirmedSessionId)
      if (paid) {
        setSelectedActivity(findActivityFor(paid))
        setSelectedSession(paid)
        setConfirmedSession(paid)
        entryResolvedRef.current = true
        setStep('confirmed')
        return 'applied'
      }
    }

    // ── ?session= ────────────────────────────────────────────────────────────
    if (initialSession) {
      // The list query is capped (`limit(200)`) and starts at now, so a session
      // linked from the website's schedule — which lists from Monday of the
      // current week — may be absent. The per-session public_profile is
      // world-readable and its doc id IS the session id, so one read resolves it.
      let target = sessList.find((s) => s.id === initialSession) ?? null
      if (!target) {
        try {
          const snap = await getDoc(
            doc(db, 'sessions', initialSession, 'public_profile', initialSession)
          )
          const data = snap.data()
          // Never trust a session id from the URL to belong to this tenant.
          if (data && data.type === 'session' && data.teamId === teamId) {
            target = { ...data, id: snap.id } as SessionProfile
          }
        } catch {
          // Unreadable → treated as gone below.
        }
      }

      const activity = target ? findActivityFor(target) : null
      const blocked = target ? sessionBlockReason(target, bookingSettings?.cutoffMinutes) : 'gone'

      if (target && activity && !blocked) {
        setSelectedActivity(activity)
        setSelectedSession(target)
        setSelectedDate(toDateKey(target.start))
        entryResolvedRef.current = true
        setStep(nextStepAfterSession(activity))
        return 'applied'
      }

      setDeepLinkNotice(blocked ?? 'gone')
      // Degrade: keep the activity, but deliberately do NOT pin the linked day.
      // The notice promises "the next available times", and the linked day is by
      // definition the one that's past/full — pinning it would show an empty
      // list under that promise. Leaving the date unset lets the default-date
      // effect land on the nearest day that actually has sessions.
      if (activity) {
        setSelectedActivity(activity)
        setStep('sessions')
        return 'applied'
      }
      // Otherwise fall through to the activity-level branches below.
    }

    // ── ?activity= (id) ──────────────────────────────────────────────────────
    // The form sendBookingCancelled / updateSession have been emailing all along.
    if (initialActivityId) {
      const matched = actList.find((a) => a.id === initialActivityId)
      if (matched?.activityType === 'appointment') {
        goToAppointments(matched.id)
        return 'navigated'
      }
      if (matched) {
        setSelectedActivity(matched)
        setStep('sessions')
        return 'applied'
      }
    }

    // ── /booking/{activitySlug} path form ────────────────────────────────────
    if (preSelectedActivitySlug) {
      const matched = actList.find((a) => a.slug === preSelectedActivitySlug)
      if (matched?.activityType === 'appointment') {
        // Appointments have their own booking flow (per-coach slot picker) — the
        // class calendar can't render their slots, so hand the visitor over. The
        // activity id carries over so the picker preselects the same offering
        // instead of forgetting what was clicked.
        goToAppointments(matched.id)
        return 'navigated'
      }
      if (matched) {
        setSelectedActivity(matched)
        setStep('sessions')
        return 'applied'
      }
    }

    // ── Defaults ─────────────────────────────────────────────────────────────
    // Date-first: straight to the day picker with NO activity pinned, so the
    // slot list shows every activity running on the chosen day. (Checked before
    // the single-activity shortcut — with one activity the two are equivalent,
    // and pinning it would hide nothing but costs the row its name label.)
    if (isDateFirst) {
      setSelectedActivity(null)
      setStep('sessions')
    } else if (actList.length === 1) {
      setSelectedActivity(actList[0])
      setStep('sessions')
    } else {
      setStep('activities')
    }
    return 'applied'
  }

  /**
   * DATE-FIRST flow (`BookingSettings.flowType`): the visitor picks a DAY first
   * and sees every activity running that day, instead of picking an activity
   * and then a day. It reuses the same 'sessions' step with NO activity
   * selected — `activitySessions` already returns everything in that state and
   * the slot rows already label themselves with `activityName`. The activity is
   * resolved from whichever session gets clicked.
   *
   * A deep link that names one activity (`/booking/{slug}`, `?activity=`,
   * `?session=`) still pins it — the visitor asked for that activity
   * specifically, so the studio's browse preference doesn't apply.
   */
  const isDateFirst =
    bookingSettings?.flowType === 'date-first' && !preSelectedActivitySlug && !initialActivityId

  /** The loaded activity a session belongs to (by id, else by slug). */
  const findActivityForSession = (s: SessionProfile) =>
    activities.find(
      (a) => a.id === s.activityId || (!!s.activitySlug && a.slug === s.activitySlug)
    ) ?? null

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

  // Set default selected date. `applyEntry` may already have picked one from a
  // deep-linked session — don't clobber it (this effect also runs on the very
  // transition applyEntry causes).
  useEffect(() => {
    if (availableDates.length === 0) return
    if (entryResolvedRef.current) {
      entryResolvedRef.current = false
      return
    }
    if (initialDate && !availableDates.includes(initialDate)) {
      // The linked day has no sessions for this activity — land on the nearest
      // one that does, and say so rather than silently showing a different day.
      setDeepLinkNotice('dateEmpty')
    }
    const candidate =
      initialDate && availableDates.includes(initialDate) ? initialDate : availableDates[0]
    setSelectedDate(candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActivity?.id, sessions.length])

  const cutoffMinutes = bookingSettings?.cutoffMinutes
  const filteredSessions = useMemo(
    () =>
      (selectedDate
        ? activitySessions.filter((s) => toDateKey(s.start) === selectedDate)
        : activitySessions
      ).filter((s) => sessionBlockReason(s, cutoffMinutes) !== 'closed'),
    [selectedDate, activitySessions, cutoffMinutes]
  )

  // Drop-in (pay-per-class): a gated class where the studio lets uncovered contacts
  // pay a per-class fee to book. Members who are covered still book free via sign-in.
  const selectedDropInPrice = dropInPriceOf(selectedActivity)
  const dropInAvailable = selectedDropInPrice != null

  // Member rate preview on the drop-in price — a signed-in contact (from the
  // team-root sign-in bar) whose held subscription earns a benefit sees the
  // reduced price with the base struck through, BEFORE they even reach
  // checkout. DISPLAY only: createDropInCheckout re-resolves authoritatively
  // from its own session, never from this. Today's public contact session
  // only carries one primary `subscription_type_id` — same simplification
  // ShopHome's held union uses.
  const dropInMemberPrice = useMemo(() => {
    if (!selectedActivity || !dropInAvailable) return null
    const rule = resolveActivityAccessRule(selectedActivity)
    const heldSubscriptionTypeIds = contact?.subscription_type_id ? [contact.subscription_type_id] : []
    const snapshot = clientPaymentSnapshot({ authenticated: isAuthenticated, heldSubscriptionTypeIds })
    const { options } = resolvePaymentOptions(snapshot, {
      kind: 'drop_in',
      accessRule: rule,
      dropIn: selectedActivity.dropIn,
      benefit: selectedActivity.memberBenefit,
    })
    const pay = options[0]
    if (pay?.type !== 'pay' || !pay.appliedBenefit) return null
    return { amount: pay.amount, base: pay.appliedBenefit.baseAmount }
  }, [selectedActivity, dropInAvailable, contact, isAuthenticated])

  // Gated class with drop-in enabled → pay-per-class. NOT when the visitor
  // explicitly took the free-trial door — a trial newcomer must never be
  // charged unless the trial itself is priced (isPricedTrial); bookSession
  // admits gated trial guests (Activity.trialEnabled) for free otherwise.
  const isPricedTrial =
    guestPath === 'trial' && typeof selectedActivity?.trialPriceAmount === 'number'
  const willCharge = (dropInAvailable && guestPath !== 'trial') || isPricedTrial

  // ── Guest booking ─────────────────────────────────────────────────────────

  const onSubmitGuest = async (values: GuestDetailsValues) => {
    if (!selectedSession || !teamId) return
    // Required book-form questions gate the submit — the server would accept the
    // booking without them (they're studio preference, not a data contract), so
    // enforcing here is the only place it happens.
    if (missingRequiredAnswer()) {
      setAnswersError(t('errorAnswerRequired'))
      return
    }
    setAnswersError(null)
    setIsSubmitting(true)
    setBookingError(null)

    // Shared checkout call — drop-in (pay-per-class) and priced-trial bookings
    // both redirect to Stripe Checkout; `trial: true` charges the activity's
    // TRIAL price instead of the drop-in price (`createDropInCheckout`'s
    // `trial` input). Also reused defensively from the catch block below when
    // the server reports `payment_required` for what the client thought was free.
    // Returns the raw response so the caller can also detect the gift-card
    // FULL-COVER shape ({ url: null, paidWithGiftCard: true }).
    const checkout = async (trial: boolean) => {
      const fn = httpsCallable<
        Record<string, unknown>,
        { url?: string | null; paidWithGiftCard?: boolean }
      >(functions, 'createDropInCheckout')
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
        ...(giftCardApplied ? { giftCardCode: giftCardApplied.code } : {}),
        // Carried into the PENDING booking doc the checkout creates, so the
        // answers survive the Stripe round-trip without a client re-submit.
        ...(Object.keys(answers).length ? { questionAnswers: answers } : {}),
      })
      return res.data
    }

    try {
      if (willCharge) {
        const result = await checkout(isPricedTrial)
        if (result.paidWithGiftCard) {
          setConfirmedSession(selectedSession)
          setStep('confirmed')
          return
        }
        if (result.url) {
          leaveFlowTo(result.url)
          return
        }
        throw new Error(t('errorCheckoutFailed'))
      }

      const bookSessionFn = httpsCallable<Record<string, unknown>, { bookingReference?: string }>(
        functions,
        'bookSession'
      )
      const bookRes = await bookSessionFn({
        teamId,
        sessionId: selectedSession.id,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          email: values.email,
          phone: showPhone ? values.phone || null : null,
          aggregatorApp: showFitnessApp ? values.aggregatorApp || null : null,
        },
        // Free path only — createDropInCheckout takes no referral code, which is
        // right: a referral link invites a newcomer to their first free booking.
        ...(referral ? { referralCode: referral } : {}),
        ...(Object.keys(answers).length ? { questionAnswers: answers } : {}),
      })
      setBookingReference(bookRes.data.bookingReference ?? null)
      setConfirmedSession(selectedSession)
      setStep('confirmed')
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string; details?: { reason?: string } }
      const reason = e.details?.reason
      const giftMsg = giftCardApplied ? giftCardCheckoutErrorMessage(err, tShop) : null
      if (giftMsg) {
        setBookingError(giftMsg)
      } else if (reason === 'trial_used') {
        setBookingError(t('errorTrialUsed'))
      } else if (reason === 'payment_required') {
        // Defensive: the server determined this booking requires payment even
        // though the client took the free path (e.g. a stale/mismatched trial
        // price) — recover by sending the guest straight to checkout instead of
        // leaving them at a dead end.
        try {
          const result = await checkout(true)
          if (result.paidWithGiftCard) {
            setConfirmedSession(selectedSession)
            setStep('confirmed')
            return
          }
          if (result.url) {
            leaveFlowTo(result.url)
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
    // Same resolver the server uses (@linyup/shared) decides "covered" —
    // mechanical swap of the intersection check, same gating conditions.
    const accessRule = selectedActivity ? resolveActivityAccessRule(selectedActivity) : null
    const required = accessRule ? activityRequiresSubscription(accessRule) : null
    if (required?.length && contactData.held_subscription_type_ids && !dropInAvailable) {
      const snapshot = clientPaymentSnapshot({
        authenticated: true,
        heldSubscriptionTypeIds: contactData.held_subscription_type_ids,
      })
      const { denial } = resolvePaymentOptions(snapshot, { kind: 'class_booking', accessRule: accessRule! })
      if (denial) {
        throw new Error(t('errorNoSubscriptionForActivity'))
      }
    }
    const bookSessionFn = httpsCallable<Record<string, unknown>, { bookingReference?: string }>(
      functions,
      'bookSession'
    )
    const bookRes = await bookSessionFn({
      teamId,
      sessionId: selectedSession.id,
      authenticatedContactId: contactId,
      verificationCodeId,
      ...(referral ? { referralCode: referral } : {}),
    })
    setBookingReference(bookRes.data.bookingReference ?? null)
    setConfirmedSession(selectedSession)
    setStep('confirmed')
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Leave the flow for a different URL (Stripe checkout, the appointment picker).
   * As a page this is a normal navigation; in an overlay the panel must close
   * first so it isn't left sitting over the page mid-navigation.
   *
   * Not for "back out of the flow" — that's `backTo` / `chrome.onClose`.
   */
  /**
   * Hand over to the APPOINTMENT funnel for this activity.
   *
   * In an overlay the host swaps the panel's contents in place — bouncing the
   * visitor to a full page mid-flow is jarring when picking an appointment off
   * the activity list is, to them, just the next step. As a page it navigates.
   */
  function goToAppointments(activityId: string) {
    if (chrome.switchToAppointments) {
      chrome.switchToAppointments(activityId)
      return
    }
    router.push(publicHref(slug, 'appointments', { activity: activityId, from }))
  }

  function leaveFlowTo(href: string) {
    if (chrome.kind === 'overlay') chrome.navigate(href)
    else router.push(href as Route)
  }

  // Where leaving the flow goes. `?from=` names the surface the visitor arrived
  // from; absent/dead → the team's default surface, resolved HERE rather than by
  // bouncing through the team root's client redirect.
  const backTo = useMemo(() => returnHref(team, slug, from), [team, slug, from])

  // ── Step ↔ URL ────────────────────────────────────────────────────────────
  //
  // One effect owns the whole mapping, rather than a push at each transition —
  // there are eight places the step changes, and a push forgotten at any one of
  // them silently breaks Back for that branch only.

  const stepUrl = useStepUrl({
    disabled: disableStepUrl,
    sticky: { from, referral },
    onRestore: (params) => {
      // Terminal guard: after a successful booking, Back must NOT re-enter
      // `details` with a live session — that would let the visitor submit the
      // same booking twice. Leave the flow instead.
      if (confirmedSession) {
        router.push(backTo.href)
        return
      }

      // popstate hands back whatever is in the address bar, which the visitor (or
      // a link they were sent) can have edited — parse it like any inbound param.
      const sessionId = parseDocId(params.get('session'))
      const restored = sessionId ? sessions.find((s) => s.id === sessionId) : null
      // Everything is re-derived from the loaded arrays by id — the step state
      // holds whole denormalized objects, which must never go in the URL.
      const activity = restored
        ? (activities.find(
            (a) => a.id === restored.activityId || (!!restored.activitySlug && a.slug === restored.activitySlug)
          ) ?? null)
        : null

      if (restored && activity) {
        const sub = params.get('step')
        setSelectedActivity(activity)
        setSelectedSession(restored)
        setSelectedDate(toDateKey(restored.start))
        entryResolvedRef.current = true
        if (sub === 'details') {
          // guestPath is the one piece that isn't derivable, hence `path=`.
          const path = params.get('path')
          setGuestPath(path === 'trial' || path === 'dropin' ? path : null)
          setStep('details')
        } else if (sub === 'returning') {
          setStep('returning')
        } else {
          setStep(nextStepAfterSession(activity))
        }
        return
      }

      const activityId = parseDocId(params.get('activity'))
      const matched = activityId ? activities.find((a) => a.id === activityId) : null
      if (matched) {
        setSelectedActivity(matched)
        setSelectedSession(null)
        setGuestPath(null)
        const day = parseDateKey(params.get('date'))
        if (day) {
          setSelectedDate(day)
          entryResolvedRef.current = true
        }
        setStep('sessions')
        return
      }

      // Back to the flow's entry step.
      setSelectedSession(null)
      setGuestPath(null)
      if (isDateFirst) {
        setSelectedActivity(null)
        // The day IS the state in date-first — restoring the step without it
        // would silently bounce the visitor back to the first available day.
        const day = parseDateKey(params.get('date'))
        if (day) {
          setSelectedDate(day)
          entryResolvedRef.current = true
        }
        setStep('sessions')
      } else if (preSelectedActivitySlug || activities.length === 1) {
        setStep('sessions')
      } else {
        setSelectedActivity(null)
        setStep('activities')
      }
    },
  })

  // The canonical query for the current step. All steps stay on ONE pathname:
  // pushing `/booking/{activitySlug}` would turn popstate into a real route
  // transition, remounting the wizard and refetching everything.
  const stepQuery: Record<string, string | undefined> =
    step === 'activities'
      ? {}
      : step === 'sessions'
        ? { activity: selectedActivity?.id, date: selectedDate ?? undefined }
        : step === 'confirmed'
          ? { booked: confirmedSession?.id }
          : {
              session: selectedSession?.id,
              step: step === 'who' ? undefined : step,
              path: step === 'details' ? (guestPath ?? undefined) : undefined,
            }

  const syncedQueryRef = useRef<string | null>(null)
  const prevStepRef = useRef<Step | null>(null)
  const seenRestoreRef = useRef(0)
  useEffect(() => {
    if (loadingData) return
    const key = JSON.stringify(stepQuery)
    // This run is a restore's own re-render — the URL is already what popstate
    // gave us. Record the state and write nothing.
    if (stepUrl.restoreCount() !== seenRestoreRef.current) {
      seenRestoreRef.current = stepUrl.restoreCount()
      syncedQueryRef.current = key
      prevStepRef.current = step
      return
    }
    if (syncedQueryRef.current === key) return
    const isFirst = syncedQueryRef.current === null
    const stepChanged = prevStepRef.current !== step
    syncedQueryRef.current = key
    prevStepRef.current = step
    // Push only on a real step transition. Refinements within a step (paging the
    // calendar to another day) rewrite instead, or Back would walk day by day
    // before it ever left the step. `confirmed` also rewrites — see the guard above.
    if (isFirst || !stepChanged || step === 'confirmed') stepUrl.replace(stepQuery)
    else stepUrl.push(stepQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedActivity?.id, selectedSession?.id, selectedDate, guestPath, loadingData])

  function backFromSessions() {
    // `isDateFirst` has no activity step in front of it either — the day picker
    // IS the entry step there.
    if (isDateFirst || preSelectedActivitySlug || initialActivityId || activities.length === 1) {
      // No activity step to go back to — leave the flow. In an overlay that
      // means CLOSE (the visitor came from the page behind the panel, not from
      // the team root); as a page it means go to wherever they came from.
      if (chrome.kind === 'overlay') chrome.onClose?.()
      else router.push(backTo.href)
    } else {
      setStep('activities')
    }
  }

  /**
   * Return to the slot list. In date-first the activity was inferred from the
   * clicked session, not chosen — so going back must un-pin it, or the visitor
   * lands on a list silently filtered to one activity they never picked.
   */
  function backToSessions() {
    if (isDateFirst) setSelectedActivity(null)
    setStep('sessions')
  }

  function resetToStart() {
    setSelectedSession(null)
    setBookingError(null)
    // Must clear, or the step↔URL restore guard keeps treating the flow as
    // terminal and ejects the visitor on their next Back.
    setConfirmedSession(null)
    setBookingReference(null)
    if (isDateFirst) {
      // Book-another returns to the full day list, not to the activity the
      // previous booking happened to be for.
      setSelectedActivity(null)
      setStep('sessions')
    } else if (preSelectedActivitySlug || activities.length === 1) {
      setStep('sessions')
    } else {
      setStep('activities')
    }
  }

  // BackButton now lives in components/booking/BackButton (shared with the
  // appointment picker) — imported above; call sites pass label={t('back')}.

  // ─── Sticky bar: shown on all non-activity, non-confirmed steps ───────────

  const showBar = selectedActivity && step !== 'activities' && step !== 'confirmed'

  function withBar(content: React.ReactNode, wide?: boolean) {
    return (
      <FlowShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        wide={wide}
        showBranding={showBranding}
        backTo={backTo}
        overlayTitle={selectedActivity?.name}
        bar={
          showBar && selectedActivity ? (
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
              position={chrome.kind === 'overlay' ? 'container' : 'viewport'}
              showConfirm={step === 'details'}
              submitting={isSubmitting}
              confirmLabel={t('ctaConfirm')}
              submittingLabel={t('ctaBooking')}
              onConfirm={() => guestFormRef.current?.submit()}
            />
          ) : null
        }
      >
        {content}
      </FlowShell>
    )
  }

  // Rendered on BOTH the activities and sessions steps: a link whose session is
  // gone degrades all the way to the picker, and landing there unexplained is
  // exactly the "blank picker" failure this contract exists to prevent.
  const deepLinkBanner = deepLinkNotice ? (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <p className="flex-1">{t(`deepLinkNotice.${deepLinkNotice}`)}</p>
      <button
        type="button"
        onClick={() => setDeepLinkNotice(null)}
        aria-label={t('dismiss')}
        className="shrink-0 font-semibold transition-opacity hover:opacity-70"
      >
        ×
      </button>
    </div>
  ) : null

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loadingData) {
    return (
      <FlowShell teamName={teamName} slug={slug} accentColor={null} showBranding={showBranding}>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </FlowShell>
    )
  }

  // ─── Step: Activity selection ─────────────────────────────────────────────

  if (step === 'activities') {
    return (
      <FlowShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
        backTo={backTo}
      >
        <div>
          <h1 className="text-2xl font-bold">{t('titleBookSession')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('chooseActivitySubtitle')}</p>
        </div>

        {deepLinkBanner}

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
                    goToAppointments(a.id)
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
                        {/* Pricing last, set apart from the prose above it: each way
                            to pay is its own row with a hairline between, so a card
                            offering three of them reads as a list rather than a
                            paragraph of prices. */}
                        {lines.length > 0 && (
                          <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
                            {lines.map((line, i) => (
                              <p key={i} className="py-1.5 text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  })()}
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
      </FlowShell>
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

        {deepLinkBanner}

        {selectedActivity?.prerequisites && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">{t('prerequisitesLabel')}</span>{' '}
            {selectedActivity.prerequisites}
          </div>
        )}

        {selectedActivity?.meetingPoint && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('meetingPointLabel')}</span>{' '}
            {selectedActivity.meetingPoint}
          </p>
        )}

        {(() => {
          const effectiveCancellationPolicy =
            selectedActivity?.cancellationPolicy?.trim() ||
            (team as { bookingCancellationPolicy?: string }).bookingCancellationPolicy?.trim() ||
            null
          const hasDetail =
            selectedActivity &&
            (selectedActivity.whatsIncluded ||
              selectedActivity.whatsNotIncluded ||
              selectedActivity.faq ||
              effectiveCancellationPolicy)
          if (!hasDetail) return null
          return (
            <details className="rounded-xl border bg-card">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                {t('activityDetailToggle')}
              </summary>
              <div className="space-y-3 border-t px-4 py-3 text-sm text-muted-foreground">
                {selectedActivity!.whatsIncluded && (
                  <div>
                    <p className="font-medium text-foreground">{t('whatsIncludedLabel')}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {selectedActivity!.whatsIncluded
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  </div>
                )}
                {selectedActivity!.whatsNotIncluded && (
                  <div>
                    <p className="font-medium text-foreground">{t('whatsNotIncludedLabel')}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {selectedActivity!.whatsNotIncluded
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  </div>
                )}
                {selectedActivity!.faq && (
                  <div>
                    <p className="font-medium text-foreground">{t('faqLabel')}</p>
                    <p className="mt-1 whitespace-pre-line">{selectedActivity!.faq}</p>
                  </div>
                )}
                {effectiveCancellationPolicy && (
                  <div>
                    <p className="font-medium text-foreground">{t('cancellationPolicyLabel')}</p>
                    <p className="mt-1 whitespace-pre-line">{effectiveCancellationPolicy}</p>
                  </div>
                )}
              </div>
            </details>
          )
        })()}

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
                        // Date-first browses with no activity pinned, so the
                        // clicked session is what names it. Everything
                        // downstream (access gate, pricing, sticky bar) reads
                        // `selectedActivity`, so resolve it here rather than
                        // letting those fall back to null.
                        const activity = selectedActivity ?? findActivityForSession(s)
                        if (!selectedActivity && activity) setSelectedActivity(activity)
                        setSelectedSession(s)
                        setGuestPath(null)
                        setGiftCardApplied(null)
                        setDeepLinkNotice(null)
                        setStep(nextStepAfterSession(activity))
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
                        {s.headline && (
                          <p className="text-xs text-amber-700 mt-0.5">{s.headline}</p>
                        )}
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
          <BackButton label={t('back')} onClick={backToSessions} />
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
                  {dropInMemberPrice ? (
                    <>
                      <span className="mr-1.5 line-through">
                        {formatCurrency(dropInMemberPrice.base, currency, locale)}
                      </span>
                      {t('dropInSubtitleMember', {
                        price: formatCurrency(dropInMemberPrice.amount, currency, locale),
                      })}
                    </>
                  ) : (
                    t('dropInSubtitle', { price: formatCurrency(selectedDropInPrice ?? 0, currency, locale) })
                  )}
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

    // A members-only class with no guest door sends a NEWCOMER straight here.
    // "Welcome back" is the wrong thing to tell them: it names no reason, offers
    // no way in, and reads as a dead end to exactly the lead we want to convert.
    // Explain the gate, name what unlocks it, and offer the shop.
    const gatedPlans = isMembersOnly
      ? resolveActivityPricingDisplay(
          { ...selectedActivity, type: selectedActivity?.activityType },
          subLookup
        ).includedWith
      : []
    // One plan → deep-link it; several → the subscriptions tab.
    const shopHref = publicHrefLocalized(
      locale,
      slug,
      'shop',
      gatedPlans.length === 1
        ? { type: gatedPlans[0].id, from: 'booking' }
        : { tab: 'subscriptions', from: 'booking' }
    )

    const accessIntro = isMembersOnly ? (
      <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
        {gatedPlans.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('accessIncludedWith')}
            </p>
            <ul className="mt-2 space-y-1.5">
              {gatedPlans.map((plan) => (
                <li key={plan.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{plan.name}</span>
                  {plan.priceLabel && (
                    <span className="shrink-0 text-muted-foreground">{plan.priceLabel}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* New tab on purpose: buying is a detour, and losing the class they'd
            already picked is the fastest way to lose the booking. */}
        <a
          href={shopHref}
          target="_blank"
          rel="noopener noreferrer"
          style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('accessSeeSubscriptions')}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    ) : null

    return withBar(
      <ReturningSignIn
        teamId={teamId}
        onVerified={onVerified}
        onBack={() => (hadWhoStep ? setStep('who') : backToSessions())}
        accentColor={accentColor}
        noAccountMessage={isMembersOnly ? t('errorNoAccountMembersOnly') : t('errorNoAccountGeneral')}
        title={isMembersOnly ? t('accessTitle') : undefined}
        subtitle={
          isMembersOnly
            ? t('accessSubtitle', { activity: selectedActivity?.name ?? '' })
            : undefined
        }
        intro={accessIntro}
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

        {/* Gift card redemption — only meaningful on a paying booking (drop-in
            or priced trial); a free trial/booking has nothing to redeem against. */}
        {willCharge && (
          <GiftCardRedeemField
            teamId={teamId}
            locale={locale}
            applied={giftCardApplied}
            onApplied={setGiftCardApplied}
            disabled={isSubmitting}
          />
        )}

        {/* Live price breakdown — display only; createDropInCheckout /
            bookSession re-resolve the charge authoritatively server-side. */}
        {willCharge && (() => {
          const basePrice = isPricedTrial
            ? (selectedActivity?.trialPriceAmount ?? 0)
            : (selectedDropInPrice ?? 0)
          const memberDiscount =
            !isPricedTrial && dropInMemberPrice ? dropInMemberPrice.base - dropInMemberPrice.amount : 0
          const afterBenefit = basePrice - memberDiscount
          const giftCardDeduction = giftCardApplied
            ? Math.min(giftCardApplied.balance, afterBenefit)
            : 0
          const total = Math.max(0, afterBenefit - giftCardDeduction)
          return (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('priceSubtotal')}</span>
                <span>{formatCurrency(basePrice, currency, locale)}</span>
              </div>
              {memberDiscount > 0 && (
                <div className="flex items-center justify-between text-green-700">
                  <span>{t('priceMemberDiscount')}</span>
                  <span>−{formatCurrency(memberDiscount, currency, locale)}</span>
                </div>
              )}
              {giftCardDeduction > 0 && (
                <div className="flex items-center justify-between text-green-700">
                  <span>{t('priceGiftCard')}</span>
                  <span>−{formatCurrency(giftCardDeduction, currency, locale)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
                <span>{t('priceTotal')}</span>
                <span>{formatCurrency(total, currency, locale)}</span>
              </div>
            </div>
          )
        })()}

        {/* Per-activity book-form questions. Rendered ABOVE the identity form so
            the sticky Confirm button still submits last — the questions are
            about the booking, the fields below are about the person. */}
        {bookingQuestions.length > 0 && (
          <div className="space-y-4 rounded-xl border bg-card p-4">
            {bookingQuestions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                {/* A checkbox renders its own inline label. */}
                {q.type !== 'checkbox' && (
                  <label className="text-sm font-medium">
                    {q.label}
                    {q.required && <span className="ml-0.5 text-destructive">*</span>}
                  </label>
                )}
                <FieldInput
                  field={q}
                  value={answers[q.id]}
                  disabled={isSubmitting}
                  onChange={(v) => {
                    setAnswers((prev) => ({ ...prev, [q.id]: v }))
                    setAnswersError(null)
                  }}
                />
              </div>
            ))}
            {answersError && <p className="text-sm text-destructive">{answersError}</p>}
          </div>
        )}

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
      <FlowShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
        backTo={backTo}
        overlayTitle={confirmedSession.activityName ?? undefined}
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
              {bookingReference && (
                <p>
                  <span className="font-medium text-foreground">{t('labelReference')}</span>
                  {bookingReference}
                </p>
              )}
            </div>
          </div>

          {ctaUrl && (
            <a href={ctaUrl} target="_blank" rel="noopener noreferrer">
              <BioLinkButton accentColor={accentColor}>{ctaLabel}</BioLinkButton>
            </a>
          )}

          <div className="space-y-1">
            <button
              onClick={resetToStart}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              {t('bookAnotherSession')}
            </button>
            {/* A booked visitor used to dead-end here with no way out but the
                header arrow. Send them back where they came from. */}
            <Link
              href={backTo.href}
              className="block w-full py-2 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('toSurface', { name: tSurfaces(backTo.surface) })}
            </Link>
          </div>
        </div>
      </FlowShell>
    )
  }

  return null
}
