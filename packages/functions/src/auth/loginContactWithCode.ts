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
import { APP_CHECK_ENFORCE_MOBILE, monitorAppCheck } from '../utils/appCheck'
import { assertVerifiableCodeById } from './verificationCode'

// Provisional shop registrations purge after this window unless a payment confirms
// them (see Contact.provisional + dailyTasks/purgeProvisionalContacts).
const PROVISIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Anti-flooding: at most this many NEW shop registrations per team per day.
const REGISTRATIONS_PER_TEAM_PER_DAY = 20

export const loginContactWithCode = onCall({ enforceAppCheck: APP_CHECK_ENFORCE_MOBILE }, async (request) => {
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
  const teamId: string | null =
    typeof codeData.team_id === 'string' && codeData.team_id.length > 0
      ? codeData.team_id
      : null

  // Match contacts whose PRIMARY email is this address, OR whose login-email
  // allow-list contains it (e.g. a parent signing in to a child's profile).
  // When teamId is known, scope the primary query to that team. When it's null
  // (mobile app flow — no team selected upfront), query by email across all
  // teams and optionally narrow to the teamIds stored on the code doc.
  const primaryQuery = teamId
    ? admin.firestore().collection('contacts').where('email', '==', email).where('teamId', '==', teamId).get()
    : admin.firestore().collection('contacts').where('email', '==', email).get()

  const [primarySnap, allowSnap] = await Promise.all([
    primaryQuery,
    admin
      .firestore()
      .collection('contacts')
      .where('login_emails', 'array-contains', email)
      .get(),
  ])

  // Dedupe by doc id; keep only active (non-archived, non-deleted) contacts.
  // When teamId is set, restrict to that team; otherwise accept all teams
  // (optionally narrowed by the code doc's teamIds list).
  const allowedTeamIds: string[] | null =
    !teamId && Array.isArray(codeData.teamIds) && codeData.teamIds.length > 0
      ? codeData.teamIds
      : null

  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>()
  for (const doc of [...primarySnap.docs, ...allowSnap.docs]) {
    const d = doc.data()
    if (teamId && d.teamId !== teamId) continue
    if (allowedTeamIds && !allowedTeamIds.includes(d.teamId)) continue
    if (d.archived_at != null || d.deleted_at != null) continue
    byId.set(doc.id, doc)
  }
  const activeContacts = [...byId.values()]

  if (activeContacts.length === 0) {
    const firstname = (data.newContact?.firstname ?? '').trim().slice(0, 100)
    const lastname = (data.newContact?.lastname ?? '').trim().slice(0, 100)
    if (!data.newContact || !firstname || !lastname || !teamId) {
      // No registration payload (or no team context) → the client shows the
      // register / signup step. Shop registration requires a known teamId.
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
  let chosen: admin.firestore.QueryDocumentSnapshot
  if (data.selectedContactId) {
    const found = activeContacts.find((doc) => doc.id === data.selectedContactId)
    if (!found) {
      throw new HttpsError(
        'permission-denied',
        'The selected contact does not match any active contact for this email and team'
      )
    }
    chosen = found
  } else {
    chosen = activeContacts[0]
  }

  const contactTeamId: string = chosen.data().teamId
  const session = await buildContactSession(chosen.id, contactTeamId, email, { allowedEmail: email })

  return {
    customToken: session.customToken,
    sessionExpires: session.sessionExpires,
    contact: session.contact,
  }
})
