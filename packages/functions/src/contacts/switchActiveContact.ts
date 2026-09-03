// Ported from hmd-lineup/functions/src/switchActiveContact/index.js
// Allows a student with a valid membership session to switch to a different contact
// that shares the same email address (e.g., a family member's account).
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { buildContactSession, optionalContactSessionFromRequest } from '../utils/contactSession'
import { loadTeamForMemberAppGate, memberAppAccessForPlan } from '../auth/loginContactWithCode'

export const switchActiveContact = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required to switch contacts')

  // Switching profiles is a CONTACT-SESSION feature: the caller must ALREADY hold
  // a live contact session, which is minted only after an email OTP and is what
  // proves control of the shared email. The email check below is not enough on
  // its own — a plain Firebase account whose token merely carries an `email` claim
  // (e.g. an email/password signup registered with a victim's address,
  // email_verified=false) would otherwise pass it and mint a session for the
  // victim's contact. That is the exact takeover the `sharesContactEmail` rule
  // guards against on the read side; this callable mints identity server-side
  // (bypassing rules), so it must apply the same bar. A contact session carries a
  // `contactId` claim, which no ordinary Firebase account has.
  if (!optionalContactSessionFromRequest(request)) {
    throw new HttpsError('permission-denied', 'A contact session is required to switch contacts')
  }

  const rawContactId = typeof request.data?.contactId === 'string' ? request.data.contactId.trim() : ''
  if (!rawContactId) throw new HttpsError('invalid-argument', 'Missing contactId parameter')

  const claimEmailRaw = request.auth.token?.email as string | undefined
  if (!claimEmailRaw || typeof claimEmailRaw !== 'string') {
    throw new HttpsError('permission-denied', 'Current session is not authorized to switch contacts')
  }

  const claimEmail = claimEmailRaw.toLowerCase().trim()

  const contactDoc = await admin.firestore().collection('contacts').doc(rawContactId).get()
  if (!contactDoc.exists) throw new HttpsError('not-found', 'Requested contact not found')

  const contactEmailRaw = contactDoc.get('email') as unknown
  const contactEmail = typeof contactEmailRaw === 'string' ? contactEmailRaw.toLowerCase().trim() : null
  if (!contactEmail || contactEmail !== claimEmail) {
    throw new HttpsError('permission-denied', 'You do not have permission to access this contact')
  }

  const teamId = (contactDoc.get('teamId') as string) || null

  // ── The member-app plan gate (mobile client only) ─────────────────────────
  // The same gate `loginContactWithCode` applies at sign-in: this callable
  // mints a session too, and without it a member signed into an eligible
  // studio could switch into a sibling contact on a Free-plan team the app
  // refused at the door. The web never sends `client`, so it is unaffected.
  // Refused with a member-facing message plus `details.reason` so the app can
  // show it as-is rather than as a generic "failed to switch".
  if (request.data?.client === 'mobile' && teamId) {
    const team = await loadTeamForMemberAppGate(teamId)
    if (!team || !memberAppAccessForPlan(team.plan, team.plan_status)) {
      throw new HttpsError(
        'permission-denied',
        `${team?.name ?? 'This studio'} hasn't added the mobile app to their plan yet.`,
        { reason: 'app_not_included', teamId, teamName: team?.name ?? null, slug: team?.slug ?? null }
      )
    }
  }

  const session = await buildContactSession(rawContactId, teamId, claimEmail, { allowedEmail: claimEmail })

  return {
    customToken: session.customToken,
    sessionExpires: session.sessionExpires,
    contact: session.contact,
  }
})
