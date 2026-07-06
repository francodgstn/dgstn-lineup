// Logs an existing contact in using a previously-issued email verification code —
// or, for the login-first shop checkout, REGISTERS a minimal new contact when the
// verified email matches none (optional `newContact`; see below). completeSignup
// remains the FULL signup flow (profile + consent).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { CONTACTS_COLLECTION, TEAMS_COLLECTION, type SaasPlan } from '@linyup/shared'
import { buildContactSession } from '../utils/contactSession'
import { canCreateContact } from '../utils/contactCap'
import { bucketRateLimit } from '../utils/rateLimit'
import { APP_CHECK_ENFORCE, monitorAppCheck } from '../utils/appCheck'
import { assertVerifiableCodeById } from './verificationCode'

// Provisional shop registrations purge after this window unless a payment confirms
// them (see Contact.provisional + dailyTasks/purgeProvisionalContacts).
const PROVISIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Anti-flooding: at most this many NEW shop registrations per team per day.
const REGISTRATIONS_PER_TEAM_PER_DAY = 20

export const loginContactWithCode = onCall({ enforceAppCheck: APP_CHECK_ENFORCE }, async (request) => {
  monitorAppCheck(request, 'loginContactWithCode')
  const data = request.data as {
    codeId?: string
    code?: string
    selectedContactId?: string
    // Login-first shop registration: when the verified email matches NO contact,
    // create a minimal provisional one with these names and log it in. Ignored
    // whenever matches exist (a stolen code must not inject duplicates).
    newContact?: { firstname?: string; lastname?: string }
  }

  if (!data?.codeId || !data?.code) {
    throw new HttpsError('invalid-argument', 'codeId and code are required')
  }

  if (!/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  // Validate and mark the code as verified
  const codeData = await assertVerifiableCodeById(data.codeId, data.code)

  const email: string = (codeData.email as string).toLowerCase().trim()
  const teamId: string = codeData.team_id as string

  // Match contacts whose PRIMARY email is this address, OR whose login-email
  // allow-list contains it (e.g. a parent signing in to a child's profile). Two
  // queries merged by id: the primary lookup (email + teamId), and an
  // array-contains on `login_emails` (single-field index — filter teamId in
  // memory to avoid a composite index, per the index gotcha).
  const [primarySnap, allowSnap] = await Promise.all([
    admin
      .firestore()
      .collection('contacts')
      .where('email', '==', email)
      .where('teamId', '==', teamId)
      .get(),
    admin
      .firestore()
      .collection('contacts')
      .where('login_emails', 'array-contains', email)
      .get(),
  ])

  // Dedupe by doc id; keep only this team's active (non-archived, non-deleted) contacts.
  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>()
  for (const doc of [...primarySnap.docs, ...allowSnap.docs]) {
    const d = doc.data()
    if (d.teamId !== teamId) continue
    if (d.archived_at != null || d.deleted_at != null) continue
    byId.set(doc.id, doc)
  }
  const activeContacts = [...byId.values()]

  if (activeContacts.length === 0) {
    const firstname = (data.newContact?.firstname ?? '').trim().slice(0, 100)
    const lastname = (data.newContact?.lastname ?? '').trim().slice(0, 100)
    if (!data.newContact || !firstname || !lastname) {
      // No registration payload → the client shows the register (or signup) step.
      return { requiresSignup: true, email }
    }

    // ── Login-first shop registration ────────────────────────────────────────
    // The OTP proved ownership of `email`; create a minimal PROVISIONAL contact
    // (confirmed by the first successful payment, purged after 7 days otherwise)
    // and mint a session. Guards: per-team daily budget + the plan's hard cap
    // (measured against CONFIRMED actives — see utils/contactCap.ts).
    await bucketRateLimit({
      collection: 'shop_registration_attempts',
      key: teamId,
      limit: REGISTRATIONS_PER_TEAM_PER_DAY,
      windowMs: 24 * 60 * 60 * 1000,
      message: 'Registration is temporarily unavailable. Please contact the studio directly.',
    })

    const teamSnap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found')
    const plan = (teamSnap.data()?.plan as SaasPlan | undefined) ?? 'free'
    if (!(await canCreateContact(teamId, plan))) {
      throw new HttpsError(
        'failed-precondition',
        'This studio cannot accept new registrations right now. Please contact the studio directly.',
        { reason: 'contact_cap' }
      )
    }

    const ref = admin.firestore().collection(CONTACTS_COLLECTION).doc()
    await ref.set({
      teamId,
      email,
      firstname,
      lastname,
      // Off-funnel entry: a shop registration is not a trial-funnel milestone —
      // no acquisition_stage (same birth facts as the webhook's shop creation).
      entry: 'shop',
      provisional: true,
      provisional_expires_at: Timestamp.fromMillis(Date.now() + PROVISIONAL_TTL_MS),
      archived_at: null,
      deleted_at: null,
      created_at: FieldValue.serverTimestamp(),
    })
    console.log(`[auth] shop registration: created provisional contact ${ref.id} (team=${teamId})`) // eslint-disable-line no-console

    const session = await buildContactSession(ref.id, teamId, email, { allowedEmail: email })
    return {
      customToken: session.customToken,
      sessionExpires: session.sessionExpires,
      contact: session.contact,
    }
  }

  if (activeContacts.length > 1 && !data.selectedContactId) {
    return {
      requiresContactSelection: true,
      email,
      matchedContacts: activeContacts.map((doc) => ({
        id: doc.id,
        firstname: doc.data().firstname ?? null,
        lastname: doc.data().lastname ?? null,
      })),
    }
  }

  // Determine which contact to log in as
  let contactId: string
  if (data.selectedContactId) {
    const found = activeContacts.find((doc) => doc.id === data.selectedContactId)
    if (!found) {
      throw new HttpsError(
        'permission-denied',
        'The selected contact does not match any active contact for this email and team'
      )
    }
    contactId = found.id
  } else {
    contactId = activeContacts[0].id
  }

  const session = await buildContactSession(contactId, teamId, email, { allowedEmail: email })

  return {
    customToken: session.customToken,
    sessionExpires: session.sessionExpires,
    contact: session.contact,
  }
})
