// Logs an existing contact in using a previously-issued email verification code.
// Unlike completeMembershipSignup (which creates a new contact), this function
// expects the contact to already exist in Firestore.
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { buildContactSession } from '../utils/contactSession'
import { assertVerifiableCodeById } from './verificationCode'


export const loginContactWithCode = onCall(async (request) => {
  const data = request.data as {
    codeId?: string
    code?: string
    selectedContactId?: string
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

  // Find active contacts for this email + team
  const contactsSnap = await admin
    .firestore()
    .collection('contacts')
    .where('email', '==', email)
    .where('teamId', '==', teamId)
    .get()

  // Exclude archived or deleted contacts
  const activeContacts = contactsSnap.docs.filter((doc) => {
    const d = doc.data()
    return d.archived_at == null && d.deleted_at == null
  })

  if (activeContacts.length === 0) {
    return { requiresSignup: true, email }
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
