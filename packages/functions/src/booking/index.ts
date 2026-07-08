/* eslint-disable no-console */
import { randomInt } from 'crypto'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { systemEmailEnabledFor } from '../utils/systemEmails'
import { hashVerificationCode, verifyCode, generateSecureToken } from '../utils/crypto'
import { getHostingUrl } from '../utils/env'
import { to } from '../utils/async'
import { resolveReferralCode, createReferral } from '../utils/referrals'
import {
  buildBookingConfirmationEmail,
  buildTeacherNotificationEmail,
  buildVerificationCodeEmail,
} from './templates'
import {
  buildCoachingConfirmationEmail,
  buildCoachingICalAttachment,
  buildCoachNotificationEmail,
} from '../coaching/templates'
import {
  resolveActivityAccessRule,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  type ActivityAccessRule,
  type SubscriptionPrice,
} from '@linyup/shared'

type Lang = 'en' | 'de' | 'fr' | 'it'
const VALID_LANGS: Lang[] = ['en', 'de', 'fr', 'it']
function isLang(v: unknown): v is Lang {
  return VALID_LANGS.includes(v as Lang)
}

/**
 * Does HOLDING a subscription of this type grant unmetered (non-credit) access?
 * Used by the booking access gate: credit-pack types must not pass on the
 * membership snapshot alone — their access is metered by credit balance.
 *   • The contact's held price is a non-credit price of this type → true.
 *   • The contact's held price is a credit price of this type      → false.
 *   • Price unknown: true unless EVERY active price carries credits (a
 *     credits-only type can only ever grant metered access).
 */
