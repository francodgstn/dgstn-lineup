// Generates a custom Firebase auth token for a student (contact) scoped to a team
// Source: hmd-lineup/functions/src/generateAuthToken/index.js
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { regionalFunctions } from '../utils/functions'
import { isTeamMember } from '../utils/teams'

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export const generateAuthToken = regionalFunctions.https.onCall(
  async (data: { contactId: string; teamId: string }, context) => {
    if (!context.auth) throw new (await import('firebase-functions')).https.HttpsError('unauthenticated', 'Not authenticated')

    const { contactId, teamId } = data
    const userId = context.auth.uid

    if (!contactId || !teamId) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'contactId and teamId are required')

    const isMember = await isTeamMember(userId, teamId)
    if (!isMember) throw new (await import('firebase-functions')).https.HttpsError('permission-denied', 'Not a member of this team')

    const contactDoc = await admin.firestore().collection('contacts').doc(contactId).get()
    if (!contactDoc.exists || contactDoc.data()?.teamId !== teamId) {
      throw new (await import('firebase-functions')).https.HttpsError('not-found', 'Contact not found in this team')
    }

    const sessionExpires = Date.now() + SESSION_DURATION_MS

    // Custom claims scoped to this contact + team
    const customToken = await admin.auth().createCustomToken(`contact:${teamId}:${contactId}`, {
      contactId,
      teamId,
      sessionExpires,
      email: contactDoc.data()?.email,
    })

    // Store token record for auditing
    await admin.firestore().collection('auth_tokens').add({
      contactId,
      teamId,
      createdBy: userId,
      sessionExpires,
      created_at: FieldValue.serverTimestamp(),
    })

    return { customToken, sessionExpires }
  }
)
