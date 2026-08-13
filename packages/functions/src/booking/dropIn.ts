/* eslint-disable no-console */
// createDropInCheckout — pay-per-class booking (Stripe Connect one-off charge).
//
// A contact NOT covered by an activity's access rule may pay the drop-in price to
// book a single group-class session. We create a PENDING booking (a hold) + a Connect
// checkout; the webhook (kind: 'drop_in') confirms the booking on payment success.
// Payment itself is the proof of intent, so no email-verification step is needed here.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  GUEST_SNAPSHOT,
  WAITLIST_SUBCOLLECTION,
  countHoldingSeats,
  isPastBookingCutoff,
  sanitizeBookingAnswers,
  seatsFree,
  normalizeBenefit,
  resolveActivityAccessRule,
  resolvePaymentOptions,
  type ActivityAccessRule,
  type AnyBenefit,
  type DropInTarget,
  type GiftCardRedemptionPlan,
  type PaymentOptionsResult,
} from '@linyup/shared'
import { loadContactPaymentSnapshot } from './access'
import { loadEnabledTeam, requireChargeableAccount } from '../connect/access'
import {
  assertUnderCheckoutRateLimit,
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES,
  startOneOffCheckout,
  STRIPE_MAX_CHECKOUT_EXPIRY_MINUTES,
} from '../connect/checkout'
import {
  commitGiftCardDrawdown,
  giftCardCurrency,
  releaseGiftCardHold,
  reserveGiftCardDrawdown,
} from '../connect/giftCards'
import { generateSecureToken, generateBookingReference } from '../utils/crypto'
import { optionalContactSessionFromRequest } from '../utils/contactSession'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'
import { resolveSingleContact } from '../utils/contacts'
// Pure trial-gate helpers, shared with bookSession's free trial door — see
// booking/index.ts's module doc comment. Mirrors the appointments/index.ts
// same-directory-index import pattern already used elsewhere in this package.
import { holdWriteCountDelta, resolveTrialEligibility, type ReplacedBookingShape } from './index'
import {
  resolveClaimCheckoutWindow,
  WAITLIST_CLAIM_RATE_LIMIT_BUCKET,
  type ClaimCheckoutWindow,
} from './waitlist/constants'

const HOLD_MINUTES = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Resolve the drop-in payment options for a KNOWN contact — the SAME semantics
 * bookSession uses, via the shared resolver:
 *  • a usable lesson-credit balance counts as covered (a member with credits
 *    left must not be sold a redundant drop-in);
 *  • an EXHAUSTED/expired pack does NOT count — that contact gets to pay,
 *    fixing the old deadlock where bookSession denied no_credits while the
 *    previous field-only check here also refused the drop-in;
 *  • a held benefit type reduces the drop-in price (member rate — percent_off
 *    or fixed_price on Activity.memberBenefit).
 */
async function resolveDropInForContact(
  teamId: string,
  target: DropInTarget,
  contact: FirebaseFirestore.DocumentData & { id: string },
  /** Session start — meters usage limits against the week the class happens. */
  usageAt?: Date
): Promise<PaymentOptionsResult> {
  const benefit = normalizeBenefit(target.benefit)
  const snapshot = await loadContactPaymentSnapshot({
    teamId,
    contact,
    relevantTypeIds: [
      ...(target.accessRule.subscriptionTypeIds ?? []),
      ...(benefit?.subscriptionTypeIds ?? []),
    ],
    usageAt,
  })
  return resolvePaymentOptions(snapshot, target)
}

const isCoveredResult = (r: PaymentOptionsResult): boolean =>
  r.options.some((o) => o.type === 'covered' || o.type === 'spend_credits')