async function typeGrantsUnmeteredAccess(
  teamId: string,
  subscriptionTypeId: string,
  contact: FirebaseFirestore.DocumentData
): Promise<boolean> {
  try {
    const snap = await admin
      .firestore()
      .collection('teams')
      .doc(teamId)
      .collection('subscription_types')
      .doc(subscriptionTypeId)
      .get()
    if (!snap.exists) return true // unknown type — behave as before credits existed
    const prices = ((snap.data()?.prices as SubscriptionPrice[] | undefined) ?? []).filter(
      (p) => p.active !== false
    )
    if (prices.length === 0 || prices.every((p) => !p.credits)) return true
    const heldPriceId =
      contact.subscription_type_id === subscriptionTypeId
        ? (contact.subscription_price_id as string | undefined)
        : undefined
    if (heldPriceId) {
      const heldPrice = prices.find((p) => p.id === heldPriceId)
      if (heldPrice) return !heldPrice.credits
    }
    // Held price unknown: lenient unless the type is credits-only.
    return prices.some((p) => !p.credits)
  } catch {
    return true // fail open — same behavior as before the credits feature
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sendBookingVerificationCode
// ─────────────────────────────────────────────────────────────────────────────

export const sendBookingVerificationCode = onCall(async (request) => {
  const data = request.data as { email?: string; teamId?: string }

  if (!data?.email || !data?.teamId) {
    throw new HttpsError('invalid-argument', 'email and teamId are required')
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(data.email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format')
  }

  const sanitizedEmail = data.email.toLowerCase().trim()
  const teamId = data.teamId.trim()

  // Validate team exists
  const teamDoc = await admin.firestore().collection('teams').doc(teamId).get()
  if (!teamDoc.exists) throw new HttpsError('not-found', 'Team not found')

  const teamData = teamDoc.data()!
  const teamName: string = teamData.name || 'Our Team'
  const lang: Lang = isLang(teamData.language) ? teamData.language : 'en'

  // Rate limit: max 3 codes per email+team per hour
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
  const recentCodes = await admin
    .firestore()
    .collection('booking_verification_codes')
    .where('email', '==', sanitizedEmail)
    .where('team_id', '==', teamId)
    .where('created_at', '>', oneHourAgo)
    .get()

  if (recentCodes.size >= 3) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many verification requests. Please try again in an hour.'
    )
  }

  // Find matching contacts
  const contactsSnap = await admin
    .firestore()
    .collection('contacts')
    .where('teamId', '==', teamId)
    .where('email', '==', sanitizedEmail)
    .where('deleted_at', '==', null)
    .get()

  if (contactsSnap.empty) {
    return {
      success: true,
      hasContacts: false,
      message: 'No existing profile found. Please use the regular booking form.',
    }
  }

  const matchedContactIds = contactsSnap.docs.map((d) => d.id)

  // Generate and store code
  const code = randomInt(100000, 1000000).toString()
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
  const codeHash = hashVerificationCode(code, sanitizedEmail)

  const codeRef = await admin.firestore().collection('booking_verification_codes').add({
    email: sanitizedEmail,
    team_id: teamId,
    code_hash: codeHash,
    attempts: 0,
    created_at: FieldValue.serverTimestamp(),
    expires_at: expiresAt,
    verified: false,
    used: false,
    matched_contact_ids: matchedContactIds,
    type: 'booking_verification',
  })

  // Send email
  try {
    const emailContent = buildVerificationCodeEmail({ code, teamName, expiresInMinutes: 10, lang })
    const subjects: Record<Lang, string> = {
      en: `Your verification code for ${teamName}`,
      de: `Ihr Verifizierungscode für ${teamName}`,
      fr: `Votre code de vérification pour ${teamName}`,
      it: `Il tuo codice di verifica per ${teamName}`,
    }
    await sendEmail({
      to: sanitizedEmail,
      subject: subjects[lang],
      html: emailContent.html,
      text: emailContent.text,
      teamId,
    })
    console.log(`Booking verification email sent (team: ${teamId})`)
  } catch (err) {
    await codeRef.delete()
    throw new HttpsError('internal', 'Failed to send verification email. Please try again.')
  }

  return {
    success: true,
    hasContacts: true,
    codeId: codeRef.id,
    expiresAt: expiresAt.toMillis(),
    contactsCount: matchedContactIds.length,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// verifyBookingCode
// ─────────────────────────────────────────────────────────────────────────────

export const verifyBookingCode = onCall(async (request) => {
  const data = request.data as { codeId?: string; code?: string; selectedContactId?: string }

  if (!data?.codeId) throw new HttpsError('invalid-argument', 'codeId is required')
  if (!data.code && !data.selectedContactId)
    throw new HttpsError('invalid-argument', 'code or selectedContactId is required')

  if (data.code && !/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  const codeRef = admin.firestore().collection('booking_verification_codes').doc(data.codeId)
  const codeDoc = await codeRef.get()
  if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid verification code')

  const codeData = codeDoc.data()!

  if (codeData.used)
    throw new HttpsError('failed-precondition', 'This verification code has already been used.')

  const now = Timestamp.now()
  if (codeData.expires_at.toMillis() < now.toMillis()) {
    throw new HttpsError(
      'deadline-exceeded',
      'Verification code has expired. Please request a new code.'
    )
  }

  if (codeData.attempts >= 5) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many failed attempts. Please request a new code.'
    )
  }

  const matchedContactIds: string[] = codeData.matched_contact_ids || []

  // Handle contact selection after already verified
  if (codeData.verified && data.selectedContactId) {
    if (!matchedContactIds.includes(data.selectedContactId)) {
      throw new HttpsError('invalid-argument', 'Selected contact not found in matched contacts')
    }
    const contactDoc = await admin
      .firestore()
      .collection('contacts')
      .doc(data.selectedContactId)
      .get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Selected contact no longer exists')
    const c = contactDoc.data()!
    return {
      verified: true,
      codeId: data.codeId,
      selectedContactId: data.selectedContactId,
      contactData: {
        id: contactDoc.id,
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        email: c.email || '',
        phone: c.phone || '',
      },
      requiresContactSelection: false,
    }
  }

  // Verify the code
  if (data.code) {
    const isValid = codeData.code_hash
      ? verifyCode(data.code, codeData.email, codeData.code_hash)
      : false

    if (!isValid) {
      await codeRef.update({ attempts: FieldValue.increment(1) })
      const remaining = 5 - (codeData.attempts + 1)
      throw new HttpsError(
        'invalid-argument',
        `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      )
    }

    await codeRef.update({ verified: true, verified_at: FieldValue.serverTimestamp() })
  }

  // Fetch matched contacts
  const contacts = await Promise.all(
    matchedContactIds.map(async (id) => {
      const d = await admin.firestore().collection('contacts').doc(id).get()
      if (!d.exists) return null
      const c = d.data()!
      return {
        id: d.id,
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        phone: c.phone || '',
      }
    })
  ).then(
    (r) => r.filter(Boolean) as { id: string; firstname: string; lastname: string; phone: string }[]
  )

  // Auto-select if single contact
  if (contacts.length === 1) {
    const single = contacts[0]
    const contactDoc = await admin.firestore().collection('contacts').doc(single.id).get()
    const c = contactDoc.data()!
    return {
      verified: true,
      codeId: data.codeId,
      selectedContactId: single.id,
      contactData: {
        id: contactDoc.id,
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        email: c.email || '',
        phone: c.phone || '',
      },
      requiresContactSelection: false,
    }
  }

  return {
    verified: true,
    codeId: data.codeId,
    matchedContacts: contacts,
    requiresContactSelection: true,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// bookSession
// ─────────────────────────────────────────────────────────────────────────────

export const bookSession = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    sessionId?: string
    contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
    authenticatedContactId?: string
    verificationCodeId?: string
    bookingAuthToken?: string
    referralCode?: string
    subscription_type_id?: string
  }

  if (!data?.teamId || !data?.sessionId) {
    throw new HttpsError('invalid-argument', 'teamId and sessionId are required')
  }

  // ── Referral code resolution (non-fatal) ────────────────────────────────────
  let referrerContactId: string | null = null
  if (data.referralCode && typeof data.referralCode === 'string') {
    try {
      const referral = await resolveReferralCode(data.referralCode.trim().toUpperCase())
      if (referral && referral.teamId === data.teamId) {
        referrerContactId = referral.contactId
      }
    } catch (err) {
      console.error('Error resolving referral code, ignoring:', err)
    }
  }

  // ── IP rate limit: max 10 bookings per hour per IP ──────────────────────────
  const bookingIp: string | null = request.rawRequest?.ip || null
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)

  if (bookingIp) {
    const recentIpBookings = await admin
      .firestore()
      .collection('sessions')
      .doc(data.sessionId)
      .collection('bookings')
      .where('booking_ip', '==', bookingIp)
      .where('joinedAt', '>', oneHourAgo)
      .get()
    if (recentIpBookings.size >= 10) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many booking requests. Please try again later.'
      )
    }
  }

  // ── Session rate limit: max 50 bookings per hour per session ─────────────────
  const recentSessionBookings = await admin
    .firestore()
    .collection('sessions')
    .doc(data.sessionId)
    .collection('bookings')
    .where('joinedAt', '>', oneHourAgo)
    .get()

  if (recentSessionBookings.size >= 50) {
    throw new HttpsError('resource-exhausted', 'This session has reached its booking limit.')
  }

  // ── Resolve authenticated contact ────────────────────────────────────────────
  let authenticatedContact: (admin.firestore.DocumentData & { id: string }) | null = null

  // bookingAuthToken path — one-time token stored in auth_tokens with type:'booking'
  if (data.bookingAuthToken) {
    const tokenDoc = await admin
      .firestore()
      .collection('auth_tokens')
      .doc(data.bookingAuthToken)
      .get()
    if (!tokenDoc.exists) throw new HttpsError('invalid-argument', 'Invalid booking auth token')
    const tokenData = tokenDoc.data()!
    if (tokenData.type !== 'booking')
      throw new HttpsError('permission-denied', 'Token is not a booking token')
    if (tokenData.team_id !== data.teamId)
      throw new HttpsError('permission-denied', 'Token does not match the requested team')
    const now = Timestamp.now()
    if (tokenData.expires_at?.toMillis() < now.toMillis())
      throw new HttpsError('deadline-exceeded', 'Booking auth token has expired')
    if (tokenData.used)
      throw new HttpsError('failed-precondition', 'Booking auth token has already been used')

    const contactDoc = await admin
      .firestore()
      .collection('contacts')
      .doc(tokenData.contact_id)
      .get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const c = contactDoc.data()!
    if (c.teamId !== data.teamId)
      throw new HttpsError('permission-denied', 'Contact does not belong to this team')

    await admin.firestore().collection('auth_tokens').doc(data.bookingAuthToken).update({
      used: true,
      used_at: FieldValue.serverTimestamp(),
      used_for_session: data.sessionId,
    })

    authenticatedContact = { id: tokenData.contact_id as string, ...c }
  }

  if (data.authenticatedContactId) {
    // Validate verification code
    if (data.verificationCodeId) {
      const codeDoc = await admin
        .firestore()
        .collection('booking_verification_codes')
        .doc(data.verificationCodeId)
        .get()
      if (!codeDoc.exists) throw new HttpsError('invalid-argument', 'Invalid verification code')
      const codeData = codeDoc.data()!
      if (!codeData.verified)
        throw new HttpsError('failed-precondition', 'Verification code not verified')
      if (codeData.team_id !== data.teamId)
        throw new HttpsError('permission-denied', 'Code does not match team')
      const isValid = (codeData.matched_contact_ids || []).includes(data.authenticatedContactId)
      if (!isValid)
        throw new HttpsError('permission-denied', 'Contact not found in verified matches')
      await admin
        .firestore()
        .collection('booking_verification_codes')
        .doc(data.verificationCodeId)
        .update({
          used: true,
          used_at: FieldValue.serverTimestamp(),
          used_for_session: data.sessionId,
          used_contact_id: data.authenticatedContactId,
        })
    }

    const contactDoc = await admin
      .firestore()
      .collection('contacts')
      .doc(data.authenticatedContactId)
      .get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const contactData = contactDoc.data()!
    if (contactData.teamId !== data.teamId)
      throw new HttpsError('permission-denied', 'Contact does not belong to this team')
    authenticatedContact = { id: data.authenticatedContactId, ...contactData }
  }

  const isAuthenticatedBooking = !!authenticatedContact

  // Build sanitized contact details
  let sanitized: { firstname: string; lastname: string; email: string; phone?: string | null }

  if (authenticatedContact) {
    sanitized = {
      firstname: authenticatedContact.firstname || '',
      lastname: authenticatedContact.lastname || '',
      email: (authenticatedContact.email || '').toLowerCase().trim(),
      phone: authenticatedContact.phone || null,
    }
  } else {
    if (!data.contactDetails)
      throw new HttpsError('invalid-argument', 'contactDetails required for new bookings')
    const { firstname, lastname, email, phone } = data.contactDetails
    if (!firstname || !lastname || !email)
      throw new HttpsError('invalid-argument', 'firstname, lastname, email required')
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) throw new HttpsError('invalid-argument', 'Invalid email format')
    sanitized = {
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || null,
    }
  }

  // Validate team and get owner email
  const team = await getTeam(data.teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  const lang: Lang = isLang(team.language) ? team.language : 'en'
  const teamName: string = team.name || 'Our Team'

  let ownerEmail: string | null = null
  let ownerFirstname = 'Team'
  const ownersSnap = await admin
    .firestore()
    .collection('teams')
    .doc(data.teamId)
    .collection('team_members')
    .where('role', '==', 'owner')
    .limit(1)
    .get()
  if (!ownersSnap.empty) {
    const ownerId = ownersSnap.docs[0].id
    const ownerDoc = await admin.firestore().collection('users').doc(ownerId).get()
    if (ownerDoc.exists) {
      ownerEmail = ownerDoc.get('email')
      ownerFirstname = ownerDoc.get('firstname') || 'Team'
    }
  }

  // Validate session
  const sessionDoc = await admin.firestore().collection('sessions').doc(data.sessionId).get()
  if (!sessionDoc.exists) throw new HttpsError('not-found', 'Session not found')
  const sessionData = sessionDoc.data()!

  if (sessionData.teamId !== data.teamId)
    throw new HttpsError('permission-denied', 'Session does not belong to this team')
  if (!sessionData.allowBooking)
    throw new HttpsError('permission-denied', 'Bookings are not allowed for this session')

  const now = Timestamp.now()
  if (sessionData.start.toMillis() < now.toMillis()) {
    throw new HttpsError('failed-precondition', 'Cannot book sessions in the past')
  }

  // Get activity name and access rule (the paid-access gate)
  const isCoachingSession = sessionData.activityType === 'coaching'
  let activityName = (sessionData.activityName as string) || 'Session'
  let accessRule: ActivityAccessRule = { type: 'open' }
  // Per-activity confirmation note (overrides the team-wide setting below).
  let activityInstructions: string | null = null

  if (isCoachingSession) {
    // Coaching carries the access gate directly on the session doc.
    accessRule = resolveActivityAccessRule({
      accessRule: sessionData.accessRule as ActivityAccessRule | undefined,
      isFreeTrial: sessionData.isFreeTrial as boolean | undefined,
    })
    // Check capacity
    const maxParticipants = (sessionData.max_participants as number) || 1
    const bookingsCount = (sessionData.bookings_count as number) || 0
    if (sessionData.status === 'full' || bookingsCount >= maxParticipants) {
      throw new HttpsError('failed-precondition', 'This coaching slot is fully booked.')
    }
    if (sessionData.activityId) {
      try {
        const actDoc = await admin
          .firestore()
          .collection('activities')
          .doc(sessionData.activityId as string)
          .get()
        if (actDoc.exists) {
          activityInstructions = (actDoc.data()!.confirmationInstructions as string) || null
        }
      } catch (_) {
        /* non-fatal */
      }
    }
  } else if (sessionData.activityId) {
    try {
      const actDoc = await admin
        .firestore()
        .collection('activities')
        .doc(sessionData.activityId)
        .get()
      if (actDoc.exists) {
        const actData = actDoc.data()!
        activityName = actData.name || activityName
        accessRule = resolveActivityAccessRule({
          accessRule: actData.accessRule as ActivityAccessRule | undefined,
          isFreeTrial: actData.isFreeTrial as boolean | undefined,
        })
        activityInstructions = (actData.confirmationInstructions as string) || null
      }
    } catch (_) {
      /* non-fatal */
    }
  }

  // Studio note appended to the confirmation email: activity override ?? team default.
  const teamInstructions =
    ((team.settings as Record<string, unknown> | undefined)?.bookingConfirmationInstructions as
      | string
      | undefined) || null
  const bookingInstructions = activityInstructions?.trim() || teamInstructions?.trim() || null

  if (!isCoachingSession) {
    // Group-class booking cap (optional; enforced against the live reserved count).
    const maxGroup = sessionData.max_participants as number | undefined
    if (maxGroup && maxGroup > 0) {
      const reserved = (sessionData.bio_link_bookings_count as number) || 0
      if (reserved >= maxGroup) {
        throw new HttpsError('resource-exhausted', 'This session is fully booked.')
      }
    }
  }

  // ── Access gate (paid-access axis) ─────────────────────────────────────────
  // Set when a 'subscription' rule matched a live subscription — stored on the booking.
  let matchedSubscriptionTypeId: string | null = null
  // Set when the match came from a lesson-credit pack: one credit of this type is
  // decremented transactionally with the booking write below.
  let creditSpendTypeId: string | null = null
  if (accessRule.type !== 'open') {
    if (!authenticatedContact) {
      const msg = isCoachingSession
        ? 'This coaching series is for registered members only. Please verify your email.'
        : 'This session is for registered members only. Please verify your email.'
      throw new HttpsError('permission-denied', msg)
    }
    if (authenticatedContact.acquisition_stage !== 'joined') {
      const msg = isCoachingSession
        ? 'This coaching series is for members only. Trial accounts cannot book.'
        : 'This session is for members only. Trial accounts cannot book this class.'
      throw new HttpsError('permission-denied', msg)
    }
    if (accessRule.type === 'subscription') {
      const allowed = accessRule.subscriptionTypeIds ?? []
      // Coverage = any LIVE subscription the contact holds (fallback: primary snapshot).
      const held = new Set<string>()
      const active =
        (authenticatedContact.active_subscriptions as
          | Array<{ subscription_type_id?: string }>
          | undefined) ?? []
      active.forEach((s) => {
        if (s.subscription_type_id) held.add(s.subscription_type_id)
      })
      if (authenticatedContact.subscription_type_id)
        held.add(authenticatedContact.subscription_type_id)

      // Lesson-credit balances (denormalised rollup; expiry re-checked on spend).
      const nowMs = Date.now()
      const creditTypes = new Set(
        (
          (authenticatedContact.credit_summary as
            | Array<{
                subscription_type_id: string
                remaining: number
                next_expires_at?: Timestamp | null
              }>
            | undefined) ?? []
        )
          .filter(
            (e) =>
              e.remaining > 0 && (!e.next_expires_at || e.next_expires_at.toMillis() > nowMs)
          )
          .map((e) => e.subscription_type_id)
      )

      // 1) Unmetered coverage first — a held subscription whose type isn't
      //    credits-only never burns credits.
      for (const id of allowed) {
        if (!held.has(id)) continue
        if (await typeGrantsUnmeteredAccess(data.teamId, id, authenticatedContact)) {
          matchedSubscriptionTypeId = id
          break
        }
      }
      // 2) Credit coverage — spend one credit (transactionally, at booking write).
      if (!matchedSubscriptionTypeId) {
        const creditType = allowed.find((id) => creditTypes.has(id))
        if (creditType) {
          matchedSubscriptionTypeId = creditType
          creditSpendTypeId = creditType
        }
      }
      if (!matchedSubscriptionTypeId) {
        const heldCreditType = allowed.some((id) => held.has(id))
        throw new HttpsError(
          'permission-denied',
          heldCreditType
            ? 'No lesson credits remaining on your pack. Purchase a new pack to book this class.'
            : 'This class requires an active membership you do not currently hold.'
        )
      }
    }
  }

  // Resolve or create contact
  let contactId: string
  let isNewContact = false

  if (authenticatedContact) {
    contactId = authenticatedContact.id
    // Check for duplicate booking
    const [existingBooking, existingParticipant] = await Promise.all([
      admin
        .firestore()
        .collection('sessions')
        .doc(data.sessionId)
        .collection('bookings')
        .doc(contactId)
        .get(),
      admin
        .firestore()
        .collection('sessions')
        .doc(data.sessionId)
        .collection('participants')
        .doc(contactId)
        .get(),
    ])
    // A pending (unpaid drop-in) hold does not block a free booking — the buyer may
    // have abandoned checkout; only a confirmed booking / attendance blocks re-booking.
    if (
      existingParticipant.exists ||
      (existingBooking.exists && existingBooking.data()?.status !== 'pending')
    ) {
      throw new HttpsError('already-exists', 'You are already registered for this session')
    }
  } else {
    // Find existing contact by email + name
    const existingSnap = await admin
      .firestore()
      .collection('contacts')
      .where('teamId', '==', data.teamId)
      .where('email', '==', sanitized.email)
      .get()
    const exactMatch = existingSnap.docs.find((d) => {
      const c = d.data()
      return (
        c.firstname?.toLowerCase().trim() === sanitized.firstname.toLowerCase() &&
        c.lastname?.toLowerCase().trim() === sanitized.lastname.toLowerCase()
      )
    })

    if (exactMatch) {
      contactId = exactMatch.id
      const [existingBooking, existingParticipant] = await Promise.all([
        admin
          .firestore()
          .collection('sessions')
          .doc(data.sessionId)
          .collection('bookings')
          .doc(contactId)
          .get(),
        admin
          .firestore()
          .collection('sessions')
          .doc(data.sessionId)
          .collection('participants')
          .doc(contactId)
          .get(),
      ])
      if (existingBooking.exists || existingParticipant.exists) {
        throw new HttpsError('already-exists', 'You are already registered for this session')
      }
      // An existing OFF-FUNNEL contact (form/shop lead — no acquisition stage)
      // booking a trial enters the funnel normally at this point.
      if (!exactMatch.data().acquisition_stage) {
        await exactMatch.ref.update({
          acquisition_stage: 'trial_booked',
          acquisition_stage_updated_at: FieldValue.serverTimestamp(),
          trial_booked_at: FieldValue.serverTimestamp(),
        })
      }
    } else {
      isNewContact = true
      const newContactRef = admin.firestore().collection('contacts').doc()
      await newContactRef.set({
        firstname: sanitized.firstname,
        lastname: sanitized.lastname,
        email: sanitized.email,
        phone: sanitized.phone,
        // Acquisition: a trial booking is born at 'trial_booked' (booked, not yet
        // attended). First attendance promotes it to 'trial_attended'.
        acquisition_stage: 'trial_booked',
        acquisition_stage_updated_at: FieldValue.serverTimestamp(),
        entry: 'booking',
        // A never-attended trial lead doesn't count toward the contact cap (no
        // expiry — the 'lib_trial_cleanup' automation archives stale ones).
        // Cleared on first attendance/payment/promotion. See Contact.provisional.
        provisional: true,
        teamId: data.teamId,
        archived_at: null,
        deleted_at: null,
        created_at: FieldValue.serverTimestamp(),
        pending_bookings_count: 1,
      })
      contactId = newContactRef.id
      console.log(`New trial contact created: ${contactId}`)
    }
  }

  // Add booking to session
  const bookingToken = generateSecureToken()
  const teamSlug: string | null = team.slug || null
  const manageBookingUrl = teamSlug
    ? `${getHostingUrl()}/public/${teamSlug}/manage-booking?token=${bookingToken}`
    : null
  const subscriptionTypeId =
    matchedSubscriptionTypeId ??
    (typeof data.subscription_type_id === 'string' && data.subscription_type_id
      ? data.subscription_type_id
      : null)

  const bookingDoc = {
    firstname: sanitized.firstname,
    lastname: sanitized.lastname,
    email: sanitized.email,
    phone: sanitized.phone ?? null,
    contact: contactId,
    session: data.sessionId,
    teamId: data.teamId,
    joinedAt: FieldValue.serverTimestamp(),
    fromBioLink: true,
    is_new_contact: isNewContact,
    booking_token: bookingToken,
    booking_ip: bookingIp,
    authenticated_booking: isAuthenticatedBooking,
    subscription_type_id: subscriptionTypeId,
  }
  const sessionCounterUpdate = {
    has_bookings: true,
    bio_link_bookings_count: FieldValue.increment(1),
    ...(isNewContact && { bio_link_new_contact_bookings_count: FieldValue.increment(1) }),
    last_booking_at: FieldValue.serverTimestamp(),
  }
  const bookingRef = admin
    .firestore()
    .collection('sessions')
    .doc(data.sessionId)
    .collection('bookings')
    .doc(contactId)
  const sessionRef = admin.firestore().collection('sessions').doc(data.sessionId)

  if (creditSpendTypeId) {
    // Credit-pack booking: spend one credit atomically with the booking write.
    // FIFO across the contact's usable grants (soonest expiry first, then oldest).
    // The concurrent-booking race is settled here: the transaction re-reads the
    // grants and fails when the last credit was consumed in the meantime.
    const db = admin.firestore()
    await db.runTransaction(async (tx) => {
      const grantsQuery = db
        .collection('contacts')
        .doc(contactId)
        .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
        .where('teamId', '==', data.teamId)
        .where('subscription_type_id', '==', creditSpendTypeId)
      const grantsSnap = await tx.get(grantsQuery)
      const nowMs = Date.now()
      interface UsableGrant {
        ref: FirebaseFirestore.DocumentReference
        credits_total: number
        credits_used: number
        expires_at: Timestamp | null
        created_at: Timestamp | null
      }
      const usable: UsableGrant[] = grantsSnap.docs
        .map((d) => {
          const g = d.data()
          return {
            ref: d.ref,
            credits_total: (g.credits_total as number) ?? 0,
            credits_used: (g.credits_used as number) ?? 0,
            expires_at: (g.expires_at as Timestamp | null) ?? null,
            created_at: (g.created_at as Timestamp | null) ?? null,
          }
        })
        .filter(
          (g) =>
            g.credits_used < g.credits_total && (!g.expires_at || g.expires_at.toMillis() > nowMs)
        )
        .sort((a, b) => {
          const ax = a.expires_at?.toMillis() ?? Number.MAX_SAFE_INTEGER
          const bx = b.expires_at?.toMillis() ?? Number.MAX_SAFE_INTEGER
          if (ax !== bx) return ax - bx
          return (a.created_at?.toMillis() ?? 0) - (b.created_at?.toMillis() ?? 0)
        })
      const grant = usable[0]
      if (!grant) {
        throw new HttpsError(
          'permission-denied',
          'No lesson credits remaining on your pack. Purchase a new pack to book this class.'
        )
      }
      tx.update(grant.ref, { credits_used: grant.credits_used + 1 })
      tx.set(bookingRef, { ...bookingDoc, credit_grant_id: grant.ref.id, credit_spent: 1 })
      tx.set(sessionRef, sessionCounterUpdate, { merge: true })
    })
  } else {
    // Non-credit path — unchanged.
    await bookingRef.set(bookingDoc)
    await sessionRef.set(sessionCounterUpdate, { merge: true })
  }

  if (!isNewContact) {
    await admin
      .firestore()
      .collection('contacts')
      .doc(contactId)
      .update({ pending_bookings_count: FieldValue.increment(1) })
  }

  // Contact alert (booking notification, shows immediately)
  try {
    const sessionStart: Date = (sessionData.start as Timestamp).toDate()
    await admin
      .firestore()
      .collection('contacts')
      .doc(contactId)
      .collection('contact_alerts')
      .add({
        teamId: data.teamId,
        contact: {
          id: contactId,
          firstname: sanitized.firstname,
          lastname: sanitized.lastname,
          avatar_url: authenticatedContact?.avatar_url ?? null,
        },
        message: `New booking for ${activityName} on ${sessionStart.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}`,
        schedule: { type: 'datetime', value: Timestamp.now() },
        alert_type: 'booking',
        session_id: data.sessionId,
        created_at: FieldValue.serverTimestamp(),
        archived_at: null,
      })
  } catch (alertErr) {
    console.error('Failed to create contact alert for booking:', alertErr)
  }

  // Referral tracking (non-fatal)
  if (referrerContactId && referrerContactId !== contactId) {
    try {
      const existingReferral = await admin
        .firestore()
        .collection('referrals')
        .where('referred_contact_id', '==', contactId)
        .where('team_id', '==', data.teamId)
        .limit(1)
        .get()
      if (existingReferral.empty) {
        await createReferral(referrerContactId, contactId, data.teamId)
      }
    } catch (refErr) {
      console.error('Failed to create referral record:', refErr)
    }
  }

  // Send confirmation email — member-facing, per-team toggleable (Automations →
  // System emails). Coach/studio notifications below are unaffected.
  const confirmationEnabled = await systemEmailEnabledFor(data.teamId, 'booking_confirmation')
  const sessionStart: Date = sessionData.start.toDate()
  const sessionEnd: Date = sessionData.end.toDate()

  if (isCoachingSession) {
    // ── Coaching session: personalised confirmation + .ics + coach notification ─
    const coachId = sessionData.coachId as string | null
    const coachName = (sessionData.coachName as string) || 'Your coach'
    let coachEmail: string | null = null
    let coachFirstname = 'Coach'
    if (coachId) {
      const [, coachDoc] = await to(admin.firestore().collection('users').doc(coachId).get())
      if (coachDoc?.exists) {
        coachEmail = coachDoc.get('email') || null
        coachFirstname = coachDoc.get('firstname') || 'Coach'
      }
    }

    const cancelUrl = manageBookingUrl // reuse manage-booking URL for cancellation
    try {
      const email = buildCoachingConfirmationEmail({
        firstname: sanitized.firstname,
        teamName,
        slotTitle: activityName,
        coachName,
        start: sessionStart,
        end: sessionEnd,
        location: sessionData.location || null,
        onlineUrl: sessionData.onlineUrl || null,
        cancelUrl: cancelUrl || null,
        instructions: bookingInstructions,
        lang,
      })
      const ical = buildCoachingICalAttachment({
        bookingId: `${data.sessionId}-${contactId}`,
        slotTitle: activityName,
        start: sessionStart,
        end: sessionEnd,
        location: sessionData.location || null,
        coachName,
        coachEmail: coachEmail || 'noreply@linyup.com',
        clientName: `${sanitized.firstname} ${sanitized.lastname}`,
        clientEmail: sanitized.email,
      })
      const subjects: Record<Lang, string> = {
        en: `Appointment Confirmed – ${activityName}`,
        de: `Termin bestätigt – ${activityName}`,
        fr: `Rendez-vous confirmé – ${activityName}`,
        it: `Appuntamento confermato – ${activityName}`,
      }
      if (confirmationEnabled)
        await sendEmail({
          to: sanitized.email,
          subject: subjects[lang],
          html: email.html,
          text: email.text,
          teamId: data.teamId,
          attachments: [
            { filename: ical.filename, content: ical.content, contentType: ical.contentType },
          ],
        })
    } catch (err) {
      console.error('Error sending coaching confirmation email:', err)
    }

    // Coach notification
    if (coachEmail) {
      try {
        const notif = buildCoachNotificationEmail({
          coachFirstname,
          clientName: `${sanitized.firstname} ${sanitized.lastname}`,
          clientEmail: sanitized.email,
          clientPhone: sanitized.phone || null,
          slotTitle: activityName,
          start: sessionStart,
          end: sessionEnd,
          notes: null,
          lang,
        })
        const subjects: Record<Lang, string> = {
          en: `New appointment: ${sanitized.firstname} ${sanitized.lastname}`,
          de: `Neuer Termin: ${sanitized.firstname} ${sanitized.lastname}`,
          fr: `Nouveau rendez-vous : ${sanitized.firstname} ${sanitized.lastname}`,
          it: `Nuovo appuntamento: ${sanitized.firstname} ${sanitized.lastname}`,
        }
        await sendEmail({
          to: coachEmail,
          subject: subjects[lang],
          html: notif.html,
          text: notif.text,
          teamId: data.teamId,
        })
      } catch (err) {
        console.error('Error sending coaching coach notification email:', err)
      }
    }
  } else {
    // ── Regular group-class session ─────────────────────────────────────────────
    try {
      const confirmEmail = buildBookingConfirmationEmail({
        firstname: sanitized.firstname,
        teamName,
        activityName,
        sessionStart,
        sessionEnd,
        locationName: sessionData.location || null,
        manageBookingUrl,
        instructions: bookingInstructions,
        lang,
      })
      const subjects: Record<Lang, string> = {
        en: `Booking Confirmed – ${activityName}`,
        de: `Buchung bestätigt – ${activityName}`,
        fr: `Réservation confirmée – ${activityName}`,
        it: `Prenotazione confermata – ${activityName}`,
      }
      if (confirmationEnabled) {
        await sendEmail({
          to: sanitized.email,
          subject: subjects[lang],
          html: confirmEmail.html,
          text: confirmEmail.text,
          teamId: data.teamId,
        })
        console.log(`Confirmation email sent to ${sanitized.email}`)
      }
    } catch (err) {
      console.error('Error sending confirmation email:', err)
    }

    // Send notification to owner
    if (ownerEmail) {
      try {
        const notifEmail = buildTeacherNotificationEmail({
          teamOwnerFirstname: ownerFirstname,
          contactName: `${sanitized.firstname} ${sanitized.lastname}`,
          contactEmail: sanitized.email,
          contactPhone: sanitized.phone,
          activityName,
          sessionStart,
          sessionEnd,
          lang,
        })
        const subjects: Record<Lang, string> = {
          en: `New Booking: ${sanitized.firstname} ${sanitized.lastname}`,
          de: `Neue Buchung: ${sanitized.firstname} ${sanitized.lastname}`,
          fr: `Nouvelle réservation : ${sanitized.firstname} ${sanitized.lastname}`,
          it: `Nuova prenotazione: ${sanitized.firstname} ${sanitized.lastname}`,
        }
        await sendEmail({
          to: ownerEmail,
          subject: subjects[lang],
          html: notifEmail.html,
          text: notifEmail.text,
          teamId: data.teamId,
        })
        console.log(`Owner notification sent to ${ownerEmail}`)
      } catch (err) {
        console.error('Error sending owner notification:', err)
      }
    }
  }

  return {
    success: true,
    contactId,
    sessionId: data.sessionId,
    isNewContact,
    isAuthenticatedBooking,
    sessionDetails: {
      activityName,
      start: sessionStart.toISOString(),
      end: sessionEnd.toISOString(),
    },
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// cancelBooking — public, token-based (unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

export const cancelBooking = onCall(async (request) => {
  const { token } = request.data as { token?: string }
  if (!token) throw new HttpsError('invalid-argument', 'Booking token is required')

  const db = admin.firestore()

  let bookingsSnapshot = await db
    .collectionGroup('bookings')
    .where('booking_token', '==', token)
    .limit(1)
    .get()
  if (bookingsSnapshot.empty) {
    bookingsSnapshot = await db
      .collectionGroup('participants')
      .where('booking_token', '==', token)
      .limit(1)
      .get()
  }
  if (bookingsSnapshot.empty) {
    throw new HttpsError(
      'not-found',
      'Booking not found. The link may have expired or the booking was already cancelled.'
    )
  }

  const bookingDoc = bookingsSnapshot.docs[0]
  const booking = bookingDoc.data()

  const cancellableStatuses = ['pending', 'no_show']
  if (booking.status && !cancellableStatuses.includes(booking.status as string)) {
    throw new HttpsError(
      'failed-precondition',
      'This booking has already been cancelled or confirmed.'
    )
  }

  const pathParts = bookingDoc.ref.path.split('/')
  const sessionId = pathParts[1]
  const contactId = booking.contact as string | undefined

  const [sessionErr, sessionDoc] = await to(db.collection('sessions').doc(sessionId).get())
  if (sessionErr || !sessionDoc || !sessionDoc.exists)
    throw new HttpsError('not-found', 'Session no longer exists.')

  const session = sessionDoc.data()!
  const sessionStart = (session.start as Timestamp).toDate()
  if (sessionStart < new Date())
    throw new HttpsError('failed-precondition', 'Cannot cancel a booking for a past session.')

  const teamId = (session.teamId || session.teacher) as string
  let teamName = ''
  let teamLanguage = 'en'
  let teamSlug: string | null = null
  let ctaUrl: string | null = null

  const [teamErr, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  if (!teamErr && teamDoc && teamDoc.exists) {
    const team = teamDoc.data()!
    teamName = (team.name as string) || ''
    teamSlug = (team.slug as string) || null
    teamLanguage = (team.language as string) || 'en'
    ctaUrl = (team.settings?.trialBookingCtaUrl as string) || null
  }

  let activityName = 'Session'
  if (session.activityId) {
    const [actErr, actDoc] = await to(
      db
        .collection('activities')
        .doc(session.activityId as string)
        .get()
    )
    if (!actErr && actDoc && actDoc.exists)
      activityName = (actDoc.data()?.name as string) || 'Session'
  }

  // Transaction (not a batch) so a spent lesson credit is refunded atomically
  // with the cancellation. Refund floors at 0 and applies even if the grant has
  // expired meanwhile — the swimmer paid for a lesson they now didn't take.
  await db.runTransaction(async (tx) => {
    let grantRefund: { ref: FirebaseFirestore.DocumentReference; used: number } | null = null
    if (contactId && booking.credit_grant_id && booking.credit_spent) {
      const grantRef = db
        .collection('contacts')
        .doc(contactId)
        .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
        .doc(booking.credit_grant_id as string)
      const grantSnap = await tx.get(grantRef)
      if (grantSnap.exists) {
        grantRefund = { ref: grantRef, used: (grantSnap.data()?.credits_used as number) ?? 0 }
      }
    }
    tx.update(bookingDoc.ref, {
      status: 'cancelled',
      cancelled_at: FieldValue.serverTimestamp(),
    })
    tx.update(db.collection('sessions').doc(sessionId), {
      bio_link_bookings_count: FieldValue.increment(-1),
    })
    if (contactId) {
      tx.update(db.collection('contacts').doc(contactId), {
        pending_bookings_count: FieldValue.increment(-1),
      })
    }
    if (grantRefund) {
      tx.update(grantRefund.ref, { credits_used: Math.max(0, grantRefund.used - 1) })
    }
  })

  const rebookUrl = teamSlug
    ? `${getHostingUrl()}/public/${teamSlug}/booking${session.activityId ? `?activity=${session.activityId}` : ''}`
    : null

  const sessionEnd = (session.end as Timestamp).toDate()
  const dateStr = sessionStart.toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeStr = `${sessionStart.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })} – ${sessionEnd.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`
  const firstname = (booking.firstname as string) || 'Guest'
  const rebookLine = rebookUrl
    ? `<p style="text-align:center;margin-top:24px;">${ctaButton(rebookUrl, 'Book another session')}</p>`
    : ''

  try {
    if (await systemEmailEnabledFor(teamId, 'booking_confirmation')) {
      const { html } = buildEmailTemplate({
        title: 'Booking cancelled',
        body: `<p>Hi ${firstname},</p><p>Your booking for <strong>${activityName}</strong> with ${teamName} on ${dateStr} at ${timeStr} has been cancelled.</p>${rebookLine}`,
      })
      await sendEmail({
        to: booking.email as string,
        teamId,
        subject: `Booking Cancelled – ${activityName}`,
        html,
        text: `Hi ${firstname},\n\nYour booking for ${activityName} with ${teamName} on ${dateStr} at ${timeStr} has been cancelled.\n${rebookUrl ? `Book another session: ${rebookUrl}` : ''}`,
      })
    }
  } catch (err) {
    console.error('Error sending cancellation confirmation email:', err)
  }

  return { success: true, message: 'Your booking has been cancelled.', rebookUrl }
})

// ─────────────────────────────────────────────────────────────────────────────
// getBookingDetails — public, token-based (unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

export const getBookingDetails = onCall(async (request) => {
  const { token } = request.data as { token?: string }
  if (!token) throw new HttpsError('invalid-argument', 'Booking token is required.')

  const db = admin.firestore()

  let bookingsSnapshot = await db
    .collectionGroup('bookings')
    .where('booking_token', '==', token)
    .limit(1)
    .get()
  if (bookingsSnapshot.empty) {
    bookingsSnapshot = await db
      .collectionGroup('participants')
      .where('booking_token', '==', token)
      .limit(1)
      .get()
  }
  if (bookingsSnapshot.empty) {
    throw new HttpsError(
      'not-found',
      'Booking not found. The link may have expired or the booking was cancelled.'
    )
  }

  const bookingDoc = bookingsSnapshot.docs[0]
  const booking = bookingDoc.data()
  const pathParts = bookingDoc.ref.path.split('/')
  const sessionId = pathParts[1]

  const [sessionErr, sessionDoc] = await to(db.collection('sessions').doc(sessionId).get())
  if (sessionErr || !sessionDoc || !sessionDoc.exists) {
    throw new HttpsError('not-found', 'Session no longer exists.')
  }
  const session = sessionDoc.data()!
  const teamId = (session.teamId || session.teacher) as string

  let activityName = 'Session'
  const activityId = (session.activityId as string) || null
  if (activityId) {
    const [actErr, actDoc] = await to(db.collection('activities').doc(activityId).get())
    if (!actErr && actDoc && actDoc.exists)
      activityName = (actDoc.data()?.name as string) || 'Session'
  }

  let teamName = ''
  let teamSlug: string | null = null
  let teamLanguage = 'en'
  const [, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  if (teamDoc && teamDoc.exists) {
    const team = teamDoc.data()!
    teamName = (team.name as string) || ''
    teamSlug = (team.slug as string) || null
    teamLanguage = (team.language as string) || 'en'
  }

  const now = Timestamp.now()
  const futureLimit = new Date()
  futureLimit.setDate(futureLimit.getDate() + 60)

  let availableSessions: Array<{
    id: string
    start: string
    end: string
    location: string | null
  }> = []
  if (activityId) {
    const [, sessSnap] = await to(
      db
        .collection('sessions')
        .where('teamId', '==', teamId)
        .where('activityId', '==', activityId)
        .where('allowBooking', '==', true)
        .where('start', '>=', now)
        .where('start', '<=', Timestamp.fromDate(futureLimit))
        .orderBy('start', 'asc')
        .limit(5)
        .get()
    )
    if (sessSnap) {
      availableSessions = sessSnap.docs
        .filter((d) => {
          const data = d.data()
          if (data.isException && data.exceptionType === 'cancelled') return false
          return d.id !== sessionId
        })
        .map((d) => {
          const data = d.data()
          return {
            id: d.id,
            start: (data.start as Timestamp).toDate().toISOString(),
            end: (data.end as Timestamp).toDate().toISOString(),
            location: (data.location as string) || null,
          }
        })
    }
  }

  const sessionStart = (session.start as Timestamp).toDate()
  const isPastSession = sessionStart < new Date()
  const bookingStatus = (booking.status as string) || 'pending'
  const canCancel = !isPastSession && ['pending', 'no_show'].includes(bookingStatus)
  const canRebook = canCancel && availableSessions.length > 0

  return {
    success: true,
    booking: {
      contactId: booking.contact,
      firstname: booking.firstname,
      lastname: booking.lastname,
      email: booking.email,
      phone: (booking.phone as string) || null,
      status: bookingStatus,
      joinedAt: (booking.joinedAt as Timestamp | undefined)?.toDate().toISOString() || null,
    },
    session: {
      id: sessionId,
      start: sessionStart.toISOString(),
      end: (session.end as Timestamp).toDate().toISOString(),
      location: (session.location as string) || null,
      isPast: isPastSession,
    },
    activity: { id: activityId, name: activityName },
    team: { id: teamId, name: teamName, slug: teamSlug, language: teamLanguage },
    availableSessions,
    canCancel,
    canRebook,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// rebookSession — public, token-based (unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

export const rebookSession = onCall(async (request) => {
  const { token, newSessionId } = request.data as { token?: string; newSessionId?: string }
  if (!token) throw new HttpsError('invalid-argument', 'Booking token is required.')
  if (!newSessionId) throw new HttpsError('invalid-argument', 'New session ID is required.')

  const db = admin.firestore()

  let bookingsSnapshot = await db
    .collectionGroup('bookings')
    .where('booking_token', '==', token)
    .limit(1)
    .get()
  if (bookingsSnapshot.empty) {
    bookingsSnapshot = await db
      .collectionGroup('participants')
      .where('booking_token', '==', token)
      .limit(1)
      .get()
  }
  if (bookingsSnapshot.empty) {
    throw new HttpsError(
      'not-found',
      'Booking not found. The link may have expired or the booking was already cancelled.'
    )
  }

  const bookingDoc = bookingsSnapshot.docs[0]
  const booking = bookingDoc.data()
  const rebookableStatuses = ['pending', 'no_show']
  if (booking.status && !rebookableStatuses.includes(booking.status as string)) {
    throw new HttpsError('failed-precondition', 'This booking can no longer be modified.')
  }

  const pathParts = bookingDoc.ref.path.split('/')
  const oldSessionId = pathParts[1]
  const contactId = booking.contact as string

  if (oldSessionId === newSessionId) {
    throw new HttpsError('invalid-argument', 'You are already booked for this session.')
  }

  const [, oldSessionDoc] = await to(db.collection('sessions').doc(oldSessionId).get())
  if (!oldSessionDoc || !oldSessionDoc.exists)
    throw new HttpsError('not-found', 'Original session no longer exists.')
  const oldSession = oldSessionDoc.data()!
  const teamId = (oldSession.teamId || oldSession.teacher) as string

  const [, newSessionDoc] = await to(db.collection('sessions').doc(newSessionId).get())
  if (!newSessionDoc || !newSessionDoc.exists)
    throw new HttpsError('not-found', 'New session not found.')
  const newSession = newSessionDoc.data()!

  const newTeamId = (newSession.teamId || newSession.teacher) as string
  if (newTeamId !== teamId)
    throw new HttpsError('permission-denied', 'Cannot rebook to a session from a different team.')
  if (!newSession.allowBooking)
    throw new HttpsError('failed-precondition', 'This session is not available for booking.')

  const newSessionStart = (newSession.start as Timestamp).toDate()
  if (newSessionStart < new Date())
    throw new HttpsError('failed-precondition', 'Cannot book a session in the past.')
  if (newSession.isException && newSession.exceptionType === 'cancelled') {
    throw new HttpsError('failed-precondition', 'This session has been cancelled.')
  }

  const [[, existBookDoc], [, existPartDoc]] = await Promise.all([
    to(db.collection('sessions').doc(newSessionId).collection('bookings').doc(contactId).get()),
    to(db.collection('sessions').doc(newSessionId).collection('participants').doc(contactId).get()),
  ])
  if ((existBookDoc && existBookDoc.exists) || (existPartDoc && existPartDoc.exists)) {
    throw new HttpsError('already-exists', 'You already have a booking for this session.')
  }

  const newBookingToken = generateSecureToken()
  const newBookingRef = db
    .collection('sessions')
    .doc(newSessionId)
    .collection('bookings')
    .doc(contactId)
  const batch = db.batch()

  batch.update(bookingDoc.ref, {
    status: 'rebooked',
    rebooked_to: newSessionId,
    rebooked_at: FieldValue.serverTimestamp(),
  })
  batch.update(db.collection('sessions').doc(oldSessionId), {
    bio_link_bookings_count: FieldValue.increment(-1),
  })
  batch.set(newBookingRef, {
    firstname: booking.firstname,
    lastname: booking.lastname,
    email: booking.email,
    phone: (booking.phone as string) || null,
    contact: contactId,
    session: newSessionId,
    teamId,
    joinedAt: FieldValue.serverTimestamp(),
    fromBioLink: true,
    status: 'pending',
    booking_token: newBookingToken,
    rebooked_from: oldSessionId,
    rebooked_at: FieldValue.serverTimestamp(),
  })
  batch.update(db.collection('sessions').doc(newSessionId), {
    has_bookings: true,
    bio_link_bookings_count: FieldValue.increment(1),
    last_booking_at: FieldValue.serverTimestamp(),
  })
  await batch.commit()

  let teamName = ''
  let teamSlug: string | null = null
  const [, teamDoc] = await to(db.collection('teams').doc(teamId).get())
  if (teamDoc && teamDoc.exists) {
    teamName = (teamDoc.data()!.name as string) || ''
    teamSlug = (teamDoc.data()!.slug as string) || null
  }

  let activityName = 'Session'
  if (newSession.activityId) {
    const [, actDoc] = await to(
      db
        .collection('activities')
        .doc(newSession.activityId as string)
        .get()
    )
    if (actDoc && actDoc.exists) activityName = (actDoc.data()?.name as string) || 'Session'
  }

  const manageBookingUrl = teamSlug
    ? `${getHostingUrl()}/public/${teamSlug}/manage-booking?token=${newBookingToken}`
    : null

  const oldSessionStart = (oldSession.start as Timestamp).toDate()
  const newSessionEnd = (newSession.end as Timestamp).toDate()
  const locale = 'en-GB'
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  const firstname = (booking.firstname as string) || 'Guest'
  const oldDateStr = oldSessionStart.toLocaleDateString(locale, dateOpts)
  const newDateStr = newSessionStart.toLocaleDateString(locale, dateOpts)
  const newTimeStr = `${newSessionStart.toLocaleTimeString(locale, timeOpts)} – ${newSessionEnd.toLocaleTimeString(locale, timeOpts)}`
  const locationLine = newSession.location
    ? `<p><strong>Location:</strong> ${newSession.location}</p>`
    : ''
  const manageLink = manageBookingUrl
    ? `<p><a href="${manageBookingUrl}">Manage your booking</a></p>`
    : ''

  try {
    if (await systemEmailEnabledFor(teamId, 'booking_confirmation')) {
      await sendEmail({
        to: booking.email as string,
        teamId,
        subject: `Booking Changed – ${activityName}`,
        html: `<p>Hi ${firstname},</p><p>Your booking for <strong>${activityName}</strong> with ${teamName} has been changed.</p><p><strong>Previous date:</strong> ${oldDateStr}</p><p><strong>New date:</strong> ${newDateStr} at ${newTimeStr}</p>${locationLine}${manageLink}`,
        text: `Hi ${firstname},\n\nYour booking for ${activityName} with ${teamName} has been changed.\nPrevious date: ${oldDateStr}\nNew date: ${newDateStr} at ${newTimeStr}\n${newSession.location ? `Location: ${newSession.location}\n` : ''}${manageBookingUrl ? `Manage your booking: ${manageBookingUrl}` : ''}`,
      })
    }
  } catch (err) {
    console.error('Error sending rebook confirmation email:', err)
  }

  return {
    success: true,
    message: 'Your booking has been changed.',
    newBookingToken,
    newSession: {
      id: newSessionId,
      start: newSessionStart.toISOString(),
      end: newSessionEnd.toISOString(),
    },
    manageBookingUrl,
  }
})
