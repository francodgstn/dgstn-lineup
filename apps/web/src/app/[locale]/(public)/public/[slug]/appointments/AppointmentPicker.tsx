'use client'

import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { resolvePaymentOptions, parseDateKey, parseDocId, parsePositiveInt, type ActivityMemberBenefit, type Benefit, type PaymentOption, type PublicFrom } from '@linyup/shared'
import {
  PromoCodeField,
  priceChangedAmount,
  priceChangedMessage,
  promoCheckoutErrorMessage,
  useAcceptedPrice,
  type AppliedPromo,
} from '@/components/booking/PromoCodeField'
import { clientPaymentSnapshot } from '@/lib/paymentSnapshot'
import { useRouter } from '@/i18n/navigation'
import { returnHref } from '@/lib/publicRoutes'
import { useStepUrl } from '@/hooks/useStepUrl'
import { usePublicTeam } from '../PublicTeamProvider'
import { formatCurrency } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { FlowShell } from '@/components/booking/FlowShell'
import { useBookingChrome } from '@/components/booking/BookingChrome'
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

/** What `checkout` adds on top of the identity: the Stage A MODIFIER the visitor
 *  typed, and the figure this screen actually rendered. `bookAppointment` (the
 *  free path) takes neither — there is no price for a code to change. */
