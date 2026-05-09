/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { getTeam } from '../utils/teams'
import { sendEmail } from '../utils/email'
import { hashVerificationCode, verifyCode, generateSecureToken } from '../utils/crypto'
import { getHostingUrl } from '../utils/env'
import {
  buildTrialConfirmationEmail,
  buildTeacherNotificationEmail,
  buildVerificationCodeEmail,
} from './templates'

setGlobalOptions({ region: 'europe-west6' })

type Lang = 'en' | 'de' | 'fr' | 'it'
const VALID_LANGS: Lang[] = ['en', 'de', 'fr', 'it']
function isLang(v: unknown): v is Lang {
  return VALID_LANGS.includes(v as Lang)
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
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
  const recentCodes = await admin
    .firestore()
    .collection('booking_verification_codes')
    .where('email', '==', sanitizedEmail)
    .where('team_id', '==', teamId)
    .where('created_at', '>', oneHourAgo)
    .get()

  if (recentCodes.size >= 3) {
    throw new HttpsError('resource-exhausted', 'Too many verification requests. Please try again in an hour.')
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
    return { success: true, hasContacts: false, message: 'No existing profile found. Please use the regular booking form.' }
  }

  const matchedContactIds = contactsSnap.docs.map((d) => d.id)

  // Generate and store code
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
  const codeHash = hashVerificationCode(code, sanitizedEmail)

  const codeRef = await admin.firestore().collection('booking_verification_codes').add({
    email: sanitizedEmail,
    team_id: teamId,
    code_hash: codeHash,
    attempts: 0,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
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
    await sendEmail({ to: sanitizedEmail, subject: subjects[lang], html: emailContent.html, text: emailContent.text })
    console.log(`Booking verification email sent to ${sanitizedEmail}`)
  } catch (err) {
    await codeRef.delete()
    throw new HttpsError('internal', 'Failed to send verification email. Please try again.')
  }

  return { success: true, hasContacts: true, codeId: codeRef.id, expiresAt: expiresAt.toMillis(), contactsCount: matchedContactIds.length }
})

// ─────────────────────────────────────────────────────────────────────────────
// verifyBookingCode
// ─────────────────────────────────────────────────────────────────────────────

