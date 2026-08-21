// Anonymises contacts whose self-service deletion window has passed.
//
// The acting half of `contacts/selfDeletion.ts`: that one only writes a date,
// this is what eventually honours it. It ANONYMISES rather than deletes — the
// studio's finance rows and its immutable waiver ledger reference this contact
// and must survive somebody leaving. `utils/contactDeletion.ts` carries the full
// reasoning and, importantly, THE FIELD LIST: the failure mode of missing one is
// silent and looks finished, so the list is written down once, beside its
// argument, rather than spelled out here.
//
// Deliberately NOT a hard delete, unlike `purgeProvisionalContacts` next door.
// That one removes abandoned registrations holding nothing; this one is a person
// who trained, paid and signed things.
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { CONTACTS_COLLECTION, anonymizedContactPatch } from '@linyup/shared'

const BATCH_SIZE = 100

export async function anonymizeScheduledContacts(): Promise<{ anonymized: number }> {
  const db = admin.firestore()
  const now = Timestamp.now()

  // Single-field query: only a contact with an outstanding request carries
  // `deletion_scheduled_for`, so the deadline alone selects them. The patch
  // clears the field, so a row is never selected twice.
  const snap = await db
    .collection(CONTACTS_COLLECTION)
    .where('deletion_scheduled_for', '<=', now)
    .get()

  let anonymized = 0
  const nowMs = now.toMillis()

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const doc of snap.docs.slice(i, i + BATCH_SIZE)) {
      const data = doc.data()
      // Re-check at write time: the contact may have cancelled between the query
      // and here, and honouring a request they withdrew is the one mistake this
      // sweep must never make.
      if (!data.deletion_scheduled_for) continue
      if (data.anonymized_at) continue
      batch.update(doc.ref, anonymizedContactPatch(nowMs))
      anonymized++
    }
    await batch.commit()
  }

  if (anonymized > 0) {
    // eslint-disable-next-line no-console
    console.log(`anonymizeScheduledContacts: anonymized ${anonymized} contact(s) past their deletion date`)
  }
  return { anonymized }
}
