// Ported from hmd-lineup/functions/src/switchActiveContact/index.js
// Allows a student with a valid membership session to switch to a different contact
// that shares the same email address (e.g., a family member's account).
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { buildContactSession } from '../utils/contactSession'

export const switchActiveContact = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required to switch contacts')

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
  const session = await buildContactSession(rawContactId, teamId, claimEmail, { allowedEmail: claimEmail })

  return {
    customToken: session.customToken,
    sessionExpires: session.sessionExpires,
    contact: session.contact,
  }
})