export const verifyBookingCode = onCall(async (request) => {
  const data = request.data as { codeId?: string; code?: string; selectedContactId?: string }

  if (!data?.codeId) throw new HttpsError('invalid-argument', 'codeId is required')
  if (!data.code && !data.selectedContactId) throw new HttpsError('invalid-argument', 'code or selectedContactId is required')

  if (data.code && !/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  const codeRef = admin.firestore().collection('booking_verification_codes').doc(data.codeId)
  const codeDoc = await codeRef.get()
  if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid verification code')

  const codeData = codeDoc.data()!

  if (codeData.used) throw new HttpsError('failed-precondition', 'This verification code has already been used.')

  const now = admin.firestore.Timestamp.now()
  if (codeData.expires_at.toMillis() < now.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new code.')
  }

  if (codeData.attempts >= 5) {
    throw new HttpsError('resource-exhausted', 'Too many failed attempts. Please request a new code.')
  }

  const matchedContactIds: string[] = codeData.matched_contact_ids || []

  // Handle contact selection after already verified
  if (codeData.verified && data.selectedContactId) {
    if (!matchedContactIds.includes(data.selectedContactId)) {
      throw new HttpsError('invalid-argument', 'Selected contact not found in matched contacts')
    }
    const contactDoc = await admin.firestore().collection('contacts').doc(data.selectedContactId).get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Selected contact no longer exists')
    const c = contactDoc.data()!
    return { verified: true, codeId: data.codeId, selectedContactId: data.selectedContactId, contactData: { id: contactDoc.id, firstname: c.firstname || '', lastname: c.lastname || '', email: c.email || '', phone: c.phone || '' }, requiresContactSelection: false }
  }

  // Verify the code
  if (data.code) {
    const isValid = codeData.code_hash ? verifyCode(data.code, codeData.email, codeData.code_hash) : false

    if (!isValid) {
      await codeRef.update({ attempts: admin.firestore.FieldValue.increment(1) })
      const remaining = 5 - (codeData.attempts + 1)
      throw new HttpsError('invalid-argument', `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`)
    }

    await codeRef.update({ verified: true, verified_at: admin.firestore.FieldValue.serverTimestamp() })
  }

  // Fetch matched contacts
  const contacts = await Promise.all(
    matchedContactIds.map(async (id) => {
      const d = await admin.firestore().collection('contacts').doc(id).get()
      if (!d.exists) return null
      const c = d.data()!
      return { id: d.id, firstname: c.firstname || '', lastname: c.lastname || '', phone: c.phone || '' }
    }),
  ).then((r) => r.filter(Boolean) as { id: string; firstname: string; lastname: string; phone: string }[])

  // Auto-select if single contact
  if (contacts.length === 1) {
    const single = contacts[0]
    const contactDoc = await admin.firestore().collection('contacts').doc(single.id).get()
    const c = contactDoc.data()!
    return { verified: true, codeId: data.codeId, selectedContactId: single.id, contactData: { id: contactDoc.id, firstname: c.firstname || '', lastname: c.lastname || '', email: c.email || '', phone: c.phone || '' }, requiresContactSelection: false }
  }

  return { verified: true, codeId: data.codeId, matchedContacts: contacts, requiresContactSelection: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// bookTrialSession
// ─────────────────────────────────────────────────────────────────────────────

export const bookTrialSession = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    sessionId?: string
    contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
    authenticatedContactId?: string
    verificationCodeId?: string
  }

  if (!data?.teamId || !data?.sessionId) {
    throw new HttpsError('invalid-argument', 'teamId and sessionId are required')
  }

  const isAuthenticatedBooking = !!data.authenticatedContactId

  // Rate limit: 10 bookings per hour per session
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000)
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

  // Resolve authenticated contact
  let authenticatedContact: admin.firestore.DocumentData & { id: string } | null = null

  if (data.authenticatedContactId) {
    // Validate verification code
    if (data.verificationCodeId) {
      const codeDoc = await admin.firestore().collection('booking_verification_codes').doc(data.verificationCodeId).get()
      if (!codeDoc.exists) throw new HttpsError('invalid-argument', 'Invalid verification code')
      const codeData = codeDoc.data()!
      if (!codeData.verified) throw new HttpsError('failed-precondition', 'Verification code not verified')
      if (codeData.team_id !== data.teamId) throw new HttpsError('permission-denied', 'Code does not match team')
      const isValid = (codeData.matched_contact_ids || []).includes(data.authenticatedContactId)
      if (!isValid) throw new HttpsError('permission-denied', 'Contact not found in verified matches')
      await admin.firestore().collection('booking_verification_codes').doc(data.verificationCodeId).update({
        used: true,
        used_at: admin.firestore.FieldValue.serverTimestamp(),
        used_for_session: data.sessionId,
        used_contact_id: data.authenticatedContactId,
      })
    }

    const contactDoc = await admin.firestore().collection('contacts').doc(data.authenticatedContactId).get()
    if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
    const contactData = contactDoc.data()!
    if (contactData.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Contact does not belong to this team')
    authenticatedContact = { id: data.authenticatedContactId, ...contactData }
  }

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
    if (!data.contactDetails) throw new HttpsError('invalid-argument', 'contactDetails required for new bookings')
    const { firstname, lastname, email, phone } = data.contactDetails
    if (!firstname || !lastname || !email) throw new HttpsError('invalid-argument', 'firstname, lastname, email required')
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) throw new HttpsError('invalid-argument', 'Invalid email format')
    sanitized = { firstname: firstname.trim(), lastname: lastname.trim(), email: email.toLowerCase().trim(), phone: phone?.trim() || null }
  }

  // Validate team and get owner email
  const team = await getTeam(data.teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  const lang: Lang = isLang(team.language) ? team.language : 'en'
  const teamName: string = team.name || 'Our Team'

  let ownerEmail: string | null = null
  let ownerFirstname = 'Team'
  const ownersSnap = await admin.firestore().collection('teams').doc(data.teamId).collection('team_members').where('role', '==', 'owner').limit(1).get()
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

  if (sessionData.teamId !== data.teamId) throw new HttpsError('permission-denied', 'Session does not belong to this team')
  if (!sessionData.allowBooking) throw new HttpsError('permission-denied', 'Bookings are not allowed for this session')

  const now = admin.firestore.Timestamp.now()
  if (sessionData.start.toMillis() < now.toMillis()) {
    throw new HttpsError('failed-precondition', 'Cannot book sessions in the past')
  }

  // Get activity name
  let activityName = 'Session'
  if (sessionData.activityId) {
    try {
      const actDoc = await admin.firestore().collection('activities').doc(sessionData.activityId).get()
      if (actDoc.exists) activityName = actDoc.data()!.name || 'Session'
    } catch (_) { /* non-fatal */ }
  }

  // Resolve or create contact
  let contactId: string
  let isNewContact = false

  if (authenticatedContact) {
    contactId = authenticatedContact.id
    // Check for duplicate booking
    const [existingBooking, existingParticipant] = await Promise.all([
      admin.firestore().collection('sessions').doc(data.sessionId).collection('bookings').doc(contactId).get(),
      admin.firestore().collection('sessions').doc(data.sessionId).collection('participants').doc(contactId).get(),
    ])
    if (existingBooking.exists || existingParticipant.exists) {
      throw new HttpsError('already-exists', 'You are already registered for this session')
    }
  } else {
    // Find existing contact by email + name
    const existingSnap = await admin.firestore().collection('contacts').where('teamId', '==', data.teamId).where('email', '==', sanitized.email).get()
    const exactMatch = existingSnap.docs.find((d) => {
      const c = d.data()
      return c.firstname?.toLowerCase().trim() === sanitized.firstname.toLowerCase() && c.lastname?.toLowerCase().trim() === sanitized.lastname.toLowerCase()
    })

    if (exactMatch) {
      contactId = exactMatch.id
      const [existingBooking, existingParticipant] = await Promise.all([
        admin.firestore().collection('sessions').doc(data.sessionId).collection('bookings').doc(contactId).get(),
        admin.firestore().collection('sessions').doc(data.sessionId).collection('participants').doc(contactId).get(),
      ])
      if (existingBooking.exists || existingParticipant.exists) {
        throw new HttpsError('already-exists', 'You are already registered for this session')
      }
    } else {
      isNewContact = true
      const newContactRef = admin.firestore().collection('contacts').doc()
      await newContactRef.set({
        firstname: sanitized.firstname,
        lastname: sanitized.lastname,
        email: sanitized.email,
        phone: sanitized.phone,
        type: 'trial',
        teamId: data.teamId,
        membership_status: 'guest',
        membership_active: false,
        archived_at: null,
        deleted_at: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        pending_bookings_count: 1,
      })
      contactId = newContactRef.id
      console.log(`New trial contact created: ${contactId}`)
    }
  }

  // Add booking to session
  const bookingToken = generateSecureToken()
  const teamSlug: string | null = team.slug || null
  const manageBookingUrl = teamSlug ? `${getHostingUrl()}/portal/${teamSlug}/manage-booking?token=${bookingToken}` : null

  await admin.firestore().collection('sessions').doc(data.sessionId).collection('bookings').doc(contactId).set({
    firstname: sanitized.firstname,
    lastname: sanitized.lastname,
    email: sanitized.email,
    phone: sanitized.phone,
    contact: contactId,
    session: data.sessionId,
    teamId: data.teamId,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    fromPortal: true,
    is_new_contact: isNewContact,
    booking_token: bookingToken,
    authenticated_booking: isAuthenticatedBooking,
  })

  await admin.firestore().collection('sessions').doc(data.sessionId).set(
    { has_bookings: true, portal_bookings_count: admin.firestore.FieldValue.increment(1), last_booking_at: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  )

  if (!isNewContact) {
    await admin.firestore().collection('contacts').doc(contactId).update({ pending_bookings_count: admin.firestore.FieldValue.increment(1) })
  }

  // Send confirmation email
  const sessionStart: Date = sessionData.start.toDate()
  const sessionEnd: Date = sessionData.end.toDate()

  try {
    const confirmEmail = buildTrialConfirmationEmail({ firstname: sanitized.firstname, teamName, activityName, sessionStart, sessionEnd, locationName: sessionData.location || null, manageBookingUrl, lang })
    const subjects: Record<Lang, string> = { en: `Booking Confirmed – ${activityName}`, de: `Buchung bestätigt – ${activityName}`, fr: `Réservation confirmée – ${activityName}`, it: `Prenotazione confermata – ${activityName}` }
    await sendEmail({ to: sanitized.email, subject: subjects[lang], html: confirmEmail.html, text: confirmEmail.text })
    console.log(`Confirmation email sent to ${sanitized.email}`)
  } catch (err) {
    console.error('Error sending confirmation email:', err)
  }

  // Send notification to owner
  if (ownerEmail) {
    try {
      const notifEmail = buildTeacherNotificationEmail({ teamOwnerFirstname: ownerFirstname, contactName: `${sanitized.firstname} ${sanitized.lastname}`, contactEmail: sanitized.email, contactPhone: sanitized.phone, activityName, sessionStart, sessionEnd, lang })
      const subjects: Record<Lang, string> = { en: `New Booking: ${sanitized.firstname} ${sanitized.lastname}`, de: `Neue Buchung: ${sanitized.firstname} ${sanitized.lastname}`, fr: `Nouvelle réservation : ${sanitized.firstname} ${sanitized.lastname}`, it: `Nuova prenotazione: ${sanitized.firstname} ${sanitized.lastname}` }
      await sendEmail({ to: ownerEmail, subject: subjects[lang], html: notifEmail.html, text: notifEmail.text })
      console.log(`Owner notification sent to ${ownerEmail}`)
    } catch (err) {
      console.error('Error sending owner notification:', err)
    }
  }

  return {
    success: true,
    contactId,
    sessionId: data.sessionId,
    isNewContact,
    isAuthenticatedBooking,
    sessionDetails: { activityName, start: sessionStart.toISOString(), end: sessionEnd.toISOString() },
  }
})
