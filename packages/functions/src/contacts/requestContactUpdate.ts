// Ported from hmd-lineup/functions/src/requestContactUpdate/index.js
// Creates a contact data update request. Supports three auth modes:
//   1. authToken      — from the student app (membership token)
//   2. contact session — the passwordless contact session (web Space portal /
//                        mobile), identified by the custom-token claims
//   3. codeId         — from the bio-link email-verification flow
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

const CONTACT_REQUESTS_SUBCOLLECTION = 'contact_requests'

export const requestContactUpdate = onCall(async (request) => {
  const { codeId, authToken, contactDetails, note } = request.data as {
    codeId?: string
    authToken?: string
    contactId?: string
    teamId?: string
    contactDetails: Record<string, unknown>
    note?: string
  }

  // Contact-session claims, minted by buildContactSession: { contactId, teamId,
  // sessionExpires (epoch ms) }. Present when an authenticated portal contact calls.
  const sessionContactId = request.auth?.token?.contactId as string | undefined
  const sessionTeamId = request.auth?.token?.teamId as string | undefined
  const sessionExpires = request.auth?.token?.sessionExpires as number | undefined

  if (!codeId && !authToken && !sessionContactId)
    throw new HttpsError(
      'invalid-argument',
      'Missing required field: codeId, authToken, or a contact session'
    )
  if (!contactDetails)
    throw new HttpsError('invalid-argument', 'Missing required field: contactDetails')

  const firstname = (contactDetails.firstname as string)?.trim()
  const lastname = (contactDetails.lastname as string)?.trim()
  if (!firstname || !lastname)
    throw new HttpsError('invalid-argument', 'First name and last name are required')

  let contactId: string = request.data.contactId ?? ''
  let teamId: string = request.data.teamId ?? ''

  const db = admin.firestore()
  let tokenRef: admin.firestore.DocumentReference | null = null
  let codeRef: admin.firestore.DocumentReference | null = null

  if (authToken) {
    // ── Token-based auth (student app) ───────────────────────────────────────
    const tokenDoc = await db.collection('auth_tokens').doc(authToken).get()
    if (!tokenDoc.exists) throw new HttpsError('not-found', 'Invalid or expired token')

    const tokenData = tokenDoc.data()!
    if (tokenData.type !== 'signup')
      throw new HttpsError('permission-denied', 'Token is not a signup token')
    if ((tokenData.expires_at as Timestamp).toMillis() < Timestamp.now().toMillis())
      throw new HttpsError('deadline-exceeded', 'Token has expired')
    if (tokenData.used) throw new HttpsError('failed-precondition', 'Token has already been used')
    if (request.data.teamId && tokenData.team_id !== request.data.teamId)
      throw new HttpsError('permission-denied', 'Token does not match the requested team')

    contactId = tokenData.contact_id as string
    teamId = tokenData.team_id as string
    tokenRef = tokenDoc.ref
    console.log(`Token-based contact update request from contact ${contactId} for team ${teamId}`)
  } else if (sessionContactId) {
    // ── Contact-session auth (web Space portal / mobile) ────────────────────────
    // Trust the custom-token claims (minted server-side after email verification);
    // refuse a session past its 7-day window.
    if (!sessionTeamId)
      throw new HttpsError('permission-denied', 'Contact session is missing a team')
    if (typeof sessionExpires === 'number' && sessionExpires < Date.now())
      throw new HttpsError('deadline-exceeded', 'Contact session has expired. Please sign in again.')
    contactId = sessionContactId
    teamId = sessionTeamId
    console.log(`Session-based contact update request from contact ${contactId} for team ${teamId}`)
  } else {
    // ── Code-based auth (bio-link email verification) ───────────────────────────
    if (!contactId) throw new HttpsError('invalid-argument', 'Missing required field: contactId')
    if (!teamId) throw new HttpsError('invalid-argument', 'Missing required field: teamId')

    codeRef = db.collection('verification_codes').doc(codeId!)
    const codeDoc = await codeRef.get()
    if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid verification code')

    const codeData = codeDoc.data()!
    if (!codeData.verified)
      throw new HttpsError(
        'failed-precondition',
        'Email not verified. Please verify your email first.'
      )
    if (codeData.used)
      throw new HttpsError('already-exists', 'This verification code has already been used')

    const verifiedAt = codeData.verifiedAt as Timestamp
    const thirtyMinutesAgo = Timestamp.fromMillis(Date.now() - 30 * 60 * 1000)
    if (verifiedAt.toMillis() < thirtyMinutesAgo.toMillis())
      throw new HttpsError('deadline-exceeded', 'Verification expired. Please start over.')

    console.log(`Code-based contact update request from contact ${contactId} for team ${teamId}`)
  }

  // ── Validate contact ────────────────────────────────────────────────────────
  const contactRef = db.collection('contacts').doc(contactId)
  const contactDoc = await contactRef.get()
  if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')
  if ((contactDoc.data()!.teamId as string) !== teamId)
    throw new HttpsError('permission-denied', 'Contact does not belong to this team')

  // ── Duplicate check ─────────────────────────────────────────────────────────
  const existingSnap = await db
    .collection('teams')
    .doc(teamId)
    .collection(CONTACT_REQUESTS_SUBCOLLECTION)
    .where('contact_id', '==', contactId)
    .where('status', '==', 'pending')
    .limit(1)
    .get()
  if (!existingSnap.empty)
    throw new HttpsError(
      'already-exists',
      'A pending update request already exists for this contact'
    )

  // ── Sanitize submitted data ─────────────────────────────────────────────────
  const sanitizedData: Record<string, unknown> = {
    firstname,
    lastname,
    phone: ((contactDetails.phone as string) ?? '').trim(),
    birthdate: contactDetails.birthdate
      ? Timestamp.fromDate(new Date(contactDetails.birthdate as string))
      : null,
    gender: (contactDetails.gender as string) || '',
    birthplace: ((contactDetails.birthplace as string) ?? '').trim(),
    residence: (contactDetails.residence as unknown) ?? null,
    emergencyContact: contactDetails.emergencyContact
      ? {
          name: ((contactDetails.emergencyContact as Record<string, string>).name ?? '').trim(),
          phone: ((contactDetails.emergencyContact as Record<string, string>).phone ?? '').trim(),
        }
      : null,
    notes: ((contactDetails.notes as string) ?? '').trim(),
  }

  // ── Create request ──────────────────────────────────────────────────────────
  const requestRef = db
    .collection('teams')
    .doc(teamId)
    .collection(CONTACT_REQUESTS_SUBCOLLECTION)
    .doc()
  const contactData = contactDoc.data()!
  const contactName =
    `${(contactData.firstname as string) || ''} ${(contactData.lastname as string) || ''}`.trim()
  const contactEmail = (contactData.email as string) || ''

  await requestRef.set({
    contact_id: contactId,
    contact_name: contactName,
    contact_email: contactEmail,
    team_id: teamId,
    request_type: 'data_update',
    submitted_data: sanitizedData,
    note: (note ?? '').trim(),
    status: 'pending',
    requested_at: FieldValue.serverTimestamp(),
  })

  console.log(`Contact update request created: ${requestRef.id} for contact ${contactId}`)

  // ── Team alert ──────────────────────────────────────────────────────────────
  try {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('team_alerts')
      .doc()
      .set({
        teamId,
        message: `Contact update request from ${contactName}`,
        schedule: { type: 'datetime', value: Timestamp.now() },
        alert_type: 'contact_request',
        request_id: requestRef.id,
        contact_id: contactId,
        contact_name: contactName,
        created_at: FieldValue.serverTimestamp(),
        archived_at: null,
      })
  } catch (alertErr) {
    console.error('Failed to create team alert for contact request', alertErr)
  }

  // ── Mark auth as used ───────────────────────────────────────────────────────
  if (tokenRef) {
    await tokenRef.update({
      used: true,
      used_at: FieldValue.serverTimestamp(),
      used_for_request: requestRef.id,
    })
  }
  if (codeRef) {
    await codeRef.update({ used: true, usedAt: FieldValue.serverTimestamp(), contactId })
  }

  return { success: true, requestId: requestRef.id }
})
