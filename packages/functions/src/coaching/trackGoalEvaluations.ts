// `trackGoalEvaluations` — denormalizes the NEWEST evaluation onto its goal as
// `latest_score` + `last_evaluated_at`, so a collapsed goal card can show how a
// goal is actually going without fetching the evaluations subcollection.
//
// Evaluations are NOT append-only like the waiver acceptance ledger — a coach
// or a student may edit their own (`GoalEvaluation.edited`), and either side
// may delete one — so this is an `onDocumentWritten` trigger that recomputes
// from a FRESH QUERY (newest by `evaluated_at`) on every create, update AND
// delete, rather than trusting the written document alone. Editing the newest
// evaluation, or deleting it, must not leave a stale value denormalized onto
// the goal; only a re-derivation from what is actually there can't drift.
//
// Idempotent: skips the write when the recomputed value already matches what
// is stored, so an edit that doesn't touch `score`/`evaluated_at` (e.g. a
// notes-only edit) causes no write and no re-entry into `trackGoals` (which
// listens on the same parent goal document).

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  CONTACT_GOALS_SUBCOLLECTION,
  type Goal,
  type GoalEvaluation,
  CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION,
} from '@linyup/shared'
import { to } from '../utils/async'


function timestampEquals(a: Timestamp | null | undefined, b: Timestamp | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.isEqual(b)
}

export const trackGoalEvaluations = onDocumentWritten(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_GOALS_SUBCOLLECTION}/{goalId}/${CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION}/{evaluationId}`,
  async (event) => {
    const beforeExists = event.data?.before.exists ?? false
    const afterExists = event.data?.after.exists ?? false
    if (!beforeExists && !afterExists) return

    const { contactId, goalId } = event.params
    const db = admin.firestore()
    const goalRef = db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_GOALS_SUBCOLLECTION)
      .doc(goalId)

    const [queryErr, latestSnap] = await to(
      goalRef.collection(CONTACT_GOAL_EVALUATIONS_SUBCOLLECTION).orderBy('evaluated_at', 'desc').limit(1).get(),
    )
    if (queryErr) {
      console.error(`[coaching] trackGoalEvaluations: query failed for goal ${goalId}:`, queryErr) // eslint-disable-line no-console
      return
    }

    const latest =
      latestSnap && !latestSnap.empty ? (latestSnap.docs[0].data() as GoalEvaluation) : null
    const nextScore = latest?.score ?? null
    const nextEvaluatedAt = (latest?.evaluated_at as Timestamp | undefined) ?? null

    const [goalErr, goalSnap] = await to(goalRef.get())
    if (goalErr || !goalSnap?.exists) return
    const goal = goalSnap.data() as Goal

    const sameScore = (goal.latest_score ?? null) === nextScore
    const sameEvaluatedAt = timestampEquals(
      goal.last_evaluated_at as Timestamp | null | undefined,
      nextEvaluatedAt,
    )
    if (sameScore && sameEvaluatedAt) return

    const [updateErr] = await to(
      goalRef.update({ latest_score: nextScore, last_evaluated_at: nextEvaluatedAt }),
    )
    if (updateErr) {
      console.error(`[coaching] trackGoalEvaluations: update failed for goal ${goalId}:`, updateErr) // eslint-disable-line no-console
    }
  },
)
