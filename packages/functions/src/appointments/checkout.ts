/* eslint-disable no-console */
// createAppointmentCheckout — pay-per-appointment booking (Stripe Connect one-off
// charge), modelled on booking/dropIn.ts. A priced appointment DURATION whose
// effective price (for the caller) is an amount can't book free — the client
// calls this instead. THE HOLD IS THE SESSION: we write a 'pending_payment'
// session + a 'pending'/'required' booking BEFORE creating the Checkout Session,
// because an appointment session doesn't exist until booked — payment precedes
// existence. The Connect webhook (kind: 'appointment') confirms on success.
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveEffectiveAppointmentPrice } from '@linyup/shared'
import { loadEnabledTeam, requireChargeableAccount } from '../connect/access'
import {
  buildResultUrls,
  checkoutRateLimit,
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  startOneOffCheckout,
} from '../connect/checkout'
import { resolveHeldBenefit } from '../booking/access'
import { generateSecureToken } from '../utils/crypto'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'
import {
  loadAppointmentBookingContext,
  resolveAppointmentCaller,
  resolveOrCreateAppointmentContact,
  runAppointmentSlotTransaction,
} from './booking'

const HOLD_MINUTES = 30
// Stripe's Checkout Session `expires_at` minimum is 30 minutes from creation;
// 31 (not 30) avoids a rejection on clock skew between our hold timestamp and
// the moment Stripe evaluates it.
const CHECKOUT_EXPIRY_MINUTES = 31

