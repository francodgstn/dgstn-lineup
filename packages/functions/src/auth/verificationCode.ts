// Shared helper for verifying a one-time email code stored in verification_codes/{codeId}.
// Used by verifyContactCode, completeSignup, and loginContactWithCode.
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue, DocumentReference, DocumentData } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'


/**
 * Validates the code against the verification_codes/{codeId} document and, on
 * success, marks the doc as verified (verified=true, verifiedAt=serverTimestamp).
 *
 * Throws an HttpsError for every failure case so callers can re-throw directly.
 * Returns the raw codeDoc.data() so callers can read email / team_id without a
 * second round-trip.
 */
export async function assertVerifiableCode(
  codeRef: DocumentReference<DocumentData>,
  code: string
): Promise<DocumentData> {
  const codeDoc = await codeRef.get()
  if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid code')

  const codeData = codeDoc.data()!

  if (codeData.used) throw new HttpsError('failed-precondition', 'Code already used')

  const now = Timestamp.now()
  if (codeData.expiresAt.toMillis() < now.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'Code has expired. Please request a new code.')
  }

  if ((codeData.attempts || 0) >= 5) {
    throw new HttpsError('resource-exhausted', 'Too many failed attempts. Please request a new code.')
  }

  if (codeData.code !== code) {
    await codeRef.update({ attempts: FieldValue.increment(1) })
    const remaining = 5 - ((codeData.attempts || 0) + 1)
    throw new HttpsError('invalid-argument', `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`)
  }

  await codeRef.update({ verified: true, verifiedAt: FieldValue.serverTimestamp() })

  return codeData
}

/**
 * Convenience wrapper: resolves codeId → DocumentReference, then calls assertVerifiableCode.
 */
export async function assertVerifiableCodeById(codeId: string, code: string): Promise<DocumentData> {
  const codeRef = admin.firestore().collection('verification_codes').doc(codeId)
  return assertVerifiableCode(codeRef, code)
}
