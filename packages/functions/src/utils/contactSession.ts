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

interface ContactSessionOptions {
  allowedEmail?: string
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
    const allowedEmail = options.allowedEmail.toLowerCase().trim()
    // The authenticated email must be the contact's PRIMARY email or one of its
    // login-email allow-list entries (e.g. a parent signing in to a child's profile).
    const loginEmails = Array.isArray(contactData.login_emails)
      ? (contactData.login_emails as unknown[]).map((e) => String(e).toLowerCase().trim())
      : []
    if (contactEmail !== allowedEmail && !loginEmails.includes(allowedEmail)) {
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
