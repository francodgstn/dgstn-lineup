// Index-free bucket rate limiter — a `{key}:{bucket}` counter doc incremented in a
// transaction (same pattern as connect/payments.ts checkoutRateLimit; avoids
// composite indexes and the emulator-hides-missing-index trap).
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

/**
 * Increment the counter for `key` in the current time bucket and throw
 * 'resource-exhausted' once `limit` is exceeded. `key` is sanitized for use in a
 * doc id. Buckets roll over every `windowMs` (e.g. 3_600_000 = hourly).
 */
export async function bucketRateLimit(params: {
  collection: string
  key: string | undefined
  limit: number
  windowMs: number
  message?: string
}): Promise<void> {
  const key = (params.key ?? 'unknown').replace(/[^\w.:-]/g, '_').slice(0, 80)
  const bucket = Math.floor(Date.now() / params.windowMs)
  const ref = admin.firestore().collection(params.collection).doc(`${key}:${bucket}`)
  const count = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const next = ((snap.data()?.count as number | undefined) ?? 0) + 1
    tx.set(ref, { key, bucket, count: next, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return next
  })
  if (count > params.limit) {
    throw new HttpsError(
      'resource-exhausted',
      params.message ?? 'Too many attempts. Please try again later.'
    )
  }
}
