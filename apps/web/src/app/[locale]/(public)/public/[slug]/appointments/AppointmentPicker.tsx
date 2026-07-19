'use client'

import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { resolvePaymentOptions, type ActivityMemberBenefit, type Benefit, type PaymentOption } from '@linyup/shared'
import { clientPaymentSnapshot } from '@/lib/paymentSnapshot'
import { usePublicTeam } from '../PublicTeamProvider'
import { formatCurrency } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { BioLinkShell } from '../BioLinkShell'
import { MiniCalendar, toDateKey } from '@/components/booking/MiniCalendar'
import {
  GuestDetailsForm,
  type GuestDetailsFormHandle,
  type GuestDetailsValues,
} from '@/components/booking/GuestDetailsForm'
import { ReturningSignIn, type ContactData } from '@/components/booking/ReturningSignIn'
import { StickyBar } from '@/components/booking/StickyBar'
import { BackButton } from '@/components/booking/BackButton'
import { CalendarClock, MapPin, Video, Clock, User, Check, ChevronRight, Tag } from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────
// Mirrors the listAvailability callable's contract: availability is the ONLY
// source of bookable times (nothing is pre-generated any more — an appointment
// Session exists only once booked). Duration/name/pricing come from the linked
// Activity, not the availability window. THE PRICE IS THE GATE for appointments
// — there is no access rule any more (see ActivityMemberBenefit's history note):
// an unpriced duration is free for anyone, a priced one is payable by anyone,
// and `memberBenefit` only ever lowers a signed-in member's price.

interface AvailDuration {
  minutes: number
  priceAmount: number | null
}

interface AvailActivity {
  activityId: string
  activityName: string
  durations: AvailDuration[]
  memberBenefit: ActivityMemberBenefit | Benefit | null
  location: string | null
  onlineUrl: string | null
  days: { dayMs: number; slotsByDuration: Record<string, number[]> }[]
}

interface AvailCoach {
  providerId: string
  providerName: string | null
  activities: AvailActivity[]
}

// What a picked time carries into the in-page booking step. Pricing here is
// DISPLAY/ROUTING only — bookAppointment / createAppointmentCheckout always
// re-resolve server-side.
interface WindowBooking {
  providerId: string
  providerName: string | null
  activityId: string
  activityName: string
  startMs: number
  durationMinutes: number
  location: string | null
  onlineUrl: string | null
  priceAmount: number | null
  memberBenefit: ActivityMemberBenefit | Benefit | null
}

// The booking form is now an in-page step (not a modal), so it joins the funnel.
type PickerStep = 'coach' | 'activity' | 'time' | 'book'

// Which screen the in-page booking step is showing. Reported UP so the parent's
// sticky bar shows its Confirm only on the guest screen (the sign-in and
// member-pay screens carry their own action buttons) — the same rule the class
// BookingForm applies (Confirm only on its 'details' step).
type BookScreen = 'guest' | 'signIn' | 'memberPay' | 'autobooking'

// Args passed to whichever booking/checkout callable backs the form.
type BookArgs =
  | { contactDetails: { firstname: string; lastname: string; email: string; phone?: string } }
  | { authenticatedContactId: string; verificationCodeId: string }

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDateFull = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60),
    m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// "CHF 45–85" when every duration is priced and prices differ, "from CHF 45" when
// only some durations are priced (or several distinct prices exist but the range
// doesn't cover every length), the plain price when there's only one, and null
// when nothing is priced (no chip).
function activityPriceRangeLabel(
  activity: AvailActivity,
  currency: string,
  locale: string,
  t: ReturnType<typeof useTranslations>
): string | null {
  const priced = activity.durations.filter((d) => typeof d.priceAmount === 'number')
  if (priced.length === 0) return null
  const amounts = priced.map((d) => d.priceAmount as number)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  if (min === max) return formatCurrency(min, currency, locale)
  if (priced.length === activity.durations.length) {
    return `${formatCurrency(min, currency, locale)}–${formatCurrency(max, currency, locale)}`
  }
  return t('priceFrom', { price: formatCurrency(min, currency, locale) })
}

