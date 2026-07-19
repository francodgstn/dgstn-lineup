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
  resolveActivityAccessRule,
  resolvePaymentOptions,
  type ActivityAccessRule,
} from '@linyup/shared'
import { loadContactPaymentSnapshot } from './access'
import { loadEnabledTeam, requireChargeableAccount } from '../connect/access'
import {
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  startOneOffCheckout,
} from '../connect/checkout'
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
 * Whether a contact can already book this class for free (so drop-in is
 * refused) — the SAME semantics bookSession uses, via the shared resolver:
 *  • a usable lesson-credit balance counts as covered (a member with credits
 *    left must not be sold a redundant drop-in);
 *  • an EXHAUSTED/expired pack does NOT count — that contact gets to pay,
 *    fixing the old deadlock where bookSession denied no_credits while the
 *    previous field-only check here also refused the drop-in.
 */
async function isContactCovered(
  teamId: string,
  rule: ActivityAccessRule,
  contact: FirebaseFirestore.DocumentData & { id: string }
): Promise<boolean> {
  const snapshot = await loadContactPaymentSnapshot({
    teamId,
    contact,
    relevantTypeIds: rule.subscriptionTypeIds ?? [],
  })
  const { options } = resolvePaymentOptions(snapshot, { kind: 'class_booking', accessRule: rule })
  return options.length > 0
}

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
  requireChargeableAccount(team) // fail before the reads; the orchestrator re-checks

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

  const priceAmountMajor = isTrial ? (trialPriceAmount as number) : (dropIn!.priceAmount as number)
  const amount = requireChargeableAmountFromMajor(priceAmountMajor)

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
    if (await isContactCovered(teamId, accessRule, { ...c, id: cSnap.id })) {
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
      if (await isContactCovered(teamId, accessRule, { ...match.data(), id: match.id })) {
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
    }
  }

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

  // Write / overwrite the PENDING hold. Counts toward NO confirmed totals until paid;
  // the webhook increments on confirmation, the daily task releases unpaid holds.
  const bookingToken = generateSecureToken()
  const expiresAt = Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60_000)
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
  }
  const idempotencyKey =
    data.idempotencyKey ?? defaultIdempotencyKey('dropin', teamId, sessionId, contactId)

  const checkout = await startOneOffCheckout({
    team,
    amountMinor: amount,
    productName: `${isTrial ? 'Trial' : 'Drop-in'} · ${activityName}`,
    successUrl,
    cancelUrl,
    customerEmail: email || undefined,
    metadata,
    idempotencyKey,
    label: 'createDropInCheckout',
  })
  return { url: checkout.url, sessionId: checkout.sessionId, amount }
})
