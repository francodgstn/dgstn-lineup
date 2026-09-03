// Ported from hmd-lineup/functions/src/utils/contactSession.js
import * as admin from 'firebase-admin'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

/**
 * Resolve the caller's contact identity from their verified contact-session
 * custom token (the token minted by buildContactSession). Returns the claimed
 * { contactId, teamId } only when the session is present and not expired, else
 * null (anonymous/guest callers fall through to email-based linking).
 *
 * SECURITY: this is the ONLY trustworthy source of a caller's contactId on a
 * public callable — never accept a contactId from the request body, which lets
 * a caller act as (and enumerate) arbitrary contacts.
 */
export function optionalContactSessionFromRequest(
  request: CallableRequest<unknown>
): { contactId: string; teamId: string } | null {
  const contactId = request.auth?.token?.contactId as string | undefined
  const teamId = request.auth?.token?.teamId as string | undefined
  const sessionExpires = request.auth?.token?.sessionExpires as number | undefined
  if (!contactId || !teamId) return null
  if (typeof sessionExpires === 'number' && sessionExpires < Date.now()) return null
  return { contactId, teamId }
}

/**
 * REQUIRE a live contact session for a specific team — the login-first checkout
 * gate. On top of the claim checks (optionalContactSessionFromRequest), re-reads
 * the contact doc: a 7-day token must not outlive the contact's deletion/archival
 * or a team move. Error split lets clients react correctly:
 *   • 'unauthenticated'   → no/expired session → open the sign-in flow
 *   • 'permission-denied' → session is for another team / an inactive contact
 * Returns the session identity plus the token's email claim (the address the
 * buyer actually authenticated with — used e.g. as the Stripe receipt email).
 */
export async function requireContactSessionForTeam(
  request: CallableRequest<unknown>,
  teamId: string
): Promise<{ contactId: string; teamId: string; email: string | null }> {
  const session = optionalContactSessionFromRequest(request)
  if (!session) {
    throw new HttpsError('unauthenticated', 'Sign in to continue')
  }
  if (session.teamId !== teamId) {
    throw new HttpsError('permission-denied', 'Session does not belong to this team')
  }
  const snap = await admin.firestore().collection('contacts').doc(session.contactId).get()
  const c = snap.data()
  if (!snap.exists || c?.teamId !== teamId || c?.archived_at != null || c?.deleted_at != null) {
    throw new HttpsError('permission-denied', 'This account is no longer active')
  }
  const tokenEmail = request.auth?.token?.email as string | undefined
  return {
    contactId: session.contactId,
    teamId,
    email: tokenEmail ?? ((c?.email as string | undefined) ?? null),
  }
}

interface ContactSessionOptions {
  allowedEmail?: string
}

/**
 * THE ONE answer to "may this email sign in as this contact?": the address is
 * the contact's PRIMARY email, or one of its `login_emails` (a parent signing
 * in to a child's profile, a shared family address). Case- and
 * whitespace-insensitive on both sides.
 *
 * Read by `buildContactSession` (every session mint) and by
 * `switchActiveContact` (a signed-in member moving to a sibling contact) —
 * which used to check the primary email ONLY, so a parent who had signed in
 * through `login_emails` could see both children in the picker and switch to
 * neither. Never add a third copy of this rule.
 */
export function contactAcceptsLoginEmail(
  contactData: { email?: unknown; login_emails?: unknown },
  email: string | null | undefined
): boolean {
  if (typeof email !== 'string') return false
  const wanted = email.toLowerCase().trim()
  if (!wanted) return false
  const primary = typeof contactData.email === 'string' ? contactData.email.toLowerCase().trim() : null
  if (primary === wanted) return true
  const loginEmails = Array.isArray(contactData.login_emails) ? contactData.login_emails : []
  return loginEmails.some((e) => typeof e === 'string' && e.toLowerCase().trim() === wanted)
}

interface ContactSession {
  customToken: string
  sessionExpires: number
  contact: Record<string, unknown>
}

/**
 * Builds a Firebase custom token session for a student contact.
 * The token embeds contactId, teamId, and sessionExpires claims.
 */
export async function buildContactSession(
  contactId: string,
  fallbackTeamId: string | null,
  fallbackEmail: string | null,
  options: ContactSessionOptions = {}
): Promise<ContactSession> {
  const contactRef = admin.firestore().collection('contacts').doc(contactId)
  const contactDoc = await contactRef.get()

  if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found for verification')

  const contactData = contactDoc.data()!
  const teamId = (contactData.teamId ?? contactData.teacher ?? fallbackTeamId ?? null) as string | null
  const contactEmailRaw = (contactData.email ?? fallbackEmail ?? null) as string | null
  const contactEmail = typeof contactEmailRaw === 'string' ? contactEmailRaw.toLowerCase().trim() : null

  if (options.allowedEmail) {
    // The authenticated email must be the contact's PRIMARY email or one of its
    // login-email allow-list entries — `contactAcceptsLoginEmail`, the one rule.
    if (!contactAcceptsLoginEmail({ email: contactEmail, login_emails: contactData.login_emails }, options.allowedEmail)) {
      throw new HttpsError('permission-denied', 'Contact email does not match the authenticated session email')
    }
  }

  // Session expires in 7 days
  const sessionExpires = Date.now() + 7 * 24 * 60 * 60 * 1000

  const customTokenClaims: Record<string, unknown> = { contactId, teamId, sessionExpires }
  if (contactEmail) customTokenClaims.email = contactEmail

  console.log('buildContactSession called', { projectId: admin.app().options.projectId, contactId, teamId, contactEmail })

  const customToken = await admin.auth().createCustomToken(`contact:${contactId}`, customTokenClaims)

  return {
    customToken,
    sessionExpires,
    contact: { id: contactDoc.id, ...contactData, email: contactEmail ?? contactData.email ?? null },
  }
}