// A duration is "for sale" when it has a base price — an unpriced duration is
// free for anyone regardless of `memberBenefit` (the shared resolver returns
// `covered` for it before ever looking at the benefit).
function durationIsPriced(priceAmount: number | null): boolean {
  return typeof priceAmount === 'number'
}

// Maps the shared resolver's single 'appointment'-target option (it never
// denies — THE PRICE IS THE GATE) back to the shape this component was built
// around (`resolveEffectiveAppointmentPrice`'s old return value) — display/
// routing only, book()/checkout() always re-resolve authoritatively server-side.
// The 'spend_credits' arm is unreachable from the client's optimistic snapshot
// (every held id is reported as unmetered — see clientPaymentSnapshot) but is
// handled for type-exhaustiveness/parity with the server's credit-spend path.
function toEffectivePrice(
  option: PaymentOption | undefined
): { free: boolean; amount: number | null; viaSubscriptionTypeId?: string | null } {
  if (!option) return { free: false, amount: null, viaSubscriptionTypeId: null }
  if (option.type === 'pay') {
    return {
      free: false,
      amount: option.amount,
      viaSubscriptionTypeId: option.appliedBenefit?.subscriptionTypeId ?? null,
    }
  }
  if (option.type === 'spend_credits') {
    return { free: true, amount: null, viaSubscriptionTypeId: option.via.subscriptionTypeId }
  }
  // 'covered'
  return {
    free: true,
    amount: null,
    viaSubscriptionTypeId: option.via.reason === 'benefit_included' ? option.via.subscriptionTypeId : null,
  }
}

// Pulls the {code, reason, priceAmount} triad off a callable's FunctionsError —
// `code` is prefixed ('functions/failed-precondition'); `reason`/`priceAmount`
// come from the HttpsError's `details` (see bookAppointment / createAppointmentCheckout).
function errorDetails(err: unknown): { code?: string; message?: string; reason?: string; priceAmount?: number } {
  const fe = err as FunctionsError
  const details = (fe?.details ?? {}) as { reason?: string; priceAmount?: number }
  return { code: fe?.code, message: fe?.message, reason: details.reason, priceAmount: details.priceAmount }
}

// ─── in-page booking step ───────────────────────────────────────────────────
// Guest fields + returning-member sign-in are the SHARED components also used by
// the class BookingForm (components/booking/). Rendered IN THE PAGE (inside
// BioLinkShell), not a modal — same as the class 'details'/'returning' steps.
// Only the money-specific bits (price display, the sign-in offer, the member-pay
// confirmation) stay local here. The guest screen's submit is driven from the
// parent's sticky bar via `guestFormRef` (sr-only <form> submit) — exactly the
// class BookingForm mechanism; the parent learns which screen is showing (to
// gate the Confirm button) through `onScreenChange`.

