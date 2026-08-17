/* eslint-disable no-console */
// The "phone booking" case — a studio manager creates an appointment ON BEHALF
// OF a client (or blocks a provider's calendar) directly from the admin. This is
// NOT the public booking flow: there is no availability lookup, no price gate,
// no guest/OTP trust ladder — the manager decides the client, the price, and
// how it gets paid. Reuses the SAME overlap-safe slot machinery as the public
// paths (runAppointmentSlotTransaction from ./booking) so a staff-created
// appointment and a client-created one can never double-book the same provider
// window, and reuses the manual-payment ledger (writeManualPaymentEvent) and
// the Connect checkout helpers (createOneOffCheckoutSession) so every rail a
// staff booking can settle through is the SAME rail an equivalent public flow
// already uses — see docs/appointments.md "Paid appointments".
//
//   • createStaffAppointment — book an existing/new contact, or block time.
//     Four ways to settle a priced booking: free (unpriced/explicit 0), paid on
//     the spot (offline, recorded immediately), pending offline (confirmed, pay
//     later in person), or a Stripe Connect payment LINK emailed to the client
//     (mirrors the public checkout hold — confirmed by the SAME webhook).
//   • markAppointmentPaid — settle a 'pending_offline' hold once the client
//     actually pays (cash/bank transfer/TWINT taken in person).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  ACTIVITIES_COLLECTION,
  CONTACTS_COLLECTION,
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  computePlatformFee,
  resolveAppointmentDurations,
  resolveAutoConfirm,
  type Activity,
  type SaasPlan,
  publicUrl,
} from '@linyup/shared'
import { assertManager, loadEnabledTeam, requireChargeableAccount } from '../connect/access'
import { createOneOffCheckoutSession } from '../utils/connect/client'
import { resolveBaseUrl, getHostingUrl } from '../utils/env'
import { generateSecureToken } from '../utils/crypto'
import { getTeam } from '../utils/teams'
import { resolveSingleContact } from '../utils/contacts'
import { canCreateContact } from '../utils/contactCap'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { writeManualPaymentEvent } from '../payments/recordManualPayment'
import { asLang, runAppointmentSlotTransaction } from './booking'
import { releaseAppointmentHold } from './holdRelease'
import { sendAppointmentBookingEmails } from './emails'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOTE_LEN = 500
// Stripe's minimum charge — only enforced on the 'payment_link' rail (the
// offline modes don't touch Stripe at all).
const MIN_LINK_AMOUNT_MINOR = 50
// The Stripe Checkout Session itself stays open for a week (a manager sending a
// link by phone/SMS can't count on the client paying within the public flow's
// 30-minute hold window). checkout.session.expired (already handled by the
// Connect webhook — see webhook.ts's handleCheckoutExpired) releases
// the hold when it lapses; the session doc deliberately carries NO
// hold_expires_at so the daily sweep (dailyTasks/expirePendingBookings.ts)
// leaves it alone in the meantime — same rationale as the pending_offline mode.
const PAYMENT_LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60

type StaffBookingPaymentMode = 'paid_offline' | 'pending_offline' | 'payment_link'

interface CreateStaffAppointmentInput {
  teamId?: string
  providerId?: string
  activityId?: string
  startMs?: number
  durationMinutes?: number
  contactId?: string
  newContact?: { firstname: string; lastname: string; email: string; phone?: string }
  blocked?: boolean
  paymentMode?: StaffBookingPaymentMode
  /** Minor units (Rappen/cents). Overrides the activity duration's base price. */
  amount?: number
  currency?: string
  /** Studio-configured manual-payment mode label, e.g. "Cash" (paid_offline only). */
  method?: string
  note?: string
  locale?: string
  origin?: string
}

// ─── resolveStaffBookingPlan — pure, unit-testable ─────────────────────────────

export interface StaffBookingPlan {
  sessionStatus: 'full' | 'pending_payment'
  paymentPending: boolean
  paymentIntentMode?: 'offline' | 'link'
  bookingStatus: 'confirmed' | 'pending'
  bookingPaymentStatus?: 'required'
  /** paid_offline only — record the manual payment immediately after the tx. */
  recordPaymentNow: boolean
}

