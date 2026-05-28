// Ported from hmd-lineup/functions/src/utils/contactSession.js
import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'

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
    if (contactEmail !== allowedEmail) {
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