function SlotBookingForm({
  teamId,
  guestFormRef,
  onScreenChange,
  onSubmittingChange,
  accentColor,
  hasAnyPrice,
  priceAmount,
  memberBenefit,
  durationMinutes,
  currency,
  locale,
  backLabel,
  onExit,
  book,
  checkout,
  onBooked,
}: {
  teamId: string
  guestFormRef: Ref<GuestDetailsFormHandle>
  onScreenChange: (screen: BookScreen) => void
  onSubmittingChange: (submitting: boolean) => void
  accentColor: string | null
  hasAnyPrice: boolean
  priceAmount: number | null
  /** null/empty subscriptionTypeIds = nothing to offer — the sign-in link never
   *  renders (there's no price a member could get that a guest can't). */
  memberBenefit: ActivityMemberBenefit | Benefit | null
  durationMinutes: number
  currency: string
  locale: string
  backLabel: string
  /** Leaves the booking step entirely — back to the time picker. */
  onExit: () => void
  book: (args: BookArgs) => Promise<void>
  checkout: (args: BookArgs) => Promise<{ url?: string; amount?: number }>
  onBooked: (details: { firstname: string; email: string }) => void
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const [error, setError] = useState<string | null>(null)
  const [submittingGuest, setSubmittingGuest] = useState(false)
  const [submittingPay, setSubmittingPay] = useState(false)

  const offersMemberBenefit = !!memberBenefit?.subscriptionTypeIds.length

  // 'guest' is the DEFAULT and only ever-required screen — appointments have no
  // access gate any more (see ActivityMemberBenefit's history note): a guest may
  // always book, priced or not. Signing in is purely an OFFER to check a
  // possibly-lower member price, reached via a link on the guest form.
  type Screen = 'guest' | 'signIn'
  const [screen, setScreen] = useState<Screen>('guest')

  // Set once a signed-in member verifies and their effective price is an AMOUNT
  // (not free) — holds what checkout needs. `viaSubscriptionTypeId` is null when
  // the price is unchanged from base (no benefit applies) — used to skip the
  // "was CHF X" strikethrough. `firstname`/`email` are carried for the rare
  // "became covered" retry-to-free path (which calls onBooked directly).
  const [memberPay, setMemberPay] = useState<{
    contactId: string
    verificationCodeId: string
    amount: number
    viaSubscriptionTypeId?: string | null
    firstname: string
    email: string
  } | null>(null)
  // Transient state while an INCLUDED member's free booking is in flight.
  const [autobooking, setAutobooking] = useState(false)

  // Report the current screen UP so the sticky bar can gate its Confirm button.
  const currentScreen: BookScreen = autobooking
    ? 'autobooking'
    : memberPay
      ? 'memberPay'
      : screen === 'signIn'
        ? 'signIn'
        : 'guest'
  useEffect(() => {
    onScreenChange(currentScreen)
  }, [currentScreen, onScreenChange])
  useEffect(() => {
    onSubmittingChange(submittingGuest)
  }, [submittingGuest, onSubmittingChange])

  // ── Guest submit — routes to the free callable or checkout depending on
  // whether this duration has a base price. GuestDetailsForm supplies the
  // fields; on the guest screen its submit is sr-only and fired by the sticky
  // bar's Confirm (via guestFormRef). ──
  async function onSubmitGuest(values: GuestDetailsValues) {
    setError(null)
    setSubmittingGuest(true)
    try {
      const contactDetails = {
        firstname: values.firstname,
        lastname: values.lastname,
        email: values.email,
        phone: values.phone || undefined,
      }
      if (!hasAnyPrice) {
        await book({ contactDetails })
        onBooked({ firstname: values.firstname, email: values.email })
        return
      }
      const res = await checkout({ contactDetails })
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error('no-url')
    } catch (err) {
      const { code } = errorDetails(err)
      if (code === 'functions/already-exists') setError(t('errorAlreadyBooked'))
      else if (code === 'functions/failed-precondition') setError(t('errorSlotUnavailable'))
      else setError(hasAnyPrice ? t('errorCheckoutFailed') : t('errorGeneric'))
    } finally {
      setSubmittingGuest(false)
    }
  }

  // ── Returning member, post-verify. Reached ONLY via the priced guest form's
  // sign-in offer — `hasAnyPrice` is always true here. Throwing surfaces the
  // message on ReturningSignIn's current step. ──
  async function onVerifiedAppointment({
    contactId,
    verificationCodeId,
    contactData,
  }: {
    contactId: string
    verificationCodeId: string
    contactData: ContactData
  }) {
    const held = contactData.held_subscription_type_ids ?? []
    const contactFirstname = contactData.firstname || contactData.email.split('@')[0]
    // Same resolver the server uses (@linyup/shared) — DISPLAY/ROUTING only,
    // book()/checkout() always re-resolve authoritatively.
    const snapshot = clientPaymentSnapshot({ authenticated: true, heldSubscriptionTypeIds: held })
    const { options } = resolvePaymentOptions(snapshot, {
      kind: 'appointment',
      duration: { minutes: durationMinutes, priceAmount },
      benefit: memberBenefit,
    })
    const effective = toEffectivePrice(options[0])

    if (effective.free) {
      setAutobooking(true)
      try {
        await book({ authenticatedContactId: contactId, verificationCodeId })
        onBooked({ firstname: contactFirstname, email: contactData.email })
      } catch (bookErr) {
        const { code, reason, priceAmount: amt } = errorDetails(bookErr)
        if (code === 'functions/already-exists') {
          throw new Error(t('errorAlreadyBooked'))
        } else if (code === 'functions/failed-precondition' && reason === 'payment_required') {
          // Race: pricing/coverage changed between our check and the free
          // attempt — the server is authoritative, fall back to the pay CTA.
          if (typeof amt === 'number') {
            setMemberPay({
              contactId,
              verificationCodeId,
              amount: amt,
              firstname: contactFirstname,
              email: contactData.email,
            })
          } else {
            throw new Error(t('errorPaymentRequired'))
          }
        } else {
          throw new Error(t('errorGeneric'))
        }
      } finally {
        setAutobooking(false)
      }
      return
    }

    if (typeof effective.amount === 'number') {
      setMemberPay({
        contactId,
        verificationCodeId,
        amount: effective.amount,
        viaSubscriptionTypeId: effective.viaSubscriptionTypeId,
        firstname: contactFirstname,
        email: contactData.email,
      })
      return
    }
    throw new Error(t('errorPaymentRequired'))
  }

  // A verified member's effective price is an AMOUNT — pay to confirm.
  async function onMemberPay() {
    if (!memberPay) return
    setSubmittingPay(true)
    setError(null)
    try {
      const res = await checkout({
        authenticatedContactId: memberPay.contactId,
        verificationCodeId: memberPay.verificationCodeId,
      })
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error('no-url')
    } catch (err) {
      const { code, reason } = errorDetails(err)
      if (code === 'functions/failed-precondition' && reason === 'covered') {
        // Race: became covered since we checked — retry the free path.
        try {
          await book({
            authenticatedContactId: memberPay.contactId,
            verificationCodeId: memberPay.verificationCodeId,
          })
          onBooked({ firstname: memberPay.firstname, email: memberPay.email })
        } catch {
          setError(t('errorGeneric'))
        }
      } else if (code === 'functions/already-exists') {
        setError(t('errorAlreadyBooked'))
      } else {
        setError(t('errorCheckoutFailed'))
      }
    } finally {
      setSubmittingPay(false)
    }
  }

  function backToGuest() {
    setScreen('guest')
    setMemberPay(null)
    setAutobooking(false)
    setError(null)
  }

  const errorBox = error ? (
    <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
      {error}
    </p>
  ) : null

  // ── An INCLUDED member's free booking is in flight. ──
  if (autobooking) {
    return (
      <div className="py-10 text-center space-y-3">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">{t('memberCoveredHint')}</p>
      </div>
    )
  }

  // ── A verified member's effective price is an AMOUNT — pay to confirm. Shows
  // the base price struck through only when the member's price is actually lower
  // (a benefit applied); otherwise just the (unchanged) price. ──
  if (memberPay) {
    return (
      <>
        <div>
          <BackButton label={backLabel} onClick={backToGuest} />
          <h1 className="text-2xl font-bold">{t('confirmedTitle')}</h1>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-baseline gap-2">
            {memberPay.viaSubscriptionTypeId && priceAmount != null && memberPay.amount !== priceAmount && (
              <span className="text-sm text-muted-foreground line-through">
                {formatCurrency(priceAmount, currency, locale)}
              </span>
            )}
            <p className="text-base font-semibold">
              {t('yourPrice', { price: formatCurrency(memberPay.amount, currency, locale) })}
            </p>
          </div>
          {errorBox}
          <button
            type="button"
            disabled={submittingPay}
            onClick={onMemberPay}
            style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
          >
            {submittingPay
              ? t('payingEllipsis')
              : t('confirmPay', { price: formatCurrency(memberPay.amount, currency, locale) })}
          </button>
        </div>
      </>
    )
  }

  // ── Sign-in offer — the shared returning-member flow. Reached only via the
  // guest form's "check your price" link — never a requirement. It renders its
  // own back button + headings. ──
  if (screen === 'signIn') {
    return (
      <ReturningSignIn
        teamId={teamId}
        onVerified={onVerifiedAppointment}
        onBack={backToGuest}
        accentColor={accentColor}
        noAccountMessage={tPublic('errorNoAccountMembersOnly')}
      />
    )
  }

  // ── DEFAULT — guest details. Always available; the sign-in offer is a link,
  // never a gate. The visible submit is sr-only — the parent's sticky bar drives
  // it. ──
  return (
    <>
      <div>
        <BackButton label={backLabel} onClick={onExit} />
        <h1 className="text-2xl font-bold">{tPublic('yourDetailsTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{tPublic('detailsSubtitle')}</p>
      </div>

      {hasAnyPrice && priceAmount != null && (
        <p className="text-sm text-muted-foreground">
          {t('payToBook', { price: formatCurrency(priceAmount, currency, locale) })}
        </p>
      )}
      {hasAnyPrice && offersMemberBenefit && (
        <button
          type="button"
          onClick={() => setScreen('signIn')}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed p-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <Tag className="h-4 w-4 shrink-0" />
          {t('memberSignInOffer')}
        </button>
      )}

      <GuestDetailsForm
        ref={guestFormRef}
        showPhone
        submitting={submittingGuest}
        error={error}
        onSubmit={onSubmitGuest}
      />

      <p className="text-xs text-muted-foreground">{tPublic('consentText')}</p>
    </>
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

// Step 2 — pick an activity offered by that coach. Skipped entirely when a
// `?activity=` deep link is active (the server-side activityId filter means
// every coach in the response offers exactly that one activity).
function ActivityCard({
  activity,
  currency,
  locale,
  onSelect,
}: {
  activity: AvailActivity
  currency: string
  locale: string
  onSelect: () => void
}) {
  const t = useTranslations('AppointmentBooking')
  const durations = activity.durations.map((d) => d.minutes)
  const durationLabel =
    durations.length > 1
      ? `${fmtDuration(Math.min(...durations))} – ${fmtDuration(Math.max(...durations))}`
      : fmtDuration(durations[0] ?? 60)
  const priceLabel = activityPriceRangeLabel(activity, currency, locale, t)
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
            {priceLabel && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {priceLabel}
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
// Same layout as the class BookingForm's 'sessions' step: MiniCalendar LEFT,
// time slots (with duration chips above them) RIGHT — see BookingForm.tsx.
function TimePicker({
  coach,
  activity,
  currency,
  locale,
  onPick,
}: {
  coach: AvailCoach
  activity: AvailActivity
  currency: string
  locale: string
  onPick: (startMs: number, duration: AvailDuration) => void
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const [duration, setDuration] = useState<number>(activity.durations[0]?.minutes ?? 60)

  // Only days with a free start for the CHOSEN duration are selectable — a
  // window may offer several lengths and not every day has room for all of them.
  const availableDates = useMemo(
    () =>
      activity.days
        .filter((d) => (d.slotsByDuration[String(duration)] ?? []).length > 0)
        .map((d) => toDateKey(new Date(d.dayMs))),
    [activity, duration]
  )
  const maxDateKey = useMemo(() => {
    const last = activity.days[activity.days.length - 1]
    return last ? toDateKey(new Date(last.dayMs)) : toDateKey(new Date())
  }, [activity])

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(availableDates[0] ?? null)

  // Re-validate the selected day whenever the duration (or activity) changes —
  // the previously-selected day may not offer the new duration.
  useEffect(() => {
    setSelectedDateKey((prev) => (prev && availableDates.includes(prev) ? prev : (availableDates[0] ?? null)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, activity.activityId])

  const day = activity.days.find((d) => toDateKey(new Date(d.dayMs)) === selectedDateKey)
  const times = day?.slotsByDuration[String(duration)] ?? []
  const chosenDuration =
    activity.durations.find((d) => d.minutes === duration) ??
    activity.durations[0] ?? { minutes: duration, priceAmount: null }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{activity.activityName}</h1>
        {coach.providerName && (
          <p className="text-sm text-muted-foreground mt-1">{tPublic('withInstructor', { name: coach.providerName })}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 items-start">
        {/* Calendar */}
        <div className="bg-card border rounded-xl p-4">
          <MiniCalendar
            availableDates={availableDates}
            selectedDate={selectedDateKey}
            onSelect={setSelectedDateKey}
            maxDateKey={maxDateKey}
          />
        </div>

        {/* Duration chips (above the time list) + times */}
        <div>
          {activity.durations.length > 1 && (
            <div className="space-y-1.5 mb-4">
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
                    {typeof d.priceAmount === 'number' && ` · ${formatCurrency(d.priceAmount, currency, locale)}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedDateKey && (
            <p className="text-sm font-medium mb-3 text-muted-foreground">
              {fmtDateFull(new Date(selectedDateKey + 'T00:00:00').getTime())}
            </p>
          )}

          {times.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('noTimesThisDay')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {times.map((startMs) => (
                <button
                  key={startMs}
                  type="button"
                  onClick={() => onPick(startMs, chosenDuration)}
                  className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5"
                >
                  {fmtTime(startMs)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── main component ───────────────────────────────────────────────────────────
// Coach-first funnel: coach → activity → duration (only if >1) → day → time →
// book. Wrapped in BioLinkShell so it wears the same team top bar, content width
// and branded footer as the class BookingForm, and the booking step renders
// in-page (not a modal) with the shared bottom summary bar. A `?activity=` deep
// link preselects that offering: coaches are pre-filtered server-side, and when
// exactly one coach offers it the coach step is skipped entirely.

export default function AppointmentPicker({
  slug,
  presetActivityId,
}: {
  slug: string
  presetActivityId?: string
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const locale = useLocale()
  const { teamId, team } = usePublicTeam()
  const currency = team.default_currency ?? 'CHF'
  const teamName = team.name || ''
  const accentColor = team.bioLinkAccentColor ?? null
  const showBranding = team.showBranding === true

  const [coaches, setCoaches] = useState<AvailCoach[]>([])
  const [loading, setLoading] = useState(true)
  // Tracked separately from `coaches` — a failed load must never be mistaken for
  // the genuine "this coach has no open times" empty state (a coach would read
  // that as a misconfiguration; a client would just leave).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [confirmed, setConfirmed] = useState<{ email: string } | null>(null)
  const [windowBooking, setWindowBooking] = useState<WindowBooking | null>(null)
  const [step, setStep] = useState<PickerStep>('coach')
  const [selectedCoach, setSelectedCoach] = useState<AvailCoach | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<AvailActivity | null>(null)
  // True once the coach step was skipped because exactly one coach offers the
  // preselected activity — changes where Back on the time step goes.
  const [skippedCoachStep, setSkippedCoachStep] = useState(false)

  // In-page booking step ↔ sticky bar wiring (mirrors the class BookingForm):
  // the sticky bar's Confirm fires the guest form's sr-only submit, and only
  // shows on the guest screen — the booking form reports its screen up here.
  const [bookScreen, setBookScreen] = useState<BookScreen>('guest')
  const [bookSubmitting, setBookSubmitting] = useState(false)
  const guestFormRef = useRef<GuestDetailsFormHandle>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const availFn = httpsCallable<
          { teamId: string; days?: number; activityId?: string },
          { coaches: AvailCoach[] }
        >(functions, 'listAvailability')
        const res = await availFn({
          teamId,
          days: 60,
          ...(presetActivityId ? { activityId: presetActivityId } : {}),
        })
        if (!alive) return
        const list = res.data.coaches ?? []
        setCoaches(list)
        // Deep-link continuity: exactly one coach offers the preselected
        // activity — land straight on duration/day/time, no coach (or activity)
        // step shown. Decided here (not a separate effect) so there's no flash
        // of the coach-list step first.
        if (presetActivityId && list.length === 1) {
          const coach = list[0]
          const activity = coach.activities[0]
          if (activity) {
            setSelectedCoach(coach)
            setSelectedActivity(activity)
            setStep('time')
            setSkippedCoachStep(true)
          }
        }
      } catch (err) {
        if (!alive) return
        setCoaches([])
        setLoadError(errorDetails(err).message ?? null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    if (teamId) load()
    else setLoading(false)
    return () => { alive = false }
  }, [teamId, presetActivityId, reloadNonce])

  function retryLoad() {
    setReloadNonce((n) => n + 1)
  }

  // ── Confirmation — wrapped in BioLinkShell so the team top bar persists,
  // matching the class flow's confirmed step. ──
  if (confirmed) {
    return (
      <BioLinkShell teamName={teamName} slug={slug} accentColor={accentColor} showBranding={showBranding}>
        <div className="py-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t('confirmedTitle')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('confirmedMessage', { email: confirmed.email })}
              </p>
            </div>
          </div>
        </div>
      </BioLinkShell>
    )
  }

  function selectCoach(c: AvailCoach) {
    setSelectedCoach(c)
    // Preset mode: the activityId filter guarantees this coach offers exactly
    // the one activity — no need to make the visitor pick it again.
    if (presetActivityId && c.activities.length === 1) {
      setSelectedActivity(c.activities[0])
      setStep('time')
    } else {
      setSelectedActivity(null)
      setStep('activity')
    }
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
  // Back from the time step: exits to the team's public root when the coach step
  // was never shown (single-coach deep link), otherwise back to whichever step
  // WAS shown (coach step in preset mode — activity step is always skipped
  // there; activity step in the normal funnel).
  function backFromTime() {
    if (skippedCoachStep) {
      window.location.href = `/public/${slug}`
      return
    }
    if (presetActivityId) {
      backToCoaches()
      return
    }
    backToActivities()
  }
  // Back from the booking step returns to the time picker to re-pick a slot.
  function backFromBook() {
    setStep('time')
    setBookScreen('guest')
  }
  const timeBackLabel = skippedCoachStep
    ? t('back')
    : presetActivityId
      ? t('backToCoaches')
      : t('backToActivities')

  const hasCoaches = coaches.length > 0
  // The bottom summary bar rides along once an activity is chosen — on the time
  // picker (activity only) and the booking step (activity + slot + Confirm),
  // mirroring the class flow (sessions/details). The Confirm shows only on the
  // booking step's guest screen.
  const showBar = !!selectedActivity && (step === 'time' || step === 'book')
  const STICKY_H = 100

  return (
    <>
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        wide={step === 'time'}
        stickyBarHeight={showBar ? STICKY_H : undefined}
        showBranding={showBranding}
      >
        {step === 'coach' && (
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {!loading && !teamId && <EmptyState icon={CalendarClock} text={t('teamNotFound')} />}

        {!loading && teamId && loadError && (
          <QueryErrorState onRetry={retryLoad} title={t('scheduleLoadError')} detail={loadError} />
        )}

        {!loading && teamId && !loadError && !hasCoaches && (
          <EmptyState icon={CalendarClock} text={t('noCoaches')} hint={t('noCoachesHint')} />
        )}

        {!loading && teamId && !loadError && hasCoaches && step === 'coach' && (
          <section className="space-y-3">
            {coaches.map((c) => (
              <CoachCard key={c.providerId} coach={c} onSelect={() => selectCoach(c)} />
            ))}
          </section>
        )}

        {!loading && teamId && step === 'activity' && selectedCoach && (
          <section className="space-y-3">
            <BackButton label={t('backToCoaches')} onClick={backToCoaches} />
            <h2 className="text-sm font-semibold">{selectedCoach.providerName || t('unnamedCoach')}</h2>
            {selectedCoach.activities.length === 0 ? (
              <EmptyState icon={CalendarClock} text={t('noCoaches')} hint={t('noCoachesHint')} />
            ) : (
              selectedCoach.activities.map((a) => (
                <ActivityCard
                  key={a.activityId}
                  activity={a}
                  currency={currency}
                  locale={locale}
                  onSelect={() => selectActivity(a)}
                />
              ))
            )}
          </section>
        )}

        {!loading && teamId && step === 'time' && selectedCoach && selectedActivity && (
          <section className="space-y-4">
            <BackButton label={timeBackLabel} onClick={backFromTime} />
            <TimePicker
              coach={selectedCoach}
              activity={selectedActivity}
              currency={currency}
              locale={locale}
              onPick={(startMs, duration) => {
                setWindowBooking({
                  providerId: selectedCoach.providerId,
                  providerName: selectedCoach.providerName,
                  activityId: selectedActivity.activityId,
                  activityName: selectedActivity.activityName,
                  startMs,
                  durationMinutes: duration.minutes,
                  location: selectedActivity.location,
                  onlineUrl: selectedActivity.onlineUrl,
                  priceAmount: duration.priceAmount,
                  memberBenefit: selectedActivity.memberBenefit,
                })
                setStep('book')
              }}
            />
          </section>
        )}

        {!loading && teamId && step === 'book' && selectedCoach && selectedActivity && windowBooking && (
          <section className="space-y-4">
            <SlotBookingForm
              key={`${windowBooking.providerId}-${windowBooking.activityId}-${windowBooking.startMs}-${windowBooking.durationMinutes}`}
              teamId={teamId}
              guestFormRef={guestFormRef}
              onScreenChange={setBookScreen}
              onSubmittingChange={setBookSubmitting}
              accentColor={accentColor}
              hasAnyPrice={durationIsPriced(windowBooking.priceAmount)}
              priceAmount={windowBooking.priceAmount}
              memberBenefit={windowBooking.memberBenefit}
              durationMinutes={windowBooking.durationMinutes}
              currency={currency}
              locale={locale}
              backLabel={t('back')}
              onExit={backFromBook}
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
              checkout={(args) =>
                httpsCallable<Record<string, unknown>, { url?: string; amount?: number }>(
                  functions,
                  'createAppointmentCheckout'
                )({
                  teamId,
                  providerId: windowBooking.providerId,
                  activityId: windowBooking.activityId,
                  startMs: windowBooking.startMs,
                  durationMinutes: windowBooking.durationMinutes,
                  slug,
                  locale,
                  origin: typeof window !== 'undefined' ? window.location.origin : undefined,
                  ...args,
                }).then((res) => res.data)
              }
              onBooked={({ email }) => { setWindowBooking(null); setConfirmed({ email }) }}
            />
          </section>
        )}
      </BioLinkShell>

      {showBar && selectedActivity && (
        <StickyBar
          title={selectedActivity.activityName}
          providerLabel={
            selectedCoach?.providerName
              ? tPublic('withInstructor', { name: selectedCoach.providerName })
              : null
          }
          dateTimeLabel={
            step === 'book' && windowBooking
              ? `${fmtDateFull(windowBooking.startMs)} · ${fmtTime(windowBooking.startMs)}–${fmtTime(windowBooking.startMs + windowBooking.durationMinutes * 60_000)}`
              : null
          }
          location={step === 'book' ? (windowBooking?.location ?? null) : null}
          accentColor={accentColor}
          showConfirm={step === 'book' && bookScreen === 'guest'}
          submitting={bookSubmitting}
          confirmLabel={tPublic('ctaConfirm')}
          submittingLabel={tPublic('ctaBooking')}
          onConfirm={() => guestFormRef.current?.submit()}
        />
      )}
    </>
  )
}
