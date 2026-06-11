// Ported from hmd-lineup/functions/src/validateAuthToken/index.js
// Public callable (no auth required) — validates a scoped auth token and returns
// prefill contact data for bio-link forms (booking, membership signup).
// Does NOT mark the token as used — that happens when the form is submitted.
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

const VALID_TOKEN_TYPES = ['booking', 'membership'] as const
const PREFILL_FIELDS = [
  'firstname',
  'lastname',
  'phone',
  'birthdate',
  'gender',
  'birthplace',
  'residence',
  'notes',
  'email',
]

export const validateAuthToken = onCall(async (request) => {
  // Public — no auth check; token IS the credential
  const { token, teamId, type } = request.data as { token: string; teamId: string; type: string }

  if (!token) throw new HttpsError('invalid-argument', 'Missing required field: token')
  if (!teamId) throw new HttpsError('invalid-argument', 'Missing required field: teamId')
  if (!type) throw new HttpsError('invalid-argument', 'Missing required field: type')
  if (!(VALID_TOKEN_TYPES as readonly string[]).includes(type)) {
    throw new HttpsError('invalid-argument', `Invalid token type: ${type}`)
  }

  console.log(`Validating ${type} auth token: ${token.substring(0, 8)}...`)

  const tokenDoc = await admin.firestore().collection('auth_tokens').doc(token).get()
  if (!tokenDoc.exists) throw new HttpsError('not-found', 'Invalid or expired token')

  const tokenData = tokenDoc.data()!

  if (tokenData.type !== type) throw new HttpsError('permission-denied', 'Token type mismatch')
  if ((tokenData.expires_at as Timestamp).toMillis() < Timestamp.now().toMillis())
    throw new HttpsError('deadline-exceeded', 'Token has expired')
  if (tokenData.used) throw new HttpsError('failed-precondition', 'Token has already been used')
  if (tokenData.team_id !== teamId)
    throw new HttpsError('permission-denied', 'Token does not match the requested team')

  const contactDoc = await admin
    .firestore()
    .collection('contacts')
    .doc(tokenData.contact_id as string)
    .get()
  if (!contactDoc.exists) throw new HttpsError('not-found', 'Contact not found')

  const contactData = contactDoc.data()!
  const prefillData: Record<string, unknown> = {}
  for (const field of PREFILL_FIELDS) {
    if (contactData[field] !== undefined) prefillData[field] = contactData[field]
  }

  console.log(
    `Token validated for contact: ${tokenData.contact_id as string} (type: ${(contactData.type as string) || 'unknown'})`
  )

  return {
    valid: true,
    contactId: tokenData.contact_id,
    contactType: (contactData.type as string) || null,
    prefillData,
  }
})
