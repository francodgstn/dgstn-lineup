// Daily task: release drop-in booking holds that were never paid.
// createDropInCheckout writes a PENDING booking (payment_status 'required' + an
// expires_at hold) before the member pays; if payment never completes, the hold is
// deleted here so it doesn't linger. Paid bookings are flipped to 'confirmed' by the
// Connect webhook and no longer carry payment_status 'required', so they're excluded.

import * as admin from 'firebase-admin'

const BATCH_SIZE = 400

export async function expirePendingBookings(): Promise<{ released: number }> {
  const db = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const snap = await db
    .collectionGroup('bookings')
    .where('payment_status', '==', 'required')
    .where('expires_at', '<=', now)
    .get()

  if (snap.empty) return { released: 0 }

  let count = 0
  let batch = db.batch()
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref)
    count++
    if (count % BATCH_SIZE === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }
  if (count % BATCH_SIZE !== 0) await batch.commit()

  return { released: count }
}