/** Decide how a (blocked?, amountMinor, paymentMode) triple resolves into the
 *  session/booking status shape — see the module doc comment for the four
 *  settlement rails. Pure so it's cheaply unit-testable without Firestore. */
export function resolveStaffBookingPlan(params: {
  blocked: boolean
  amountMinor: number
  paymentMode?: StaffBookingPaymentMode
}): StaffBookingPlan {
  const { blocked, amountMinor } = params
  if (blocked || amountMinor === 0) {
    return { sessionStatus: 'full', paymentPending: false, bookingStatus: 'confirmed', recordPaymentNow: false }
  }
  switch (params.paymentMode) {
    case 'paid_offline':
      return { sessionStatus: 'full', paymentPending: false, bookingStatus: 'confirmed', recordPaymentNow: true }
    case 'pending_offline':
      return {
        sessionStatus: 'pending_payment',
        paymentPending: true,
        paymentIntentMode: 'offline',
        bookingStatus: 'confirmed',
        recordPaymentNow: false,
      }
    case 'payment_link':
      return {
        sessionStatus: 'pending_payment',
        paymentPending: true,
        paymentIntentMode: 'link',
        bookingStatus: 'pending',
        bookingPaymentStatus: 'required',
        recordPaymentNow: false,
      }
    default:
      throw new HttpsError(
        'invalid-argument',
        "paymentMode must be 'paid_offline', 'pending_offline' or 'payment_link' for a priced booking",
      )
  }
}

// ─── providerName resolution ────────────────────────────────────────────────────

/** users/{providerId} (firstname+lastname, else displayName/email) → the
 *  team_members doc's own name field (legacy denormalization, if ever present)
 *  → the bare uid. Mirrors the client-side fallback in AppointmentAvailability.tsx
 *  (`member?.name || data.providerId`) since staff bookings have no availability
 *  template to read a denormalised providerName off. */
async function resolveProviderName(teamId: string, providerId: string): Promise<string> {
  const db = admin.firestore()
  const userSnap = await db.collection('users').doc(providerId).get()
  if (userSnap.exists) {
    const u = userSnap.data()!
    const full = `${(u.firstname as string | undefined) || ''} ${(u.lastname as string | undefined) || ''}`.trim()
    if (full) return full
    if (u.displayName) return u.displayName as string
    if (u.email) return u.email as string
  }
  const memberSnap = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(TEAM_MEMBERS_SUBCOLLECTION)
    .doc(providerId)
    .get()
  if (memberSnap.exists) {
    const m = memberSnap.data() as Record<string, unknown>
    const name = (m.name as string | undefined) || (m.displayName as string | undefined)
    if (name) return name
  }
  return providerId
}

// ─── minimal payment-link email (English-only for now) ─────────────────────────
// TODO: i18n — every other appointment email (templates.ts) is 4-language;
// this one is new and English-only until the staff-booking UI has a locale to
// hand it (see CreateStaffAppointmentInput.locale, unused here on purpose).

function buildPaymentLinkEmail(params: {
  firstname: string
  teamName: string
  activityName: string
  start: Date
  paymentUrl: string
}) {
  const dateStr = params.start.toLocaleString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  })
  const body = [
    `<p>Hi ${params.firstname},</p>`,
    `<p>${params.teamName} has booked you in for <strong>${params.activityName}</strong> on ${dateStr}. Please complete your payment to confirm the booking:</p>`,
    `<p style="margin:16px 0;text-align:center;">${ctaButton(params.paymentUrl, 'Pay now')}</p>`,
    `<p>This link expires in 7 days.</p>`,
  ].join('\n')
  return buildEmailTemplate({ title: `Complete your payment — ${params.activityName}`, body })
}

// ─── createStaffAppointment ─────────────────────────────────────────────────────

