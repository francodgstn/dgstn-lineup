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
  computePlatformFee,
  resolveActivityAccessRule,
  type ActivityAccessRule,
} from '@linyup/shared'
import { loadEnabledTeam, requireChargeableAccount } from '../connect/access'
import { checkoutRateLimit } from '../connect/payments'
import { createOneOffCheckoutSession } from '../utils/connect/client'
import { resolveBaseUrl } from '../utils/env'
import { generateSecureToken } from '../utils/crypto'

const MIN_AMOUNT_RAPPEN = 50
const HOLD_MINUTES = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface CoverageContact {
  acquisition_stage?: string
  subscription_type_id?: string
  active_subscriptions?: Array<{ subscription_type_id?: string }>
}

/** Whether a contact can already book this class for free (so drop-in is refused). */
function isContactCovered(rule: ActivityAccessRule, contact: CoverageContact): boolean {
  if (rule.type === 'open') return true
  const joined = contact.acquisition_stage === 'joined'
  if (rule.type === 'members') return joined
  if (!joined) return false // subscription tier
  const held = new Set<string>()
  ;(contact.active_subscriptions ?? []).forEach((s) => {
    if (s.subscription_type_id) held.add(s.subscription_type_id)
  })
  if (contact.subscription_type_id) held.add(contact.subscription_type_id)
  return (rule.subscriptionTypeIds ?? []).some((id) => held.has(id))
}

export const createDropInCheckout = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    sessionId?: string
    authenticatedContactId?: string
    contactDetails?: { firstname?: string; lastname?: string; email?: string; phone?: string }
    slug?: string
    locale?: string
    origin?: string
    idempotencyKey?: string
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
  const { accountId, model } = requireChargeableAccount(team)

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
  if (sessionData.activityType === 'coaching') {
    throw new HttpsError('failed-precondition', 'Drop-in is not available for coaching sessions')
  }

  // Resolve the activity → drop-in config + access rule.
  const activityId = sessionData.activityId as string | undefined
  if (!activityId) throw new HttpsError('failed-precondition', 'Session has no activity')
  const actSnap = await db.collection('activities').doc(activityId).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'Activity not found')
  const activity = actSnap.data()!
  const activityName =
    (activity.name as string) || (sessionData.activityName as string) || 'Class'
  const dropIn = activity.dropIn as { enabled?: boolean; priceAmount?: number } | undefined
  if (!dropIn?.enabled || typeof dropIn.priceAmount !== 'number') {
    throw new HttpsError('failed-precondition', 'Drop-in is not available for this class')
  }
  const accessRule = resolveActivityAccessRule({
    accessRule: activity.accessRule as ActivityAccessRule | undefined,
    isFreeTrial: activity.isFreeTrial as boolean | undefined,
  })
  if (accessRule.type === 'open') {
    throw new HttpsError('failed-precondition', 'This class is free to book — no payment needed')
  }

  const amount = Math.round(dropIn.priceAmount * 100)
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_RAPPEN) {
    throw new HttpsError('failed-precondition', `Drop-in price must be at least ${MIN_AMOUNT_RAPPEN} Rappen`)
  }

  // Resolve the contact (payment is proof — no email verification needed here).
  let contactId: string
  let email: string
  let firstname: string
  let lastname: string
  let phone: string | null = null
  let isNewContact = false

  if (data.authenticatedContactId) {
    const cSnap = await db.collection('contacts').doc(data.authenticatedContactId).get()
    if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
      throw new HttpsError('not-found', 'Contact not found')
    }
    const c = cSnap.data()!
    contactId = cSnap.id
    email = (c.email as string) || ''
    firstname = (c.firstname as string) || ''
    lastname = (c.lastname as string) || ''
    phone = (c.phone as string) || null
    if (isContactCovered(accessRule, c as CoverageContact)) {
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
      if (isContactCovered(accessRule, match.data() as CoverageContact)) {
        throw new HttpsError('failed-precondition', 'You can already book this class for free')
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
        teamId,
        archived_at: null,
        deleted_at: null,
        created_at: FieldValue.serverTimestamp(),
      })
      contactId = ref.id
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
    authenticated_booking: !!data.authenticatedContactId,
    status: 'pending',
    payment_status: 'required',
    expires_at: expiresAt,
  })

  // Create the Connect checkout; the webhook (kind: 'drop_in') confirms the booking.
  const applicationFeeAmount = computePlatformFee({ tier: team.plan, amount, model })
  const base = `${resolveBaseUrl(data.origin)}/${locale}/pay/result`
  const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=booking` : ''
  const metadata: Record<string, string> = {
    teamId,
    kind: 'drop_in',
    purpose: 'drop_in',
    sessionId,
    contactId,
    activityName,
  }
  const idempotencyKey =
    data.idempotencyKey ?? `dropin:${teamId}:${sessionId}:${contactId}:${Math.floor(Date.now() / 60000)}`

  try {
    const session = await createOneOffCheckoutSession({
      accountId,
      amount,
      applicationFeeAmount,
      productName: `Drop-in · ${activityName}`,
      successUrl: `${base}?status=success${slugQuery}`,
      cancelUrl: `${base}?status=cancelled${slugQuery}`,
      customerEmail: email || undefined,
      metadata,
      idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, amount }
  } catch (err) {
    console.error('[dropIn] createDropInCheckout failed:', err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
})
