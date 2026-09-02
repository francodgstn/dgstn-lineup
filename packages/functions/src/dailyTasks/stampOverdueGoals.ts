// Daily task: stamp `overdue_at` on goals/tasks that have just fallen overdue.
//
// A goal going overdue involves NO write of its own — the `target_date` stays
// put and the clock moves — so nothing else in the system could ever notice
// the transition. This scan is the wake-up: it finds every OPEN goal
// (`status` 'open' or 'in_progress') whose `target_date` has passed, skips the
// ones already stamped, and sets `overdue_at` to the moment it was first
// observed. That write is what wakes `trackGoals` (coaching/trackGoals.ts —
// the ONE writer of the contact's `coaching_overdue_count`) to recompute it.
//
// ── WHERE CLEARING LIVES (deliberately NOT here) ────────────────────────────
// This job never turns `overdue_at` back off. Completing a goal, abandoning
// it, or pushing its `target_date` out IS a write to the goal document, and
// `trackGoals` already runs on every one of those writes — so the clear
// happens there, on the same pass that made the goal not-overdue, rather than
// waiting up to 24h for this sweep to notice. Duplicating the clear here would
// only ever run it a day late, and — since `trackGoals` already owns the
// counter that clearing is meant to keep honest — would risk two writers
// disagreeing about a document neither exclusively holds.
//
// Filters `overdue_at` IN MEMORY rather than with a third `where` clause: a
// Firestore `== null` filter only matches documents where the field is
// explicitly stored as `null`, never documents where it is simply absent
// (the case for every goal that has never fallen overdue), so a query-level
// filter would silently skip most candidates. Reading the field back after the
// (status, target_date) query is fetched avoids that trap entirely.

import * as admin from 'firebase-admin'
import { CONTACT_GOALS_SUBCOLLECTION, goalIsArchived, type Goal } from '@linyup/shared'
import { fireTaskOverdue } from '../coaching/events'

const BATCH_SIZE = 400
const OPEN_STATUSES = ['open', 'in_progress'] as const

export async function stampOverdueGoals(): Promise<{ stamped: number }> {
  const db = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const snap = await db
    .collectionGroup(CONTACT_GOALS_SUBCOLLECTION)
    .where('status', 'in', [...OPEN_STATUSES])
    .where('target_date', '<=', now)
    .get()

  if (snap.empty) return { stamped: 0 }

  let count = 0
  let batch = db.batch()
  // Tasks just stamped, to notify AFTER the batch commits (so anything a rule
  // reads back sees the write). A top-level goal falling overdue is NOT
  // notified — see coaching/events.ts's census header for why.
  const newlyOverdueTasks: { contactId: string; goalId: string; goal: Goal }[] = []

  for (const docSnap of snap.docs) {
    const goal = docSnap.data() as Goal
    if (goal.overdue_at) continue // already stamped — nothing to do
    // Filed away: stop stamping it, which also stops it firing `task_overdue`
    // at a coach who has explicitly put it aside. Same in-memory reason as
    // `overdue_at` above — `archived_at` is absent on older goals.
    if (goalIsArchived(goal)) continue

    const contactRef = docSnap.ref.parent.parent
    if (!contactRef) continue // 'goals' is always nested under a contact; defensive only

    batch.update(docSnap.ref, { overdue_at: now })
    count++
    if (goal.type === 'task') {
      newlyOverdueTasks.push({ contactId: contactRef.id, goalId: docSnap.id, goal })
    }

    if (count % BATCH_SIZE === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit()
  }

  // Best-effort per item — one contact's failure (missing teamId, automation
  // error) must never lose the rest of the sweep, and the stamping above has
  // already committed regardless.
  for (const item of newlyOverdueTasks) {
    try {
      const contactSnap = await db.collection('contacts').doc(item.contactId).get()
      const teamId = contactSnap.exists ? (contactSnap.data()?.teamId as string | undefined) : undefined
      if (!teamId) continue
      await fireTaskOverdue({
        teamId,
        contactId: item.contactId,
        goalId: item.goalId,
        title: item.goal.title,
        parentGoalId: item.goal.parent_goal_id ?? null,
      })
    } catch (err) {
      console.error(`[dailyTasks] stampOverdueGoals: task_overdue fire failed (${item.goalId}):`, err) // eslint-disable-line no-console
    }
  }

  return { stamped: count }
}