export const createStaffAppointment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const uid = request.auth.uid

  const data = request.data as CreateStaffAppointmentInput
  if (
    !data?.teamId ||
    !data?.providerId ||
    !data?.activityId ||
    typeof data.startMs !== 'number' ||
    typeof data.durationMinutes !== 'number'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'teamId, providerId, activityId, startMs and durationMinutes are required',
    )
  }
  const { teamId, providerId, activityId, startMs, durationMinutes } = data
  const blocked = data.blocked === true

  await assertManager(uid, teamId)

  const db = admin.firestore()
  const start = new Date(startMs)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, MAX_NOTE_LEN) : ''

  // ── Load + validate the activity (the *what*) — same rule as the public
  // paths: only a type:'appointment' activity, and only one of its configured
  // durations. No availability lookup — a staff booking works OUTSIDE
  // availability by design (this IS the manual-override tool). ──
  const actSnap = await db.collection(ACTIVITIES_COLLECTION).doc(activityId).get()
  if (!actSnap.exists) throw new HttpsError('not-found', 'Activity not found')
  const activity = actSnap.data() as Activity
  if (activity.teamId !== teamId) throw new HttpsError('permission-denied', 'Team mismatch')
  if (activity.type !== 'appointment') {
    throw new HttpsError('failed-precondition', 'This activity does not support appointment booking')
  }
  const allowedDurations = resolveAppointmentDurations(activity)
  const chosenDuration = allowedDurations.find((d) => d.minutes === durationMinutes)
  if (!chosenDuration) throw new HttpsError('failed-precondition', 'Duration is not offered')
  const basePriceMajor = chosenDuration.priceAmount ?? null
  const autoConfirm = resolveAutoConfirm({ autoConfirm: activity.autoConfirm, type: activity.type })

  // ── Team ──
  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')
  const teamName = team.name || 'Our Team'
  const teamSlug = team.slug || null
  const plan = (team.plan || 'free') as SaasPlan
  // The standard confirmation/.ics/coach-notify template is already 4-language
  // (see templates.ts) — use the team's own language, same as the public flow.
  // Only the NEW payment-link email below is intentionally English-only for now.
  const lang = asLang(team.language)

  const providerName = await resolveProviderName(teamId, providerId)

  // ── Resolve the client — blocked time has none. ──
  let contactId: string | null = null
  let isNewContact = false
  let client: { firstname: string; lastname: string; email: string; phone: string | null } | null = null

  if (!blocked) {
    if (data.contactId) {
      const cSnap = await db.collection(CONTACTS_COLLECTION).doc(data.contactId).get()
      if (!cSnap.exists || cSnap.data()?.teamId !== teamId) {
        throw new HttpsError('invalid-argument', 'Contact does not belong to this team')
      }
      if (cSnap.data()?.deleted_at != null) throw new HttpsError('invalid-argument', 'Contact is deleted')
      const c = cSnap.data()!
      contactId = cSnap.id
      client = {
        firstname: (c.firstname as string) || '',
        lastname: (c.lastname as string) || '',
        email: ((c.email as string) || '').toLowerCase().trim(),
        phone: (c.phone as string) || null,
      }
    } else if (data.newContact) {
      const nc = data.newContact
      if (!nc.firstname?.trim() || !nc.lastname?.trim() || !nc.email?.trim()) {
        throw new HttpsError('invalid-argument', 'firstname, lastname and email are required for a new contact')
      }
      if (!EMAIL_RE.test(nc.email.trim())) throw new HttpsError('invalid-argument', 'Invalid email format')
      const sanitized = {
        firstname: nc.firstname.trim(),
        lastname: nc.lastname.trim(),
        email: nc.email.toLowerCase().trim(),
        phone: nc.phone?.trim() || null,
      }
      // Avoid a duplicate — reuse an existing active match by email, same as
      // the public flow's resolveOrCreateAppointmentContact.
      const match = await resolveSingleContact(teamId, sanitized.email)
      if (match.contactId) {
        contactId = match.contactId
        const existing = await db.collection(CONTACTS_COLLECTION).doc(contactId).get()
        const c = existing.data() || {}
        client = {
          firstname: (c.firstname as string) || sanitized.firstname,
          lastname: (c.lastname as string) || sanitized.lastname,
          email: ((c.email as string) || sanitized.email).toLowerCase().trim(),
          phone: (c.phone as string) || sanitized.phone,
        }
      } else {
        if (!(await canCreateContact(teamId, plan))) {
          throw new HttpsError('resource-exhausted', 'Contact limit reached — please upgrade your plan.')
        }
        const ref = db.collection(CONTACTS_COLLECTION).doc()
        await ref.set({
          firstname: sanitized.firstname,
          lastname: sanitized.lastname,
          email: sanitized.email,
          phone: sanitized.phone,
          teamId,
          entry: 'manual',
          created_at: FieldValue.serverTimestamp(),
          archived_at: null,
          deleted_at: null,
        })
        contactId = ref.id
        isNewContact = true
        client = sanitized
      }
    } else {
      throw new HttpsError('invalid-argument', 'contactId or newContact is required unless blocked is true')
    }
  }

  // ── Amount / currency / settlement plan ──
  let amountMinor: number
  if (typeof data.amount === 'number') {
    if (!Number.isInteger(data.amount) || data.amount < 0) {
      throw new HttpsError('invalid-argument', 'amount must be a non-negative integer in minor units')
    }
    amountMinor = data.amount
  } else {
    amountMinor = basePriceMajor != null ? Math.round(basePriceMajor * 100) : 0
  }
  const currency = (data.currency ?? team.default_currency ?? 'CHF').toUpperCase().slice(0, 3)

  const plan_ = resolveStaffBookingPlan({ blocked, amountMinor, paymentMode: data.paymentMode })
  if (plan_.paymentIntentMode === 'link' && amountMinor < MIN_LINK_AMOUNT_MINOR) {
    throw new HttpsError('failed-precondition', `A payment link needs at least ${MIN_LINK_AMOUNT_MINOR} Rappen`)
  }

  // ── Build + run the overlap-safe slot transaction ──
  const bookingToken = blocked ? null : generateSecureToken()
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(`apt_${providerId}_${start.getTime()}`)
  const clientName = client ? `${client.firstname} ${client.lastname}`.trim() : null

  const sessionDoc: Record<string, unknown> = {
    teamId,
    templateId: null,
    origin: 'staff',
    activityType: 'appointment',
    activityId,
    activityName: blocked ? note || activity.name : activity.name,
    autoConfirm,
    providerId,
    providerName,
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    duration_minutes: durationMinutes,
    max_participants: 1,
    bookings_count: 1,
    location: null,
    onlineUrl: null,
    allowBooking: true,
    status: plan_.sessionStatus,
    has_bookings: true,
    last_booking_at: FieldValue.serverTimestamp(),
    created_at: FieldValue.serverTimestamp(),
    createdBy: uid,
    notes: blocked ? null : note || null,
    // Denormalised so list views (e.g. the Payments page) can render a
    // client name/amount without an N+1 read into the bookings subcollection.
    contact_id: blocked ? null : contactId,
    client_name: blocked ? note || null : clientName,
    ...(blocked ? { blocked_time: true } : {}),
    ...(plan_.paymentPending
      ? {
          payment_pending: true,
          payment_intent_mode: plan_.paymentIntentMode,
          payment_amount: amountMinor,
          payment_currency: currency,
        }
      : {}),
  }

  const bookingDoc: Record<string, unknown> = blocked
    ? {
        blocked_time: true,
        teamId,
        session: sessionRef.id,
        joinedAt: FieldValue.serverTimestamp(),
        status: 'confirmed',
      }
    : {
        firstname: client!.firstname,
        lastname: client!.lastname,
        email: client!.email,
        phone: client!.phone,
        contact: contactId,
        session: sessionRef.id,
        teamId,
        joinedAt: FieldValue.serverTimestamp(),
        fromBioLink: false,
        is_new_contact: isNewContact,
        booking_token: bookingToken,
        authenticated_booking: false,
        subscription_type_id: null,
        status: plan_.bookingStatus,
        fullname: clientName,
        created_by_staff: uid,
        ...(plan_.bookingPaymentStatus ? { payment_status: plan_.bookingPaymentStatus } : {}),
      }

  await runAppointmentSlotTransaction({
    sessionRef,
    sessionDoc,
    // No availability template exists for a staff booking, so there's no
    // provider-configured buffer to respect — the overlap check still runs
    // (start/end collision with any other live appointment), just with 0 pad.
    bookingDocId: blocked ? 'staff-blocked' : contactId!,
    bookingDoc,
    teamId,
    providerId,
    startMs: start.getTime(),
    endMs: end.getTime(),
    bufferMs: 0,
  })

  // ── Post-tx effects per settlement rail ──
  let paymentUrl: string | undefined

  if (plan_.recordPaymentNow) {
    await writeManualPaymentEvent({
      teamId,
      contactId,
      amount: amountMinor,
      currency,
      paymentMode: data.method ?? null,
      lineItem: { kind: 'appointment', label: activity.name },
      comment: note || null,
      idempotencyKey: `apt-staff-paid:${sessionRef.id}`,
      recordedBy: uid,
    })
  }

  if (plan_.paymentIntentMode === 'link') {
    const enabledTeam = await loadEnabledTeam(teamId)
    const { accountId, model } = requireChargeableAccount(enabledTeam)
    const applicationFeeAmount = computePlatformFee({ tier: enabledTeam.plan, amount: amountMinor, model })
    const locale = data.locale ?? 'en'
    const base = `${resolveBaseUrl(data.origin)}/${locale}/pay/result`
    const slugQuery = teamSlug ? `&slug=${encodeURIComponent(teamSlug)}&seg=appointments` : ''
    const minuteBucket = Math.floor(Date.now() / 60_000)
    const metadata: Record<string, string> = {
      kind: 'appointment',
      purpose: 'appointment',
      teamId,
      sessionId: sessionRef.id,
      contactId: contactId as string,
      activityId,
      activityName: activity.name,
      providerId,
      startMs: String(startMs),
      durationMinutes: String(durationMinutes),
      // This hold's proof of ownership, for `handleCheckoutExpired` — which on
      // THIS rail is the only release path there is (the session deliberately
      // carries no hold_expires_at, so the daily sweep never sees it). Without it
      // the expiry handler falls back to the weaker EXCLUSIVITY proof, which is
      // sound but is an argument about the document rather than a fact about this
      // attempt. See appointments/holdRelease.ts.
      bookingToken: bookingToken as string,
    }
    try {
      const checkoutSession = await createOneOffCheckoutSession({
        accountId,
        amount: amountMinor,
        currency: currency.toLowerCase(),
        applicationFeeAmount,
        productName: `${activity.name} · ${durationMinutes} min`,
        successUrl: `${base}?status=success${slugQuery}`,
        cancelUrl: `${base}?status=cancelled${slugQuery}`,
        customerEmail: client?.email || undefined,
        metadata,
        idempotencyKey: `apt-staff-link:${teamId}:${sessionRef.id}:${contactId}:${minuteBucket}`,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + PAYMENT_LINK_EXPIRY_SECONDS,
      })
      paymentUrl = checkoutSession.url
    } catch (err) {
      // Stripe create failed AFTER the hold was written — release it through the
      // SAME ownership-checked transaction `createAppointmentCheckout`'s
      // rollback and `handleCheckoutExpired` use (appointments/holdRelease.ts,
      // which owns the census and the proof each site rests on). This used to
      // cancel the session and delete the booking on PRESENCE while a comment
      // claimed it followed `createAppointmentCheckout`'s catch; that claim was
      // false, and the gap was reachable: this rail writes its hold at the same
      // deterministic `apt_{provider}_{start}` id, and the client's own public
      // retry (`createAppointmentCheckout`, `allowRewriteByHolder: contactId`)
      // can rewrite it between this transaction returning and this catch running
      // — at which point a blind cancel here kills a live, payable Stripe session
      // of theirs.
      console.error('[appointments] createStaffAppointment: payment-link create failed, releasing hold:', err)
      try {
        await releaseAppointmentHold({
          teamId,
          sessionId: sessionRef.id,
          contactId: contactId as string,
          bookingToken,
          label: 'createStaffAppointment',
        })
      } catch (releaseErr) {
        console.error('[appointments] createStaffAppointment: hold release failed:', releaseErr)
      }
      throw new HttpsError('internal', 'Failed to create the payment link')
    }
  }

  // ── Emails ──
  if (!blocked && client) {
    const cancelUrl =
      teamSlug && bookingToken
        ? publicUrl(getHostingUrl(), teamSlug, 'appointments/cancel', { token: bookingToken })
        : null
    await sendAppointmentBookingEmails({
      teamId,
      teamName,
      lang,
      activityName: activity.name,
      providerId,
      providerName,
      start,
      end,
      location: null,
      onlineUrl: null,
      cancelUrl,
      bookingId: `${sessionRef.id}-${contactId}`,
      // The one staff rail on which money has ALREADY changed hands: `paid_offline`
      // takes it over the counter and `writeManualPaymentEvent` records it above.
      // The booking document carries no marker for that settlement —
      // `bookingWasPaidFor` would answer false for every rail here, since the only
      // `payment_status` this callable ever writes is `'required'` — so the plan,
      // which IS this callable's tender decision, answers instead. The other two
      // priced rails are debts, not receipts: `pending_offline` is owed at the
      // door and `payment_link` is unpaid until the webhook confirms it (and the
      // link mail below is the message that actually matters for it).
      wasPaidFor: plan_.recordPaymentNow,
      client,
    })
    if (paymentUrl) {
      try {
        const email = buildPaymentLinkEmail({
          firstname: client.firstname,
          teamName,
          activityName: activity.name,
          start,
          paymentUrl,
        })
        await sendEmail({
          to: client.email,
          subject: `Complete your payment — ${activity.name}`,
          html: email.html,
          text: email.text,
          teamId,
        })
      } catch (err) {
        console.error('[appointments] createStaffAppointment: payment-link email failed:', err)
      }
    }
  }

  return { sessionId: sessionRef.id, contactId: contactId ?? null, ...(paymentUrl ? { paymentUrl } : {}) }
})

