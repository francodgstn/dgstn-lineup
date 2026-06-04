/**
 * When an activity's `type` field changes, forward the new type to all
 * *upcoming* sessions linked to that activity.
 *
 * Past sessions are intentionally left untouched — they are historical records
 * and their activityType at the time of occurrence should be preserved.
 *
 * Batch size is capped at 500 (Firestore limit). Upcoming sessions per
 * activity rarely exceed a few dozen, so a single batch is almost always
 * sufficient; the loop handles edge cases safely.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { SESSIONS_COLLECTION, ACTIVITIES_COLLECTION } from '@linyup/shared'

const BATCH_SIZE = 500

export const onActivityTypeChange = onDocumentUpdated(
  `${ACTIVITIES_COLLECTION}/{activityId}`,
  async (event) => {
    const { activityId } = event.params
    const before = event.data!.before.data()
    const after  = event.data!.after.data()

    const typeBefore = (before.type ?? 'group_class') as string
    const typeAfter  = (after.type  ?? 'group_class') as string

    // No-op unless type actually changed
    if (typeBefore === typeAfter) return

    console.log(
      `onActivityTypeChange: activity ${activityId} — type changed ${typeBefore} → ${typeAfter}`
    )

    const db  = admin.firestore()
    const now = Timestamp.now()

    const snap = await db
      .collection(SESSIONS_COLLECTION)
      .where('activityId', '==', activityId)
      .where('start', '>=', now)
      .get()

    if (snap.empty) {
      console.log('onActivityTypeChange: no upcoming sessions — nothing to update')
      return
    }

    const docs = snap.docs
    let updated = 0

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch()
      for (const docSnap of docs.slice(i, i + BATCH_SIZE)) {
        batch.update(docSnap.ref, { activityType: typeAfter })
      }
      await batch.commit()
      updated += docs.slice(i, i + BATCH_SIZE).length
    }

    console.log(`onActivityTypeChange: updated ${updated} upcoming session(s)`)
  }
)