export const createDropInCheckout = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'createDropInCheckout')
  const data = request.data as {
    teamId?: string
    sessionId?: string
    contactDetails?: { firstname?: string; lastname?: string; email?: string; phone?: string }
    slug?: string
    locale?: string
    origin?: string
    idempotencyKey?: string
    // Paid trial: charges Activity.trialPriceAmount instead of dropIn.priceAmount,
    // requires trialEnabled, skips the drop-in enabled/priced requirement, and
    // enforces the trial-eligibility (one trial per person) check — see
    // Activity.trialPriceAmount and Contact.trial_used_at (@linyup/shared).
    trial?: boolean
    /** Optional gift-card code to draw down against this booking's price. */
    giftCardCode?: string
    /** Answers to the activity's bookingQuestions, keyed by field id. Stored on
     *  the PENDING booking so they survive the Stripe round-trip. */
    questionAnswers?: Record<string, unknown>
    /** A waitlist offer's single-use `offer_token`. Present ⇒ this is a CLAIM:
     *  the seat is already held for the offer's contact, the caller is that
     *  contact (the token names them — no contactDetails are read), and the
     *  hold's deadline replaces the ordinary 30-minute one on both the booking
     *  and the Stripe session. See booking/waitlist/claim.ts. */
    waitlistToken?: string
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!data?.sessionId) throw new HttpsError('invalid-argument', 'sessionId is required')
  const { teamId, sessionId } = data
  const locale = data.locale ?? 'en'
  const db = admin.firestore()

  // ── Rate limit: which bucket, and charged or peeked ────────────────────────
  // Public endpoint, so the ordinary drop-in buyer pays the same per-IP hourly
  // quota as every other Connect checkout.
  //
  // A CLAIM does not. It is the paid half of `claimWaitlistSeat` — the free half
  // returns `requiresPayment` and sends the caller straight here with the offer
  // token — so charging it to the shared 'checkout' bucket puts the whole
  // peek/charge split back where it started: a gym NAT that has already produced
  // 30 checkout attempts this hour locks out the ONE person on earth holding a
  // live, single-use, time-boxed offer, their claim lapses, and the seat rolls on
  // to somebody else. So the claim peeks at the claim bucket (which still bounds
  // an enumerator, because it runs before any query) and charges only the
  // attempts whose token turns out to name no live offer. Same two calls, same
  // bucket, same order as claim.ts — the two must not disagree about who is
  // entitled to a free attempt.
  const waitlistToken = typeof data.waitlistToken === 'string' ? data.waitlistToken.trim() : ''
  /** THE only attempts a claim pays for: a token that resolves to no live offer
   *  is by definition not the person the seat is being held for. */
  const chargeClaimAttempt = (): Promise<void> =>
    checkoutRateLimit(request.rawRequest?.ip, WAITLIST_CLAIM_RATE_LIMIT_BUCKET)
  if (waitlistToken) {
    await assertUnderCheckoutRateLimit(request.rawRequest?.ip, WAITLIST_CLAIM_RATE_LIMIT_BUCKET)
  } else {
    await checkoutRateLimit(request.rawRequest?.ip)
  }

  // Team must have Connect enabled + a chargeable account.
  const team = await loadEnabledTeam(teamId)
  // Chargeable-account gate: a FULL-COVER gift-card redemption moves no money
  // and must work without Stripe onboarding — when a code is supplied, the
  // check is deferred to the orchestrator (which re-checks before any charge;
  // the reserved hold is released if that late check throws).
  if (!data.giftCardCode) requireChargeableAccount(team)

  // Session must be bookable, in the future, and a group class.
  const sessionSnap = await db.collection('sessions').doc(sessionId).get()
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found')
  const sessionData = sessionSnap.data()!
  if (sessionData.teamId !== teamId) {
    throw new HttpsError('permission-denied', 'Session does not belong to this team')
  }
  if (!sessionData.allowBooking) {
    throw new HttpsError('permission-denied', 'Bookings are not allowed for this session')
  }
  if ((sessionData.start as Timestamp).toMillis() < Date.now()) {
    throw new HttpsError('failed-precondition', 'Cannot book sessions in the past')
  }
  // Online booking cutoff — same guard as the free path (bookSession); a
  // member paying instead of using the free door must not be able to route
  // around it.
  const cutoffMinutes = (
    (team.data?.settings as Record<string, unknown> | undefined)?.booking as
      | { cutoffMinutes?: number }
      | undefined
  )?.cutoffMinutes
  if (isPastBookingCutoff(sessionData.start as Timestamp, cutoffMinutes)) {
    throw new HttpsError('failed-precondition', 'Online booking has closed for this session.')
  }
  if (sessionData.activityType === 'appointment') {
    throw new HttpsError('failed-precondition', 'Drop-in is not available for appointment sessions')
  }

  // Resolve the activity → drop-in config + access rule.
  const activityId = sessionData.activityId as string | undefined
  if (!activityId) throw new HttpsError('failed-precondition', 'Session has no activity')
  const actSnap = await db.collection('activities').doc(activityId).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'Activity not found')
  const activity = actSnap.data()!
  // Book-form answers, narrowed to THIS activity's own questions. Same helper
  // the free path uses, so the two can't disagree about what gets stored.
  const sanitizedAnswers = sanitizeBookingAnswers(
    Array.isArray(activity.bookingQuestions) ? activity.bookingQuestions : null,
    data.questionAnswers
  )
  const activityName =
    (activity.name as string) || (sessionData.activityName as string) || 'Class'
  const isTrial = data.trial === true
  const trialPriceAmount = activity.trialPriceAmount as number | null | undefined

  // The drop-in enabled/priced requirement does NOT apply in trial mode — a
  // class can offer a paid trial with no drop-in configured at all.
  const dropIn = activity.dropIn as { enabled?: boolean; priceAmount?: number } | undefined
  if (!isTrial && (!dropIn?.enabled || typeof dropIn.priceAmount !== 'number')) {
    throw new HttpsError('failed-precondition', 'Drop-in is not available for this class')
  }
  if (isTrial && (activity.trialEnabled !== true || typeof trialPriceAmount !== 'number')) {
    throw new HttpsError('failed-precondition', 'This class does not offer a paid trial')
  }
  const accessRule = resolveActivityAccessRule({
    accessRule: activity.accessRule as ActivityAccessRule | undefined,
    isFreeTrial: activity.isFreeTrial as boolean | undefined,
  })
  if (accessRule.type === 'open') {
    throw new HttpsError('failed-precondition', 'This class is free to book — no payment needed')
  }

  // Config sanity: the BASE price must be chargeable (member rates clamp to the
  // floor, so a valid base guarantees a valid effective amount).
  const priceAmountMajor = isTrial ? (trialPriceAmount as number) : (dropIn!.priceAmount as number)
  requireChargeableAmountFromMajor(priceAmountMajor)

  // The one target the resolver prices for every caller of this class —
  // includes the member rate (Activity.memberBenefit on the drop-in price).
  const dropInTarget: DropInTarget = {
    kind: 'drop_in',
    accessRule,
    dropIn: dropIn ?? null,
    trial: { enabled: activity.trialEnabled === true, priceAmount: trialPriceAmount ?? null },
    asTrial: isTrial,
    benefit: (activity.memberBenefit as AnyBenefit | undefined) ?? null,
  }
  // Set on every path below: known contacts resolve with their snapshot
  // (coverage refusal + member rate), fresh guests resolve as GUEST_SNAPSHOT.
  let resolved: PaymentOptionsResult

  // Resolve the contact (payment is proof — no email verification needed here).
  let contactId: string
  let email: string
  let firstname: string
  let lastname: string
  let phone: string | null = null
  let isNewContact = false

  // Trust ONLY the verified contact-session token for the caller's identity —
  // never a contactId from the request body (which would let anyone act as, and
  // enumerate, arbitrary contacts of the team). Guests carry no session and fall
  // through to the email/name path below.
  const contactSession = optionalContactSessionFromRequest(request)

  // ── A waitlist claim, if that is what this is ──────────────────────────────
  // Resolved FIRST and from storage, because the offer decides two things this
  // callable normally decides for itself: WHO is paying (the entry names the
  // contact, so a claimant never re-types their details and can never claim as
  // somebody else) and WHEN the hold dies. Everything here is a read — a bad
  // token must leave no trace, least of all a reserved gift-card drawdown.
  const waitlistRef = db.collection('sessions').doc(sessionId).collection(WAITLIST_SUBCOLLECTION)
  let claim: {
    entryRef: FirebaseFirestore.DocumentReference
    contactId: string
    /** THE deadline: the booking hold's expires_at AND the Stripe session's. */
    expiresAt: Timestamp
    answers: Record<string, unknown> | null
  } | null = null
  let claimCheckout: ClaimCheckoutWindow | null = null
  if (waitlistToken) {
    if (isTrial) {
      // A trial is a newcomer's first class, taken through the guest door with
      // its own once-per-person gate. Someone who queued for a full class and
      // was offered a seat is not that person. Charged: no claimant's client
      // ever sends this pair, so it is only reachable by hand — and it would
      // otherwise be a way to reach this callable's reads with a token that is
      // never looked up, and so never costs quota either way.
      await chargeClaimAttempt()
      throw new HttpsError('invalid-argument', 'A waitlist claim cannot be booked as a trial')
    }
    // Scoped to THIS session's queue — the token is unguessable, but a lookup
    // that can only ever return an entry of the session being paid for cannot
    // be pointed at another class by a mismatched request.
    const offerSnap = await waitlistRef.where('offer_token', '==', waitlistToken).limit(1).get()
    const offer = offerSnap.docs[0]
    const offerExpiresAt = offer?.data().offer_expires_at as Timestamp | undefined
    if (!offer || offer.data().status !== 'offered' || !offerExpiresAt) {
      await chargeClaimAttempt()
      throw new HttpsError('failed-precondition', 'This offer is no longer available.', {
        reason: 'claim_expired',
      })
    }
    if (offerExpiresAt.toMillis() <= Date.now()) {
      await chargeClaimAttempt()
      throw new HttpsError('failed-precondition', 'This offer has expired.', {
        reason: 'claim_expired',
      })
    }
    // A claimant may reach the pay button at minute 119 of a 120-minute window,
    // and Stripe will not create a session that expires sooner than its own
    // floor. Refuse with a reason the page renders as "this offer is about to
    // expire" rather than a generic failure — or, worse, a Stripe session that
    // outlives the seat it is paying for.
    //
    // Neither this refusal nor the contact-mismatch one below charges quota:
    // past this point the token HAS resolved to a live offer, and the two
    // callers who hit them are the rightful holder arriving late and someone who
    // was forwarded their link. Charging the first would let a shared NAT cost
    // that person their only retry.
    claimCheckout = resolveClaimCheckoutWindow({
      nowMs: Date.now(),
      claimExpiresAtMs: offerExpiresAt.toMillis(),
      minMinutes: SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES,
      maxMinutes: STRIPE_MAX_CHECKOUT_EXPIRY_MINUTES,
    })
    if (!claimCheckout.payable) {
      throw new HttpsError('failed-precondition', 'This offer is about to expire.', {
        reason: 'claim_window_too_short',
      })
    }
    if (contactSession && contactSession.teamId === teamId && contactSession.contactId !== offer.id) {
      throw new HttpsError('permission-denied', 'This offer belongs to another contact')
    }
    claim = {
      entryRef: offer.ref,
      contactId: offer.id,
      expiresAt: offerExpiresAt,
      answers: (offer.data().question_answers as Record<string, unknown> | undefined) ?? null,
    }
  }

  // The booking answers were collected at JOIN so the claim page never re-asks
  // them — and both booking writes below are bare `.set()`s that replace the
  // document wholesale, so they have to be re-sent or the claim silently throws
  // away what the person already told the studio. A claim page that DOES send
  // them (an activity that added a question after they joined) wins.
  const claimAnswers = sanitizedAnswers ?? claim?.answers ?? null

  if (claim) {
    const cSnap = await db.collection('contacts').doc(claim.contactId).get()
    if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
      throw new HttpsError('not-found', 'Contact not found')
    }
    const c = cSnap.data()!
    contactId = cSnap.id
    email = (c.email as string) || ''
    firstname = (c.firstname as string) || ''
    lastname = (c.lastname as string) || ''
    phone = (c.phone as string) || null
    resolved = await resolveDropInForContact(
      teamId,
      dropInTarget,
      { ...c, id: cSnap.id },
      (sessionData.start as Timestamp).toDate()
    )
    if (isCoveredResult(resolved)) {
      // Covered claims never come through checkout — claimWaitlistSeat settles
      // them for free, and charging here would sell a seat this person's
      // membership already pays for.
      throw new HttpsError('failed-precondition', 'You can already book this class for free')
    }
  } else if (contactSession && contactSession.teamId === teamId) {
    const cSnap = await db.collection('contacts').doc(contactSession.contactId).get()
    if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
      throw new HttpsError('not-found', 'Contact not found')
    }
    const c = cSnap.data()!
    contactId = cSnap.id
    email = (c.email as string) || ''
    firstname = (c.firstname as string) || ''
    lastname = (c.lastname as string) || ''
    phone = (c.phone as string) || null
    resolved = await resolveDropInForContact(
      teamId,
      dropInTarget,
      { ...c, id: cSnap.id },
      (sessionData.start as Timestamp).toDate()
    )
    if (isCoveredResult(resolved)) {
      throw new HttpsError('failed-precondition', 'You can already book this class for free')
    }
  } else {
    const cd = data.contactDetails
    email = (cd?.email ?? '').toLowerCase().trim()
    firstname = (cd?.firstname ?? '').trim()
    lastname = (cd?.lastname ?? '').trim()
    phone = cd?.phone?.trim() || null
    if (!EMAIL_RE.test(email) || !firstname || !lastname) {
      throw new HttpsError('invalid-argument', 'firstname, lastname and a valid email are required')
    }
    // Exact match (email + name) → reuse; else create a trial contact.
    const existing = await db
      .collection('contacts')
      .where('teamId', '==', teamId)
      .where('email', '==', email)
      .get()
    const match = existing.docs.find((d) => {
      const c = d.data()
      return (
        c.firstname?.toLowerCase().trim() === firstname.toLowerCase() &&
        c.lastname?.toLowerCase().trim() === lastname.toLowerCase()
      )
    })
    if (match) {
      contactId = match.id
      resolved = await resolveDropInForContact(
        teamId,
        dropInTarget,
        { ...match.data(), id: match.id },
        (sessionData.start as Timestamp).toDate()
      )
      if (isCoveredResult(resolved)) {
        throw new HttpsError('failed-precondition', 'You can already book this class for free')
      }
      // An existing OFF-FUNNEL contact (form/shop lead — no stage) booking a
      // drop-in enters the funnel normally at this point.
      if (!match.data().acquisition_stage) {
        await match.ref.update({
          acquisition_stage: 'trial_booked',
          acquisition_stage_updated_at: FieldValue.serverTimestamp(),
          trial_booked_at: FieldValue.serverTimestamp(),
        })
      }
    } else {
      isNewContact = true
      const ref = db.collection('contacts').doc()
      await ref.set({
        firstname,
        lastname,
        email,
        phone,
        acquisition_stage: 'trial_booked',
        acquisition_stage_updated_at: FieldValue.serverTimestamp(),
        entry: 'booking',
        // Doesn't count toward the cap until they attend/pay (the drop-in payment
        // webhook clears the flag on success). See Contact.provisional.
        provisional: true,
        teamId,
        archived_at: null,
        deleted_at: null,
        created_at: FieldValue.serverTimestamp(),
      })
      contactId = ref.id
      resolved = resolvePaymentOptions(GUEST_SNAPSHOT, dropInTarget)
    }
  }

  // The caller's effective amount — base price, or their member rate when a
  // held benefit type applies (percent_off / fixed_price, clamped ≥ 0.50).
  const payOption = resolved.options.find((o) => o.type === 'pay')
  if (!payOption) {
    // A KNOWN contact who already used their trial gets the dedicated,
    // reason-carrying refusal the web maps to its trial-used message — the
    // generic throw below would swallow it (guests are covered by the
    // email-resolved eligibility check further down).
    if (resolved.denial === 'trial_used') {
      throw new HttpsError('failed-precondition', 'This email has already used a trial', {
        reason: 'trial_used',
      })
    }
    throw new HttpsError('failed-precondition', 'Drop-in is not available for this class')
  }
  const priceMajor = payOption.amount
  const amount = requireChargeableAmountFromMajor(priceMajor)

  // Trial eligibility: one trial per person, ever — free or paid. Resolved by
  // email (never the looser name+email match above), same lookup bookSession's
  // free trial door uses. Only enforced in trial mode.
  if (isTrial) {
    const { contactId: eligibilityContactId } = await resolveSingleContact(teamId, email)
    let trialUsedAt: unknown = null
    if (eligibilityContactId) {
      const eligibilityDoc = await db.collection('contacts').doc(eligibilityContactId).get()
      trialUsedAt = eligibilityDoc.exists ? eligibilityDoc.data()?.trial_used_at : null
    }
    const eligibility = resolveTrialEligibility(trialUsedAt)
    if (!eligibility.ok) {
      throw new HttpsError('failed-precondition', 'This email has already used a trial', {
        reason: eligibility.reason,
      })
    }
  }

  // Guard: already registered (confirmed booking or attendance).
  const sessionRef = db.collection('sessions').doc(sessionId)
  const bookingsRef = sessionRef.collection('bookings')
  const bookingRef = bookingsRef.doc(contactId)
  const contactDocRef = db.collection('contacts').doc(contactId)
  const [bookingSnap, participantSnap] = await Promise.all([
    bookingRef.get(),
    sessionRef.collection('participants').doc(contactId).get(),
  ])
  if (participantSnap.exists || (bookingSnap.exists && bookingSnap.data()?.status === 'confirmed')) {
    throw new HttpsError('already-exists', 'You are already registered for this session')
  }

  // ── Capacity, fail-fast ────────────────────────────────────────────────────
  // This callable had NO capacity check whatsoever: a full class sold drop-ins,
  // deterministically, no race required. The authoritative gate is inside the
  // booking transaction below; this early copy (same helper, same predicate)
  // refuses before anything with a side effect happens — before a gift-card
  // drawdown is reserved, before a Stripe session exists.
  //
  // It sits AFTER contact resolution because it needs the caller's own id: their
  // live-but-unpaid hold occupies a seat, and counting it would refuse them
  // permission to pay for the seat they are already holding.
  const preflightSeats = seatsFree(
    sessionData.max_participants as number | undefined,
    countHoldingSeats((await bookingsRef.get()).docs, Date.now(), contactId)
  )
  if (preflightSeats <= 0) {
    throw new HttpsError('resource-exhausted', 'This session is fully booked.', {
      reason: 'session_full',
    })
  }

  const bookingToken = generateSecureToken()
  const bookingReference = generateBookingReference()
  // A claim has exactly ONE deadline, and this is it: the booking hold, the
  // waitlist entry's `offer_expires_at` and the Stripe session below all expire
  // at the same instant. Two timers for one seat is how a seat gets sold twice —
  // the hold releases at +30, someone else takes it, and the original payer's
  // Stripe session is still live hours later. HOLD_MINUTES does not apply to a
  // claim at all.
  const expiresAt = claim?.expiresAt ?? Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60_000)

  // Optional gift-card redemption — reserve a drawdown against the total BEFORE
  // writing any booking doc (a failed/invalid code must leave no trace).
  let giftCardPlan: GiftCardRedemptionPlan | null = null
  let giftCardHoldKey: string | null = null
  /** Give the reserved stored value back rather than leaving it held until its
   *  lazy expiry. Called on EVERY failure after the reservation — the capacity
   *  refusal below as well as a Stripe failure. */
  const releaseReservedGiftCard = async (): Promise<void> => {
    if (giftCardPlan && data.giftCardCode && giftCardHoldKey) {
      await releaseGiftCardHold({
        teamId,
        code: data.giftCardCode,
        holdKey: giftCardHoldKey,
      }).catch(() => undefined)
    }
  }
  if (data.giftCardCode) {
    giftCardHoldKey = generateSecureToken(16)
    giftCardPlan = await reserveGiftCardDrawdown({
      teamId,
      code: data.giftCardCode,
      totalMajor: priceMajor,
      holdKey: giftCardHoldKey,
      // The card must match the currency this booking will actually be charged
      // in — see the guard in reserveGiftCardDrawdown.
      chargeCurrency: giftCardCurrency(team.data?.default_currency as string | undefined),
    })
  }

  if (giftCardPlan && giftCardPlan.residual === 0) {
    // FULL COVER — no Stripe at all: confirm the booking directly, mirroring
    // handleDropInCheckout's confirm effects (minus payment_intent_id, which
    // doesn't exist on this path).
    //
    // Seat + counter in one transaction, for the same reason as bookSession: the
    // session doc is the serialization point, and `bookings_count` is written as
    // an absolute value from the read set (the old `increment(1)` landed on top
    // of trackBookings' recount of this very write). A refusal here has to hand
    // the reserved stored value back — the drawdown is committed further down,
    // so bailing out before that leaves the balance held but unspent.
    //
    // A CLAIM flips its waitlist entry in this very transaction. This branch
    // creates no Stripe session, so no webhook ever fires for it and there is no
    // later hook to hang the flip on — and the seat becomes permanent HERE. An
    // entry left at 'offered' behind a confirmed, gift-card-paid booking is the
    // worst state the feature has: the sweep would match it, and a release that
    // did not check the booking would delete a paid seat and hand it to the next
    // person, costing the buyer both the balance and the class.
    try {
      await db.runTransaction(async (tx) => {
        const freshSession = await tx.get(sessionRef)
        if (!freshSession.exists) throw new HttpsError('not-found', 'Session not found')
        const bookingsSnap = await tx.get(bookingsRef)
        // Read rather than blind-update, exactly as the Connect webhook does with
        // the same document: a `tx.update` on an entry that was purged (the queue
        // of a deleted session is hard-deleted by teardownWaitlistOnSessionDeleted)
        // throws, and stored value that has already been reserved must never be
        // lost to a bookkeeping document.
        const entrySnap = claim ? await tx.get(claim.entryRef) : null
        const holding = countHoldingSeats(bookingsSnap.docs, Date.now(), contactId)
        if (seatsFree(freshSession.data()?.max_participants as number | undefined, holding) <= 0) {
          throw new HttpsError('resource-exhausted', 'This session is fully booked.', {
            reason: 'session_full',
          })
        }
        // A full set, no merge — which is also what retires the claim fields the
        // promoter wrote. Leaving `waitlist_claim` on a confirmed booking would
        // make it stop holding its seat at `claim_expires_at` (bookingHoldsSeat
        // → isExpiredWaitlistClaim), silently freeing a seat that is paid for.
        tx.set(bookingRef, {
          firstname,
          lastname,
          email,
          phone,
          contact: contactId,
          session: sessionId,
          teamId,
          joinedAt: FieldValue.serverTimestamp(),
          fromBioLink: true,
          is_new_contact: isNewContact,
          booking_token: bookingToken,
          booking_reference: bookingReference,
          source: 'online' as const,
          ...(claimAnswers ? { question_answers: claimAnswers } : {}),
          ...(claim ? { claimed_from_waitlist: true } : {}),
          authenticated_booking: !!contactSession,
          status: 'confirmed',
          payment_status: 'gift_card',
        })
        if (claim && entrySnap?.exists) {
          tx.update(claim.entryRef, {
            status: 'claimed',
            claimed_at: FieldValue.serverTimestamp(),
            offer_token: FieldValue.delete(),
          })
        }
        tx.set(
          sessionRef,
          {
            has_bookings: true,
            bookings_count: holding + 1,
            last_booking_at: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      })
    } catch (err) {
      await releaseReservedGiftCard()
      throw err
    }
    // A gift-card payment confirms a provisional contact, exactly as a paid
    // Stripe drop-in does (handleDropInCheckout clears it for ANY provisional
    // contact). This used to fire only for a contact created a moment ago, which
    // left a waitlist-born one — provisional WITH a reaper date — to be deleted
    // 30 days after a class they paid for and attended. Deleting an absent field
    // is a no-op, so the unconditional write costs one update.
    await db.collection('contacts').doc(contactId).update({
      provisional: FieldValue.delete(),
      provisional_expires_at: FieldValue.delete(),
    })
    if (isTrial) {
      await db
        .collection('contacts')
        .doc(contactId)
        .update({ trial_used_at: FieldValue.serverTimestamp() })
    }
    await db
      .collection('contacts')
      .doc(contactId)
      .collection('activity_log')
      .add({
        type: 'drop_in_booked',
        source: 'gift_card',
        message: `Drop-in booking · ${activityName}`,
        timestamp: FieldValue.serverTimestamp(),
      })
    // Commit + journal in one call. Nothing else records this sale: a
    // full-cover booking creates no Stripe session, so handleCheckoutCompleted
    // never runs and there is no member_payments doc either.
    await commitGiftCardDrawdown({
      teamId,
      code: data.giftCardCode!,
      holdKey: giftCardHoldKey!,
      targetCategory: 'drop_in',
      contactId,
      description: `Drop-in · ${activityName}`,
    })
    return {
      url: null,
      sessionId: null,
      paidWithGiftCard: true,
      amount: 0,
      drawdown: giftCardPlan.drawdown,
    }
  }

  // Write / overwrite the PENDING hold, gated on capacity in the same
  // transaction. The hold HOLDS A SEAT from this instant (bookingHoldsSeat
  // counts a live `required` hold), so it has to be taken under the same lock
  // every other seat is taken under — otherwise a full class keeps selling
  // checkouts and the payer discovers at the door that there was never a seat.
  // The seat counter moves here, not in the webhook, for the same reason.
  //
  // The CONTACT counter moves here too, and only here, because this is the write
  // that decides which kind of hold the document is. A plain drop-in hold is
  // uncounted for its whole life (nobody increments it, expirePendingBookings
  // deletes it without a decrement); a waitlist claim hold is counted from the
  // moment the promoter mints it. Turning one into the other — which is exactly
  // what an offer holder does by abandoning the claim link and buying through the
  // ordinary form — has to move the ledger with it, or the count is stranded on a
  // document that every later reader treats as uncounted. See holdWriteCountDelta
  // for the full shape table; the fixtures are pendingBookingsCount.test.ts.
  try {
    await db.runTransaction(async (tx) => {
      const freshSession = await tx.get(sessionRef)
      if (!freshSession.exists) throw new HttpsError('not-found', 'Session not found')
      const bookingsSnap = await tx.get(bookingsRef)
      const holding = countHoldingSeats(bookingsSnap.docs, Date.now(), contactId)
      if (seatsFree(freshSession.data()?.max_participants as number | undefined, holding) <= 0) {
        throw new HttpsError('resource-exhausted', 'This session is fully booked.', {
          reason: 'session_full',
        })
      }
      const countDelta = holdWriteCountDelta(
        bookingsSnap.docs.find((d) => d.id === contactId)?.data() as
          | ReplacedBookingShape
          | undefined,
        !!claim
      )
      // Read rather than blind-update, the same reason the promoter reads its
      // candidates: a contact document can be gone (a purged provisional
      // contact), and `tx.update` on a missing document throws — which would
      // fail a checkout over a counter.
      const contactSnap = countDelta === 0 ? null : await tx.get(contactDocRef)
      tx.set(bookingRef, {
        firstname,
        lastname,
        email,
        phone,
        contact: contactId,
        session: sessionId,
        teamId,
        joinedAt: FieldValue.serverTimestamp(),
        fromBioLink: true,
        is_new_contact: isNewContact,
        booking_token: bookingToken,
        booking_reference: bookingReference,
        // Drop-in checkout is only reachable from the public booking page.
        source: 'online' as const,
        ...(claimAnswers ? { question_answers: claimAnswers } : {}),
        authenticated_booking: !!contactSession,
        status: 'pending',
        payment_status: 'required',
        expires_at: expiresAt,
        // A CLAIM stays a claim while it is being paid for. This `.set()` has no
        // merge option, so the promoter's hold fields have to be rewritten here
        // or the seat quietly stops being the queue's: the entry would still say
        // 'offered' while the booking had become an ordinary drop-in hold, and
        // on abandonment expirePendingBookings would delete it and leave the
        // entry stuck at 'offered' forever — a permanently blocked queue.
        ...(claim ? { waitlist_claim: true, claim_expires_at: claim.expiresAt } : {}),
      })
      tx.set(
        sessionRef,
        {
          has_bookings: true,
          bookings_count: holding + 1,
          last_booking_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      if (countDelta !== 0 && contactSnap?.exists) {
        tx.update(contactDocRef, { pending_bookings_count: FieldValue.increment(countDelta) })
      }
    })
  } catch (err) {
    await releaseReservedGiftCard()
    throw err
  }

  // Create the Connect checkout; the webhook (kind: 'drop_in') confirms the booking.
  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=booking` : ''
  const { successUrl, cancelUrl } = buildResultUrls(locale, {
    extraQuery: slugQuery,
    origin: data.origin,
  })
  const metadata: Record<string, string> = {
    teamId,
    kind: 'drop_in',
    purpose: 'drop_in',
    sessionId,
    contactId,
    activityName,
    // Trial mode keeps kind: 'drop_in' (so the existing webhook path confirms
    // it) and just flags itself for the extra trial_used_at stamp — see
    // handleDropInCheckout.
    ...(isTrial ? { trial: 'true' } : {}),
    // Tells the webhook this payment settles a waitlist claim, so it flips the
    // entry in the same transaction that confirms the booking. The value is the
    // entry's own doc id (= contactId) rather than a flag, so the webhook never
    // has to infer which queue it is closing.
    ...(claim ? { waitlistEntry: claim.contactId } : {}),
    ...(giftCardPlan
      ? {
          giftCardCode: data.giftCardCode!.trim().toUpperCase(),
          giftCardHold: giftCardHoldKey!,
          giftCardDrawdown: String(giftCardPlan.drawdown),
        }
      : {}),
  }
  const idempotencyKey =
    data.idempotencyKey ?? defaultIdempotencyKey('dropin', teamId, sessionId, contactId)

  // A gift hold is live only when giftCardPlan is set — give Stripe a SHORT
  // expiry then so the hold releases promptly (drop-in otherwise has no
  // checkout expiry; Stripe's 24h default would sit on the card too long).
  const chargeAmount = giftCardPlan ? requireChargeableAmountFromMajor(giftCardPlan.residual) : amount

  let checkout
  try {
    checkout = await startOneOffCheckout({
      team,
      amountMinor: chargeAmount,
      productName: `${isTrial ? 'Trial' : 'Drop-in'} · ${activityName}`,
      successUrl,
      cancelUrl,
      customerEmail: email || undefined,
      metadata,
      idempotencyKey,
      // The Stripe session must NEVER outlive the booking hold it represents.
      //
      // The hold frees its seat at +HOLD_MINUTES (30) — `bookingHoldsSeat`
      // stops counting it and `bookSession` persists that correction — while a
      // Stripe session left to its own devices stays payable for 24 HOURS. That
      // gap is an oversell AND a wrong charge: the seat gets handed to someone
      // else at +31 min, then the original buyer pays hours later and
      // `handleDropInCheckout` confirms unconditionally (it must — a real charge
      // can never be dropped), so the class ends up over capacity and the payer
      // holds a seat that no longer exists.
      //
      // SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES (31) is one minute past the hold, so
      // the payment window closes just after the seat is released. This applies
      // to EVERY drop-in, not only gift-card ones — the gift-card branch was
      // already correct for its own reasons and the plain path was the 24-hour
      // hole.
      //
      // A CLAIM expires with its own window instead — the same instant as the
      // booking hold and the waitlist entry, which is the whole point of
      // collapsing the three timers into one (resolveClaimCheckoutWindow).
      expiresAtEpochSeconds:
        claimCheckout?.expiresAtEpochSeconds ??
        Math.floor(Date.now() / 1000) + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES * 60,
      label: 'createDropInCheckout',
    })
  } catch (err) {
    // Don't leave a reserved gift-card drawdown dangling until its lazy expiry.
    await releaseReservedGiftCard()
    throw err
  }
  return {
    url: checkout.url,
    sessionId: checkout.sessionId,
    amount: chargeAmount,
    ...(giftCardPlan ? { drawdown: giftCardPlan.drawdown, residual: giftCardPlan.residual } : {}),
  }
})
