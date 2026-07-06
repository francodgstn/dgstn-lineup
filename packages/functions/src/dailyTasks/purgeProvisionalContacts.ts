// Deletes PROVISIONAL contacts whose confirmation window expired — shop
// registrations (login-first checkout) that never completed a payment. The webhook
// clears `provisional`/`provisional_expires_at` on the first successful payment, so
// anything still carrying an expired deadline is an abandoned (or abusive)
// registration holding no data: no payments, no bookings, no entitlements. Hard
// delete (not archive) — these contacts never really joined the contact base.
// See Contact.provisional in @linyup/shared and loginContactWithCode.
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { CONTACTS_COLLECTION } from '@linyup/shared'

const BATCH_SIZE = 250

export async function purgeProvisionalContacts(): Promise<{ purged: number }> {
  const db = admin.firestore()
  const now = Timestamp.now()

  // Single-field query (automatic index): only provisional contacts ever carry
  // provisional_expires_at, so the deadline filter alone selects them.
  const snap = await db
    .collection(CONTACTS_COLLECTION)
    .where('provisional_expires_at', '<', now)
    .get()

  let purged = 0
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const doc of snap.docs.slice(i, i + BATCH_SIZE)) {
      // Re-check the flag at delete time: a payment may have confirmed the contact
      // between query and delete (the webhook clears both fields together).
      if (doc.data().provisional !== true) continue
      batch.delete(doc.ref)
      purged++
    }
    await batch.commit()
  }

  if (purged > 0) {
    console.log(`purgeProvisionalContacts: purged ${purged} expired provisional contacts`) // eslint-disable-line no-console
  }
  return { purged }
}
