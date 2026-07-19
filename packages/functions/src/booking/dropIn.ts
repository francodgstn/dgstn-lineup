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
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES,
  startOneOffCheckout,
} from '../connect/checkout'
import {
  commitGiftCardHold,
  releaseGiftCardHold,
  reserveGiftCardDrawdown,
} from '../connect/giftCards'
import { generateSecureToken } from '../utils/crypto'
import { optionalContactSessionFromRequest } from '../utils/contactSession'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'
import { resolveSingleContact } from '../utils/contacts'
// Pure trial-gate helpers, shared with bookSession's free trial door — see
// booking/index.ts's module doc comment. Mirrors the appointments/index.ts
// same-directory-index import pattern already used elsewhere in this package.
import { resolveTrialEligibility } from './index'

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
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!data?.sessionId) throw new HttpsError('invalid-argument', 'sessionId is required')
  const { teamId, sessionId } = data
  const locale = data.locale ?? 'en'
  const db = admin.firestore()

  // Public endpoint — same per-IP hourly limit as the other Connect checkouts.
  await checkoutRateLimit(request.rawRequest?.ip)

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
  if (sessionData.activityType === 'appointment') {
    throw new HttpsError('failed-precondition', 'Drop-in is not available for appointment sessions')
  }

  // Resolve the activity → drop-in config + access rule.
  const activityId = sessionData.activityId as string | undefined
  if (!activityId) throw new HttpsError('failed-precondition', 'Session has no activity')
  const actSnap = await db.collection('activities').doc(activityId).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'Activity not found')
  const activity = actSnap.data()!
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
  if (contactSession && contactSession.teamId === teamId) {
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
  const bookingRef = db.collection('sessions').doc(sessionId).collection('bookings').doc(contactId)
  const [bookingSnap, participantSnap] = await Promise.all([
    bookingRef.get(),
    db.collection('sessions').doc(sessionId).collection('participants').doc(contactId).get(),
  ])
  if (participantSnap.exists || (bookingSnap.exists && bookingSnap.data()?.status === 'confirmed')) {
    throw new HttpsError('already-exists', 'You are already registered for this session')
  }

  const bookingToken = generateSecureToken()
  const expiresAt = Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60_000)

  // Optional gift-card redemption — reserve a drawdown against the total BEFORE
  // writing any booking doc (a failed/invalid code must leave no trace).
  let giftCardPlan: GiftCardRedemptionPlan | null = null
  let giftCardHoldKey: string | null = null
  if (data.giftCardCode) {
    giftCardHoldKey = generateSecureToken(16)
    giftCardPlan = await reserveGiftCardDrawdown({
      teamId,
      code: data.giftCardCode,
      totalMajor: priceMajor,
      holdKey: giftCardHoldKey,
    })
  }

  if (giftCardPlan && giftCardPlan.residual === 0) {
    // FULL COVER — no Stripe at all: confirm the booking directly, mirroring
    // handleDropInCheckout's confirm effects (minus payment_intent_id, which
    // doesn't exist on this path).
    await bookingRef.set({
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
      authenticated_booking: !!contactSession,
      status: 'confirmed',
      payment_status: 'gift_card',
    })
    await db
      .collection('sessions')
      .doc(sessionId)
      .set(
        {
          has_bookings: true,
          bookings_count: FieldValue.increment(1),
          last_booking_at: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    // A gift-card payment also confirms a provisional (freshly created) contact
    // — same as a paid Stripe drop-in.
    if (isNewContact) {
      await db.collection('contacts').doc(contactId).update({
        provisional: FieldValue.delete(),
        provisional_expires_at: FieldValue.delete(),
      })
    }
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
    await commitGiftCardHold({ teamId, code: data.giftCardCode!, holdKey: giftCardHoldKey! })
    return {
      url: null,
      sessionId: null,
      paidWithGiftCard: true,
      amount: 0,
      drawdown: giftCardPlan.drawdown,
    }
  }

  // Write / overwrite the PENDING hold. Counts toward NO confirmed totals until paid;
  // the webhook increments on confirmation, the daily task releases unpaid holds.
  await bookingRef.set({
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
    authenticated_booking: !!contactSession,
    status: 'pending',
    payment_status: 'required',
    expires_at: expiresAt,
  })

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
      ...(giftCardPlan
        ? {
            expiresAtEpochSeconds:
              Math.floor(Date.now() / 1000) + SHORT_HOLD_CHECKOUT_EXPIRY_MINUTES * 60,
          }
        : {}),
      label: 'createDropInCheckout',
    })
  } catch (err) {
    // Don't leave a reserved gift-card drawdown dangling until its lazy expiry.
    if (giftCardPlan && data.giftCardCode && giftCardHoldKey) {
      await releaseGiftCardHold({ teamId, code: data.giftCardCode, holdKey: giftCardHoldKey }).catch(
        () => undefined
      )
    }
    throw err
  }
  return {
    url: checkout.url,
    sessionId: checkout.sessionId,
    amount: chargeAmount,
    ...(giftCardPlan ? { drawdown: giftCardPlan.drawdown, residual: giftCardPlan.residual } : {}),
  }
})