// ─── markAppointmentPaid ─────────────────────────────────────────────────────

export const markAppointmentPaid = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; sessionId?: string; method?: string; amount?: number }
  if (!data?.teamId || !data?.sessionId) {
    throw new HttpsError('invalid-argument', 'teamId and sessionId are required')
  }
  const { teamId, sessionId } = data

  await assertManager(request.auth.uid, teamId)

  const db = admin.firestore()
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId)
  const sSnap = await sessionRef.get()
  if (!sSnap.exists) throw new HttpsError('not-found', 'Session not found')
  const s = sSnap.data()!
  if (s.teamId !== teamId) throw new HttpsError('permission-denied', 'Team mismatch')
  if (s.activityType !== 'appointment') throw new HttpsError('failed-precondition', 'Not an appointment session')
  if (s.status !== 'pending_payment' || s.payment_pending !== true || s.payment_intent_mode !== 'offline') {
    throw new HttpsError('failed-precondition', 'This appointment is not awaiting an offline payment')
  }

  const amountMinor =
    typeof data.amount === 'number' ? Math.round(data.amount) : ((s.payment_amount as number | undefined) ?? 0)
  if (!Number.isInteger(amountMinor) || amountMinor < 1) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer in minor units')
  }
  const currency = (s.payment_currency as string | undefined) ?? 'CHF'
  // Denormalised on the session by createStaffAppointment — no bookings-subcollection read needed.
  const contactId = (s.contact_id as string | null | undefined) ?? null

  await writeManualPaymentEvent({
    teamId,
    contactId,
    amount: amountMinor,
    currency,
    paymentMode: data.method ?? null,
    lineItem: { kind: 'appointment', label: (s.activityName as string | undefined) ?? 'Appointment' },
    comment: null,
    idempotencyKey: `apt-staff-mark-paid:${sessionId}`,
    recordedBy: request.auth.uid,
  })

  await sessionRef.update({
    status: 'full',
    payment_pending: FieldValue.delete(),
    payment_intent_mode: FieldValue.delete(),
  })

  return { ok: true }
})