type CheckoutExtras = { promoCode?: string; quotedAmount?: number }

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
// FlowShell), not a modal — same as the class 'details'/'returning' steps.
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
  providerId,
  activityId,
  startMs,
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
  /** The three ids the promo preview needs — its per-rail target key is
   *  `apt:{providerId}:{startMs}:{durationMinutes}`, and preview and checkout
   *  must derive the SAME one or a retry silently becomes a second use. */
  providerId: string
  activityId: string
  startMs: number
  currency: string
  locale: string
  backLabel: string
  /** Leaves the booking step entirely — back to the time picker. */
  onExit: () => void
  book: (args: BookArgs) => Promise<void>
  checkout: (args: BookArgs & CheckoutExtras) => Promise<{ url?: string; amount?: number }>
  onBooked: (details: { firstname: string; email: string }) => void
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const tPromo = useTranslations('Promo')
  const [error, setError] = useState<string | null>(null)
  const [submittingGuest, setSubmittingGuest] = useState(false)
  const [submittingPay, setSubmittingPay] = useState(false)
  // The first code field on this surface. Appointments take no gift card by
  // design, so a promo is the only instrument that can ride this rail.
  const [promoApplied, setPromoApplied] = useState<AppliedPromo | null>(null)

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
    /** The member's held types, kept so THIS screen can re-quote when the code
     *  changes on it — see `memberQuote`. Without them the member screen would
     *  be frozen at the figure resolved at verify time, and the remove control
     *  added below would take the discount off the code while leaving the
     *  discounted number on the button. */
    held: string[]
    amount: number
    viaSubscriptionTypeId?: string | null
    firstname: string
    email: string
  } | null>(null)
  // Transient state while an INCLUDED member's free booking is in flight.
  const [autobooking, setAutobooking] = useState(false)

  // ── The recovery half of the `price_changed` guard ────────────────────────
  // The server's own figure, once it has refused this screen's quote. It is BOTH
  // what the screen shows from then on AND what the next attempt sends back as
  // `quotedAmount` — which is what makes the refusal cost one extra, informed
  // confirmation instead of looping (the screen would otherwise re-derive the
  // same optimistic figure from the same optimistic snapshot and be refused
  // again, with no path to the real price).
  //
  // AN ACCEPTED FIGURE BELONGS TO ONE (target, code, IDENTITY) — the rule lives
  // in `useAcceptedPrice`, shared with every other mount. The TARGET half is
  // the remount: `SlotBookingForm` is keyed on provider/activity/start/duration,
  // so changing the slot builds a fresh component. The other two are the scope
  // below — and IDENTITY is the one this screen alone can move without changing
  // what is being bought, because a guest can sign in mid-flow and be re-quoted
  // as a member.
  const { acceptedPrice, acceptPrice } = useAcceptedPrice(
    `${memberPay?.contactId ?? 'guest'}|${promoApplied?.code ?? ''}`
  )

  /**
   * THE ONE PRICE COMPUTATION for this screen — the same resolver the server
   * runs, given the same target and (once signed in) the same held types.
   *
   * Both screens that show a price call this: the guest screen with the guest
   * snapshot, the post-verify path with the member's. A second, promo-free
   * computation anywhere here is what would let the screen promise one figure
   * while Stripe charged another.
   */
  const quote = (heldSubscriptionTypeIds: string[], authenticated: boolean) =>
    resolvePaymentOptions(
      clientPaymentSnapshot({ authenticated, heldSubscriptionTypeIds }),
      {
        kind: 'appointment',
        duration: { minutes: durationMinutes, priceAmount },
        benefit: memberBenefit,
      },
      promoApplied ? { promo: promoApplied } : undefined
    )

  const guestQuote = hasAnyPrice ? quote([], false) : null
  const guestPay = guestQuote?.options[0]
  const resolvedGuestAmount = guestPay?.type === 'pay' ? guestPay.amount : priceAmount
  // What the guest screen renders — the server's figure once it has told us one.
  const guestAmount = acceptedPrice ?? resolvedGuestAmount

  // ── The member screen's price, RE-QUOTED rather than frozen ────────────────
  // The same `quote`, with this member's held types — so the code the member can
  // now remove on that screen actually moves the figure the button charges.
  // `memberPay.amount` stays the fallback for the ONE case the client cannot
  // re-derive: the `payment_required` race, where the client resolved free and
  // the server did not, so there is no client `pay` option to read and the
  // server's number is the only truth there is.
  const memberQuote = memberPay ? quote(memberPay.held, true) : null
  const memberQuotePay = memberQuote?.options[0]
  const memberQuotedAmount = memberQuotePay?.type === 'pay' ? memberQuotePay.amount : null
  const memberPayNow = memberPay ? (acceptedPrice ?? memberQuotedAmount ?? memberPay.amount) : null

  /**
   * What every checkout call carries beyond the caller's identity.
   *
   * THE QUOTE RIDES THE CODE, and only the code. A promo is what turns the
   * rendered figure into a promise ("Code X applied", a struck-through base);
   * without one it is an optimistic render from a snapshot documented as partial,
   * and asserting it server-side would refuse ordinary bookings over divergences
   * that are nobody's fault and that this screen cannot re-render its way out of.
   */
  const checkoutExtras = (amount: number | null): CheckoutExtras =>
    promoApplied
      ? {
          promoCode: promoApplied.code,
          ...(typeof amount === 'number' ? { quotedAmount: amount } : {}),
        }
      : {}

  const offersMemberBenefit = !!memberBenefit?.subscriptionTypeIds.length

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
      const res = await checkout({ contactDetails, ...checkoutExtras(guestAmount) })
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error('no-url')
    } catch (err) {
      const { code } = errorDetails(err)
      // RECOVERY FIRST: the server has told us what this slot really costs. Show
      // that figure and let the visitor confirm again — the next attempt sends
      // it back as the quote and the booking completes. Without this the screen
      // re-derives the same optimistic number and is refused again, forever.
      // The sentence is composed by `priceChangedMessage`: on this rail the
      // guest's email reaches the server only now, so a refused code — not a
      // moved price — is the likeliest cause and must be the one named.
      const serverPrice = priceChangedAmount(err)
      if (serverPrice !== null) {
        acceptPrice(serverPrice)
        setError(priceChangedMessage(err, tPromo, formatCurrency(serverPrice, currency, locale)))
        return
      }
      // PAY-TIME promo refusals next: the preview is advisory about
      // availability, so a code that applied cleanly can still be refused here
      // (exhausted, busy, already used, disabled mid-checkout) — and those
      // arrive as `failed-precondition`, which the generic branch below would
      // otherwise render as "this slot is unavailable".
      const promoMsg = promoCheckoutErrorMessage(err, tPromo)
      if (promoMsg) setError(promoMsg)
      else if (code === 'functions/already-exists') setError(t('errorAlreadyBooked'))
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
    // The GUEST screen's error goes with the guest's figure. `useAcceptedPrice`
    // retires the number on this identity change; the sentence that named it —
    // "…the price without the code is CHF 40.00" — is the same fact in words and
    // has to retire with it, or the member screen renders it directly above a
    // button charging 24.00. (The reverse direction is `backToGuest`, which
    // already clears.)
    setError(null)
    const held = contactData.held_subscription_type_ids ?? []
    const contactFirstname = contactData.firstname || contactData.email.split('@')[0]
    // The SAME `quote` the guest screen used, with this member's held types —
    // so a code applied before signing in is still in the price afterwards, and
    // the member never sees two different figures for one booking. DISPLAY /
    // ROUTING only; book()/checkout() always re-resolve authoritatively.
    const { options } = quote(held, true)
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
              held,
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
        held,
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
        // The figure THIS screen is showing — re-quoted, not the one frozen at
        // verify time, or removing the code here would send a number the button
        // stopped displaying.
        ...checkoutExtras(memberPayNow),
      })
      if (res?.url) {
        window.location.href = res.url
        return
      }
      throw new Error('no-url')
    } catch (err) {
      const { code, reason } = errorDetails(err)
      // Recovery first — the pay button below re-renders at the server's figure
      // and pressing it again sends that number as the quote. Same composed
      // sentence as the guest path: a refused code names itself.
      const serverPrice = priceChangedAmount(err)
      if (serverPrice !== null) {
        acceptPrice(serverPrice)
        setError(priceChangedMessage(err, tPromo, formatCurrency(serverPrice, currency, locale)))
        return
      }
      const promoMsg = promoCheckoutErrorMessage(err, tPromo)
      if (promoMsg) {
        setError(promoMsg)
      } else if (code === 'functions/failed-precondition' && reason === 'covered') {
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
    // The server's figure wins once it has given us one — and with it the
    // struck-through base goes, because the discount it advertised is exactly
    // what the server declined to honour.
    const payNow = memberPayNow ?? memberPay.amount
    // WHAT THIS PRICE WAS BEFORE, read off the ONE quote rather than re-derived:
    // the resolver stamps at most one of `appliedBenefit` / `appliedPromo`, so
    // "member price" and "code price" are mutually exclusive structurally. Null
    // once the server has refused our figure (nothing left to strike through)
    // and null on the `payment_required` race, where there is no client quote to
    // read and `viaSubscriptionTypeId` from verify time is all we know.
    const strikeBase = (() => {
      if (acceptedPrice !== null) return null
      if (memberQuotePay?.type === 'pay') {
        const base =
          memberQuotePay.appliedBenefit?.baseAmount ?? memberQuotePay.appliedPromo?.baseAmount ?? null
        return base != null && base > memberQuotePay.amount ? base : null
      }
      return memberPay.viaSubscriptionTypeId && priceAmount != null && memberPay.amount !== priceAmount
        ? priceAmount
        : null
    })()
    return (
      <>
        <div>
          <BackButton label={backLabel} onClick={backToGuest} />
          <h1 className="text-2xl font-bold">{t('confirmedTitle')}</h1>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-baseline gap-2">
            {strikeBase != null && (
              <span className="text-sm text-muted-foreground line-through">
                {formatCurrency(strikeBase, currency, locale)}
              </span>
            )}
            <p className="text-base font-semibold">
              {t('yourPrice', { price: formatCurrency(payNow, currency, locale) })}
            </p>
          </div>

          {/* THE SECOND MOUNT: the applied code, WITH its remove control, on the
              screen that can be refused for it. The INPUT half is offered on the
              guest screen only — this mount renders the same component in its
              `applied` branch and nothing else, which is why it is wrapped in
              `promoApplied`.
              Without it, a pay-time reserve refusal here (exhausted, busy,
              already used, disabled mid-checkout) left the visitor pressing a
              button that could not succeed and no way to drop the code — the sale
              lost to a discount that no longer existed. Removing the code
              re-quotes the price above, relabels the button and completes the
              purchase at the member rate.
              The input half stays guest-only deliberately: the preview resolves
              its caller from a contact session, which this verification-code
              identity is not, so a code typed on this screen would be quoted as
              anonymous and could be refused again at pay time. */}
          {promoApplied && (
            <PromoCodeField
              teamId={teamId}
              target={{ kind: 'appointment', providerId, activityId, startMs, durationMinutes }}
              applied={promoApplied}
              onApplied={setPromoApplied}
              outcome={memberQuote?.promo ?? null}
              disabled={submittingPay}
            />
          )}
          {errorBox}
          <button
            type="button"
            disabled={submittingPay}
            onClick={onMemberPay}
            style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
          >
            {/* After a `price_changed` refusal this button IS the consent: it
                names the server's figure and pressing it re-sends that number. */}
            {submittingPay
              ? t('payingEllipsis')
              : t('confirmPay', { price: formatCurrency(payNow, currency, locale) })}
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

      {/* The price this screen renders comes from the ONE quote above, so an
          applied code moves it here and nowhere else — and the same number is
          what goes back as `quotedAmount`. The base is struck through only when
          a modifier actually lowered it. */}
      {hasAnyPrice && guestAmount != null && (
        <p className="text-sm text-muted-foreground">
          {priceAmount != null && guestAmount < priceAmount && (
            <span className="mr-1.5 line-through">
              {formatCurrency(priceAmount, currency, locale)}
            </span>
          )}
          {t('payToBook', { price: formatCurrency(guestAmount, currency, locale) })}
        </p>
      )}

      {/* Promo code — the only instrument this rail takes (appointments accept
          no gift card by design). The applied code persists in this component's
          state through the sign-in offer, so the post-verify member price
          already carries it — and the member-pay screen re-mounts the chip so
          it can be removed there too. Applying or removing one retires any
          accepted figure through the scope in `useAcceptedPrice`, not through a
          wrapper here. */}
      {hasAnyPrice && (
        <PromoCodeField
          teamId={teamId}
          target={{ kind: 'appointment', providerId, activityId, startMs, durationMinutes }}
          applied={promoApplied}
          onApplied={setPromoApplied}
          outcome={guestQuote?.promo ?? null}
          disabled={submittingGuest}
        />
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
/**
 * A booking is identified by exactly four fields — provider, activity, start,
 * duration (the same key `SlotBookingForm` uses). Everything else on
 * `WindowBooking` is denormalized from the loaded availability, so the object is
 * always rebuildable and never needs serializing into the URL.
 */
function buildWindowBooking(
  coach: AvailCoach,
  activity: AvailActivity,
  startMs: number,
  durationMinutes: number
): WindowBooking {
  const chosen =
    activity.durations.find((d) => d.minutes === durationMinutes) ?? activity.durations[0] ?? null
  return {
    providerId: coach.providerId,
    providerName: coach.providerName,
    activityId: activity.activityId,
    activityName: activity.activityName,
    startMs,
    durationMinutes: chosen?.minutes ?? durationMinutes,
    location: activity.location,
    onlineUrl: activity.onlineUrl,
    priceAmount: chosen?.priceAmount ?? null,
    memberBenefit: activity.memberBenefit,
  }
}

// Duration + day are OWNED BY THE PARENT, not this component. They used to live
// here, which meant leaving the `time` step destroyed them — so Back from the
// booking step, or a history restore, silently reset the visitor's choices. They
// are also two of the four fields that identify a booking, so the URL needs them.
function TimePicker({
  coach,
  activity,
  currency,
  locale,
  duration,
  onDurationChange,
  selectedDateKey,
  onDateChange,
  onPick,
}: {
  coach: AvailCoach
  activity: AvailActivity
  currency: string
  locale: string
  duration: number
  onDurationChange: (minutes: number) => void
  selectedDateKey: string | null
  onDateChange: (dateKey: string | null) => void
  onPick: (startMs: number, duration: AvailDuration) => void
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const setDuration = onDurationChange
  const setSelectedDateKey = onDateChange

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

  // Re-validate the selected day whenever the duration (or activity) changes —
  // the previously-selected day may not offer the new duration. Moved up here
  // WITH the state: without it, a restored duration whose day has no slots
  // silently renders an empty grid.
  useEffect(() => {
    if (selectedDateKey && availableDates.includes(selectedDateKey)) return
    setSelectedDateKey(availableDates[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, activity.activityId, availableDates.join(',')])

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
// book. Wrapped in FlowShell so it wears the same team top bar, content width
// and branded footer as the class BookingForm, and the booking step renders
// in-page (not a modal) with the shared bottom summary bar. A `?activity=` deep
// link preselects that offering: coaches are pre-filtered server-side, and when
// exactly one coach offers it the coach step is skipped entirely.

export default function AppointmentPicker({
  slug,
  presetActivityId,
  presetProviderId,
  presetDate,
  from,
  disableStepUrl,
}: {
  slug: string
  presetActivityId?: string
  /**
   * `?provider=` / `?date=` — set when the visitor clicked a specific
   * availability window, which already identifies the coach and the day. Without
   * them the picker would ask them to choose again what they just clicked.
   */
  presetProviderId?: string
  presetDate?: string
  /** `?from=` — which surface to return to. See `returnHref`. */
  from?: PublicFrom
  /**
   * Suppress this flow's own history writes — set by an overlay host, which owns
   * the address bar while the panel is open. See BookingForm for the same prop.
   */
  disableStepUrl?: boolean
}) {
  const t = useTranslations('AppointmentBooking')
  const tPublic = useTranslations('PublicBooking')
  const locale = useLocale()
  // 'page' unless an overlay host wraps this flow — see BookingChrome.
  const chrome = useBookingChrome()
  const router = useRouter()
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
  // Lifted out of TimePicker: leaving the `time` step used to destroy them, so
  // Back from the booking step reset the visitor's duration and day. They are
  // also part of a booking's identity, so history restore needs them here.
  const [duration, setDuration] = useState<number | null>(null)
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)

  // In-page booking step ↔ sticky bar wiring (mirrors the class BookingForm):
  // the sticky bar's Confirm fires the guest form's sr-only submit, and only
  // shows on the guest screen — the booking form reports its screen up here.
  const [bookScreen, setBookScreen] = useState<BookScreen>('guest')
  const [bookSubmitting, setBookSubmitting] = useState(false)
  const guestFormRef = useRef<GuestDetailsFormHandle>(null)

  // Where leaving the flow goes. `?from=` names the surface the visitor arrived
  // from; absent/dead → the team's default surface, resolved HERE rather than by
  // bouncing through the team root's client redirect. Declared with the other
  // hooks — the `confirmed` early return below would otherwise skip it.
  const backTo = useMemo(() => returnHref(team, slug, from), [team, slug, from])

  // DERIVED, not stored: "the coach step was skipped because exactly one coach
  // offers the preselected activity". As one-shot state it survived a history
  // restore with a stale value and mislabelled the time step's Back button.
  // The coach step was never shown when the visitor arrived naming a coach,
  // or when there is only one to choose from.
  const skippedCoachStep = !!presetActivityId && (!!presetProviderId || coaches.length === 1)

  // The activity's first duration is the default until the visitor picks one.
  // Derived rather than seeded into state, so switching activity can't leave a
  // duration the new activity doesn't offer.
  const effectiveDuration =
    duration != null && selectedActivity?.durations.some((d) => d.minutes === duration)
      ? duration
      : (selectedActivity?.durations[0]?.minutes ?? 60)

  // ── Step ↔ URL ────────────────────────────────────────────────────────────
  // Same contract as the class flow (see BookingForm): one effect owns the whole
  // mapping, raw pushState so the loaded `coaches` array survives Back.
  // `bookScreen` is deliberately NOT synced — it's an internal sub-state of the
  // `book` step with its own back affordance, and pushing it would make Back
  // behave differently between the two flows.
  const stepUrl = useStepUrl({
    disabled: disableStepUrl,
    sticky: { from, activity: presetActivityId },
    onRestore: (params) => {
      // popstate hands back whatever is in the address bar — parse it like any
      // inbound param, not as trusted state we wrote ourselves.
      const providerId = parseDocId(params.get('provider'))
      const coach = providerId ? coaches.find((c) => c.providerId === providerId) : null
      if (!coach) {
        setWindowBooking(null)
        // Back to the flow's ENTRY step, which isn't always `coach`: a preset
        // activity with a single coach never showed one, so re-enter at `time`
        // exactly as a fresh load would, rather than on a step the visitor has
        // never seen.
        const only = skippedCoachStep ? coaches[0] : null
        if (only?.activities[0]) {
          setSelectedCoach(only)
          setSelectedActivity(only.activities[0])
          setStep('time')
          return
        }
        setSelectedCoach(null)
        setSelectedActivity(null)
        setStep('coach')
        return
      }
      setSelectedCoach(coach)

      const activityId = parseDocId(params.get('activity'))
      const activity = activityId
        ? coach.activities.find((a) => a.activityId === activityId)
        : undefined
      if (!activity) {
        setSelectedActivity(null)
        setWindowBooking(null)
        setStep('activity')
        return
      }
      setSelectedActivity(activity)

      // Only durations this activity actually offers — a crafted `?duration=`
      // must not reach the booking callable as a length the studio never priced.
      const mins = parsePositiveInt(params.get('duration'), 24 * 60)
      if (mins && activity.durations.some((d) => d.minutes === mins)) setDuration(mins)
      const day = parseDateKey(params.get('date'))
      if (day) setSelectedDateKey(day)

      // windowBooking is fully derivable from {provider, activity, start,
      // duration} — the same four fields SlotBookingForm already keys on — so
      // rebuild it instead of putting a denormalized object in the URL.
      // The start must be a real free slot, not merely a number: otherwise a
      // crafted link could put an arbitrary time in front of the visitor.
      const startMs = parsePositiveInt(params.get('start'))
      const isRealSlot =
        !!startMs &&
        !!mins &&
        activity.days.some((d) => (d.slotsByDuration[String(mins)] ?? []).includes(startMs))
      const restoredBooking = isRealSlot ? buildWindowBooking(coach, activity, startMs, mins) : null
      setWindowBooking(restoredBooking)
      setBookScreen('guest')
      setStep(restoredBooking ? 'book' : 'time')
    },
  })

  const stepQuery: Record<string, string | number | undefined> =
    step === 'coach'
      ? {}
      : step === 'activity'
        ? { provider: selectedCoach?.providerId }
        : {
            provider: selectedCoach?.providerId,
            activity: selectedActivity?.activityId,
            duration: effectiveDuration,
            date: selectedDateKey ?? undefined,
            ...(step === 'book' && windowBooking ? { start: windowBooking.startMs } : {}),
          }

  const syncedQueryRef = useRef<string | null>(null)
  const prevStepRef = useRef<PickerStep | null>(null)
  const seenRestoreRef = useRef(0)
  useEffect(() => {
    if (loading) return
    const key = JSON.stringify(stepQuery)
    // This run is a restore's own re-render — see BookingForm for why this is a
    // counter rather than an "is restoring" flag.
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
    // Push only on a real step transition; refinements inside `time` (duration
    // chips, paging the calendar) rewrite, or Back would walk every fiddle.
    if (isFirst || !stepChanged) stepUrl.replace(stepQuery)
    else stepUrl.push(stepQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedCoach?.providerId, selectedActivity?.activityId, effectiveDuration, selectedDateKey, windowBooking?.startMs, loading])

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
        // A clicked availability window names the coach: land on their times
        // directly, whether or not they're the team's only provider.
        const presetCoach = presetProviderId
          ? list.find((c) => c.providerId === presetProviderId)
          : list.length === 1
            ? list[0]
            : null
        if (presetActivityId && presetCoach) {
          const activity =
            presetCoach.activities.find((a) => a.activityId === presetActivityId) ??
            presetCoach.activities[0]
          if (activity) {
            setSelectedCoach(presetCoach)
            setSelectedActivity(activity)
            if (presetDate) setSelectedDateKey(presetDate)
            setStep('time')
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
  }, [teamId, presetActivityId, presetProviderId, presetDate, reloadNonce])

  function retryLoad() {
    setReloadNonce((n) => n + 1)
  }

  // ── Confirmation — wrapped in FlowShell so the team top bar persists,
  // matching the class flow's confirmed step. ──
  if (confirmed) {
    return (
      <FlowShell teamName={teamName} slug={slug} accentColor={accentColor} showBranding={showBranding} backTo={backTo}>
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
      </FlowShell>
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
      // No step to go back to — leave the flow, to wherever the visitor came
      // from rather than the team root's default surface.
      router.push(backTo.href)
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

  return (
    <>
      <FlowShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        wide={step === 'time'}
        showBranding={showBranding}
        backTo={backTo}
        overlayTitle={selectedActivity?.activityName}
        bar={
          showBar && selectedActivity ? (
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
              position={chrome.kind === 'overlay' ? 'container' : 'viewport'}
              showConfirm={step === 'book' && bookScreen === 'guest'}
              submitting={bookSubmitting}
              confirmLabel={tPublic('ctaConfirm')}
              submittingLabel={tPublic('ctaBooking')}
              onConfirm={() => guestFormRef.current?.submit()}
            />
          ) : null
        }
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
              duration={effectiveDuration}
              onDurationChange={setDuration}
              selectedDateKey={selectedDateKey}
              onDateChange={setSelectedDateKey}
              onPick={(startMs, duration) => {
                setWindowBooking(
                  buildWindowBooking(selectedCoach, selectedActivity, startMs, duration.minutes)
                )
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
              providerId={windowBooking.providerId}
              activityId={windowBooking.activityId}
              startMs={windowBooking.startMs}
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
      </FlowShell>
    </>
  )
}
