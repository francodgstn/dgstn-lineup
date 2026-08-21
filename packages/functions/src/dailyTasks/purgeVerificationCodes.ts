// Deletes EXPIRED one-time verification codes.
//
// ── WHY THIS IS NOT JUST HOUSEKEEPING ────────────────────────────────────────
//
// `sendContactVerificationCode` rate-limits per email by COUNTING documents:
//
//     .collection('verification_codes')
//       .where('email', '==', normalizedEmail)
//       .where('createdAt', '>=', oneHourAgo)
//
// so the limit is self-clearing on a one-hour window and does not depend on this
// sweep. What DOES depend on it is everything else: the collection had no purge
// and no TTL policy, so every code ever issued — each carrying an email address
// and, on this rail, a PLAINTEXT six-digit code — accumulated forever. A
// collection that only grows is a slower query, a larger export, and a bigger
// thing to leak.
//
// The codes are worthless once expired: `assertVerifiableCode` refuses on
// `expiresAt < now` before it compares anything, so deleting them removes no
// capability. That is the whole safety argument for a hard delete here.
//
// Both rails are swept, because both have the same problem and neither had an
// answer: `verification_codes` (contact login) and `booking_verification_codes`
// (bio-link booking). The booking rail stores a HASH rather than the code, which
// is better, but it accumulates just the same.
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'

const BATCH_SIZE = 250
/** Sweep no more than this per collection per run, so one very large backlog
 *  cannot spend the whole 300s `dailyTasks` budget on its first night. The
 *  remainder is taken tomorrow — nothing here is urgent. */
const MAX_PER_RUN = 5000

/**
 * THE TWO RAILS SPELL THE EXPIRY DIFFERENTLY, and the difference is silent: a
 * Firestore inequality on a field a document does not have matches NOTHING, so
 * sweeping `booking_verification_codes` on `expiresAt` deletes zero rows,
 * forever, while reporting success. Verified against the writers —
 * `auth/sendContactVerificationCode.ts` writes `expiresAt`,
 * `booking/index.ts` writes `expires_at`.
 */
const COLLECTIONS: ReadonlyArray<{ name: string; expiryField: string }> = [
  { name: 'verification_codes', expiryField: 'expiresAt' },
  { name: 'booking_verification_codes', expiryField: 'expires_at' },
]

export async function purgeVerificationCodes(): Promise<Record<string, number>> {
  const db = admin.firestore()
  const now = Timestamp.now()
  const purged: Record<string, number> = {}

  for (const { name: collection, expiryField } of COLLECTIONS) {
    // Single-field query on the expiry each rail actually writes. Ordered so the
    // oldest go first and a capped run always makes progress at the tail.
    const snap = await db
      .collection(collection)
      .where(expiryField, '<', now)
      .orderBy(expiryField, 'asc')
      .limit(MAX_PER_RUN)
      .get()

    let count = 0
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = db.batch()
      for (const doc of snap.docs.slice(i, i + BATCH_SIZE)) {
        batch.delete(doc.ref)
        count++
      }
      await batch.commit()
    }

    purged[collection] = count
    if (count > 0) {
      // eslint-disable-next-line no-console
      console.log(`purgeVerificationCodes: purged ${count} expired codes from ${collection}`)
    }
  }

  return purged
}
