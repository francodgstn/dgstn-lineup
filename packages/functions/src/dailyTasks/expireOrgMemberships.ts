import * as admin from 'firebase-admin'

const BATCH_SIZE = 400

export async function expireOrgMemberships(): Promise<{ expired: number }> {
  const db = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const snap = await db
    .collection('contacts')
    .where('org_membership_active', '==', true)
    .where('org_membership_expiration', '<=', now)
    .get()

  if (snap.empty) return { expired: 0 }

  // Commit in batches of 400 (Firestore limit is 500)
  let count = 0
  let batch = db.batch()

  for (const docSnap of snap.docs) {
    batch.update(docSnap.ref, {
      org_membership_active: false,
      org_membership_status: 'expired',
    })
    count++
    if (count % BATCH_SIZE === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit()
  }

  return { expired: count }
}
