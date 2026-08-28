/* eslint-disable no-console */
// What has to happen when a goal is deleted — because Firestore does not do it
// for you.
//
// A SUBCOLLECTION SURVIVES ITS PARENT'S DELETION. Deleting a goal document left
// its whole `evaluations` subcollection behind: every score, note and status
// transition a coach and a member ever recorded against it, still stored, still
// billable, reachable by collection-group query and by nothing else. The rows
// were invisible to every UI (they are only ever read through the parent goal)
// and there was no writer that would ever remove them, so the only way out was
// a manual console sweep nobody knew to run.
//
// The steps are treated the OPPOSITE way, deliberately: they are kept and
// UNPARENTED, never cascaded. A step is homework the member may already have
// done, and deleting a goal must not silently destroy work somebody completed —
// so the step survives and falls into the "General" group. `groupGoalsWithSteps`
// already routes a step whose parent is missing there, so the UI was correct
// before this ran; clearing the field just stops the document from carrying a
// pointer to something that no longer exists.

import * as admin from 'firebase-admin'
import { onDocumentDeleted } from 'firebase-functions/v2/firestore'
import {
  CONTACTS_COLLECTION,
  CONTACT_GOALS_SUBCOLLECTION,
} from '@linyup/shared'

/** Ceiling on the steps one teardown will unparent — far past any real goal, so
 *  a pathological document cannot turn a delete into an unbounded job. */
const MAX_STEPS_UNPARENTED = 500

export const teardownGoal = onDocumentDeleted(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_GOALS_SUBCOLLECTION}/{goalId}`,
  async (event) => {
    const { contactId, goalId } = event.params
    const db = admin.firestore()
    const goalRef = db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_GOALS_SUBCOLLECTION)
      .doc(goalId)

    // The document itself is already gone; this reaches only what it left behind.
    // Idempotent — a second run finds no subcollections and writes nothing.
    try {
      await db.recursiveDelete(goalRef)
    } catch (err) {
      console.error(`[teardownGoal] evaluations cleanup failed for ${contactId}/${goalId}`, err)
    }

    // Steps kept, pointer cleared — see the header for why this is not a cascade.
    try {
      const orphans = await goalRef.parent
        .where('parent_goal_id', '==', goalId)
        .limit(MAX_STEPS_UNPARENTED)
        .get()
      if (orphans.empty) return
      const batch = db.batch()
      for (const d of orphans.docs) batch.update(d.ref, { parent_goal_id: null })
      await batch.commit()
    } catch (err) {
      console.error(`[teardownGoal] unparenting steps failed for ${contactId}/${goalId}`, err)
    }
  },
)
