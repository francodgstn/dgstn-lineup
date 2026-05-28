// Ported from hmd-lineup/functions/src/getMembershipQR/index.js
// Student callable (membership auth token with contactId claim) — returns the QR hash
// for the student's own contact. Used by the student mobile app for check-in.
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

export const getMembershipQR = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const contactId = request.auth.token?.contactId as string | undefined
  if (!contactId) throw new HttpsError('permission-denied', 'Invalid membership session. Please log in again.')

  const db = admin.firestore()
  const contactRef = db.collection('contacts').doc(contactId)
  const contactDoc = await contactRef.get()

  if (!contactDoc.exists) {
    console.error(`Contact not found for contactId: ${contactId}`)
    throw new HttpsError('not-found', 'Contact not found. Please log out and log in again.')
  }

  const contact = contactDoc.data()!
  // The teacher field (legacy) is used for the hash to match checkInContact
  const teacherId = (contact.teamId ?? contact.teacher) as string | undefined
  if (!teacherId) throw new HttpsError('failed-precondition', 'Contact is not associated with a team.')

  let contactSecret = contact.secret as string | undefined
  if (!contactSecret) {
    contactSecret = crypto.randomBytes(32).toString('hex')
    await contactRef.update({ secret: contactSecret, secret_created_at: FieldValue.serverTimestamp() })
  }

  const hash = crypto.createHash('sha256').update(`${contactId}:${teacherId}:${contactSecret}`).digest('hex')

  return {
    success: true,
    contactId,
    hash,
    qrData: JSON.stringify({ c: contactId, h: hash }),
    contact: {
      firstname: (contact.firstname as string) || '',
      lastname: (contact.lastname as string) || '',
      avatar_url: contact.avatar_url ?? null,
    },
  }
})