export const createAppointmentCheckout = onCall(
  { enforceAppCheck: APP_CHECK_ENFORCE },
  async (request) => {
    monitorAppCheck(request, 'createAppointmentCheckout')
    const data = request.data as {
      teamId?: string
      providerId?: string
      activityId?: string
      startMs?: number
      durationMinutes?: number
      contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
      authenticatedContactId?: string
      verificationCodeId?: string
      slug?: string
      locale?: string
      origin?: string
      idempotencyKey?: string
    }
    if (
      !data?.teamId ||
      !data?.providerId ||
      !data?.activityId ||
      typeof data.startMs !== 'number' ||
      typeof data.durationMinutes !== 'number'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'teamId, providerId, activityId, startMs and durationMinutes are required'
      )
    }
    const { teamId, providerId, activityId, startMs, durationMinutes } = data
    const locale = data.locale ?? 'en'
    const db = admin.firestore()

    // Public endpoint — same per-IP hourly limit as the other Connect checkouts.
    await checkoutRateLimit(request.rawRequest?.ip)

    // Team must have Connect enabled + a chargeable account.
    const team = await loadEnabledTeam(teamId)
    requireChargeableAccount(team) // fail before the reads; the orchestrator re-checks

    // ── The *what* + the *when* ──
    const ctx = await loadAppointmentBookingContext({ teamId, providerId, activityId, startMs, durationMinutes })
    if (typeof ctx.chosenDuration.priceAmount !== 'number') {
      throw new HttpsError('failed-precondition', 'This duration is not for sale', { reason: 'not_priced' })
    }

    // ── Caller + effective price — THE PRICE IS THE GATE, there's no access
    // check any more: a guest always pays base; a benefit holder pays their
    // resolved (possibly discounted) price. Free path callers never reach
    // here — the client only calls checkout after bookAppointment's refusal. ──
    const caller = await resolveAppointmentCaller(request, { ...data, teamId })
    const heldBenefit = caller.authenticatedContact
      ? await resolveHeldBenefit({
          teamId,
          contact: caller.authenticatedContact,
          subscriptionTypeIds: ctx.activity.memberBenefit?.subscriptionTypeIds ?? [],
        })
      : { heldTypeIds: [], creditSpendTypeId: null }
    const effective = resolveEffectiveAppointmentPrice(
      ctx.chosenDuration,
      heldBenefit.heldTypeIds,
      ctx.activity.memberBenefit
    )
    if (effective.free) {
      throw new HttpsError(
        'failed-precondition',
        'You can book this for free — no payment needed',
        { reason: 'covered' }
      )
    }

    // ── Resolve/create the contact — guests always allowed; there is no access gate. ──
    const { contactId, isNewContact } = await resolveOrCreateAppointmentContact({
      teamId,
      plan: ctx.plan,
      sanitized: caller.sanitized,
      authenticatedContact: caller.authenticatedContact,
    })

    // The discount clamp in resolveEffectiveAppointmentPrice guarantees derived
    // prices are already ≥ the floor; this guards the AUTHORED base price.
    const amount = requireChargeableAmountFromMajor(effective.amount as number)

    // ── HOLD tx — the hold IS the session. A retry from the SAME contact rewrites
    // its own still-live hold (fresh Checkout Session, same slot). ──
    const bookingToken = generateSecureToken()
    const holdExpiresAt = Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60_000)
    const sessionRef = db.collection('sessions').doc(`apt_${providerId}_${ctx.start.getTime()}`)

    const sessionDoc = {
      teamId,
      templateId: ctx.tpl.id,
      origin: 'window',
      activityType: 'appointment',
      activityId,
      activityName: ctx.activity.name,
      // NOTE: no accessRule any more — appointments dropped the gate entirely.
      autoConfirm: ctx.autoConfirm,
      providerId,
      providerName: ctx.providerName,
      start: Timestamp.fromDate(ctx.start),
      end: Timestamp.fromDate(ctx.end),
      duration_minutes: durationMinutes,
      max_participants: 1,
      bookings_count: 1,
      location: ctx.tpl.location ?? null,
      onlineUrl: ctx.tpl.onlineUrl ?? null,
      allowBooking: true,
      // THE HOLD IS THE SESSION — never published (see syncSessionPublicProfile),
      // never counted by trackBookings (see analytics/index.ts), and skipped by
      // listAvailability's busy filter once hold_expires_at lapses (lazy release).
      status: 'pending_payment',
      hold_expires_at: holdExpiresAt,
      has_bookings: true,
      last_booking_at: FieldValue.serverTimestamp(),
      created_at: FieldValue.serverTimestamp(),
    }
    const bookingDoc = {
      firstname: caller.sanitized.firstname,
      lastname: caller.sanitized.lastname,
      email: caller.sanitized.email,
      phone: caller.sanitized.phone,
      contact: contactId,
      session: sessionRef.id,
      teamId,
      joinedAt: FieldValue.serverTimestamp(),
      fromBioLink: true,
      is_new_contact: isNewContact,
      booking_token: bookingToken,
      authenticated_booking: !!caller.authenticatedContact,
      // The resolved member-benefit type (discount), if any — not an access
      // gate match any more, just which benefit (if any) priced this booking.
      subscription_type_id: effective.viaSubscriptionTypeId ?? null,
      // NO fullname — that's only stamped once the webhook confirms payment.
      status: 'pending',
      payment_status: 'required',
      expires_at: holdExpiresAt,
    }

    await runAppointmentSlotTransaction({
      sessionRef,
      sessionDoc,
      bookingDocId: contactId,
      bookingDoc,
      teamId,
      providerId,
      startMs: ctx.start.getTime(),
      endMs: ctx.end.getTime(),
      bufferMs: ctx.bufferMs,
      allowRewriteByHolder: contactId,
    })

    // ── Create the Connect checkout; the webhook (kind: 'appointment') confirms. ──
    const slugQuery = data.slug ? `&slug=${encodeURIComponent(data.slug)}&seg=appointments` : ''
    const { successUrl, cancelUrl } = buildResultUrls(locale, {
      extraQuery: slugQuery,
      origin: data.origin,
    })
    const metadata: Record<string, string> = {
      kind: 'appointment',
      purpose: 'appointment',
      teamId,
      sessionId: sessionRef.id,
      contactId,
      activityId,
      activityName: ctx.activity.name,
      providerId,
      startMs: String(startMs),
      durationMinutes: String(durationMinutes),
    }
    const idempotencyKey =
      data.idempotencyKey ?? defaultIdempotencyKey('apt', teamId, sessionRef.id, contactId)

    try {
      const checkoutSession = await startOneOffCheckout({
        team,
        amountMinor: amount,
        productName: `${ctx.activity.name} · ${durationMinutes} min`,
        successUrl,
        cancelUrl,
        customerEmail: caller.sanitized.email || undefined,
        metadata,
        idempotencyKey,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_MINUTES * 60,
        label: 'createAppointmentCheckout',
      })
      return { url: checkoutSession.url, amount }
    } catch (err) {
      // Stripe create failed AFTER the hold — best-effort release so the slot
      // doesn't sit blocked until the daily sweep; a leak self-heals via lazy
      // expiry (appointmentSlotBlocked) regardless.
      console.error('[appointments] createAppointmentCheckout: Stripe create failed, releasing hold:', err)
      try {
        await sessionRef.set({ status: 'cancelled' }, { merge: true })
        await sessionRef.collection('bookings').doc(contactId).delete()
      } catch (releaseErr) {
        console.error('[appointments] createAppointmentCheckout: hold release failed:', releaseErr)
      }
      throw new HttpsError('internal', 'Failed to start checkout')
    }
  }
)
