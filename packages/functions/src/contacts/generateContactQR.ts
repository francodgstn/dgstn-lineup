// Ported from hmd-lineup/functions/src/generateContactQR/index.js
// Admin callable — generates a secure QR hash for a contact (SHA256 of contactId:teamId:secret).
// The hash is consumed by checkInContact on the teacher-side QR scanner.
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { isTeamMember } from '../utils/teams'

export const generateContactQR = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated to generate QR codes.')

  const { contactId } = request.data as { contactId: string }
  if (!contactId) throw new HttpsError('invalid-argument', 'contactId is required.')

  const db = admin.firestore()
  const callerId = request.auth.uid

  const contactRef = db.collection('contacts').doc(contactId)
  const contactDoc = await contactRef.get()
  if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found.')

  const contact = contactDoc.data()!
  // teacher || teamId — legacy compat
  const teamId = (contact.teamId ?? contact.teacher) as string | undefined
  if (!teamId) throw new HttpsError('failed-precondition', 'Contact is not associated with a team.')

  // Require the caller to be a team member
  const isMember = await isTeamMember(callerId, teamId)
  if (!isMember) throw new HttpsError('permission-denied', 'You do not have permission to generate QR for this contact.')

  // Lazily generate a per-contact secret
  let contactSecret = contact.secret as string | undefined
  if (!contactSecret) {
    contactSecret = crypto.randomBytes(32).toString('hex')
    await contactRef.update({ secret: contactSecret, secret_created_at: FieldValue.serverTimestamp() })
  }

  // Hash = SHA256(contactId:teamId:secret)
  const hash = crypto.createHash('sha256').update(`${contactId}:${teamId}:${contactSecret}`).digest('hex')

  return {
    success: true,
    contactId,
    hash,
    qrData: JSON.stringify({ c: contactId, h: hash }),
    contact: {
      firstname: contact.firstname,
      lastname: contact.lastname,
      avatar_url: contact.avatar_url ?? null,
    },
  }
})
