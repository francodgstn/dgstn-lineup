// Deletes rate-limit COUNTER buckets that can no longer bind anything.
//
// `connect_checkout_attempts` holds one `{ prefix, ip, bucket, count }` document
// per (surface, subject, HOUR) — the index-free hourly rate limiter behind every
// public checkout / booking surface (see connect/checkout.ts `spendRateLimit`).
// A bucket only binds within its own hour: `currentRateLimitBucket()` moves on,
// and yesterday's count is compared against nothing. But the collection had no
// purge and no TTL policy, so every bucket ever spent accumulated forever — and
// until the subject was hashed (A11) each also carried a raw client IP in its id
// and `ip` field, an unbounded store of identifiable access logs against the
// 30-day retention `privacy.md` promises.
//
// The subject is a hash now, so this is no longer about PII; it is about not
// keeping a store that only grows. A bucket older than RETAIN_HOURS is dead, and
// deleting it removes no rate-limiting capability — the same safety argument
// `purgeVerificationCodes` rests on. The query is a single-field inequality on
// `bucket` (the hour number every doc carries), so it needs no composite index.
import * as admin from 'firebase-admin'

const BATCH_SIZE = 250
/** Cap per run so one large backlog cannot spend the whole 300s dailyTasks
 *  budget on its first night; the remainder is taken tomorrow. */
const MAX_PER_RUN = 5000
/** Hour buckets older than this are dead — the one-hour window they bound has
 *  long since rolled. Two days is generous margin over that lifetime, and far
 *  inside the 30-day retention promise. */
const RETAIN_HOURS = 48

const HOUR_MS = 3_600_000

export async function purgeCheckoutAttempts(): Promise<number> {
  const db = admin.firestore()
  const currentBucket = Math.floor(Date.now() / HOUR_MS)
  const cutoffBucket = currentBucket - RETAIN_HOURS

  // Oldest first, so a capped run always makes progress at the tail.
  const snap = await db
    .collection('connect_checkout_attempts')
    .where('bucket', '<', cutoffBucket)
    .orderBy('bucket', 'asc')
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

  if (count > 0) {
    // eslint-disable-next-line no-console
    console.log(`purgeCheckoutAttempts: purged ${count} dead rate-limit buckets`)
  }
  return count
}
