// `trackGoals` — the ONE writer of the contact's coaching counters, and of the
// three coaching activity-log rows (`goal_achieved`, `goal_abandoned`,
// `goal_step_completed`).
//
// ── THE COUNTERS ─────────────────────────────────────────────────────────────
// `coaching_open_count` / `coaching_overdue_count` are ABSOLUTE values, recomputed
// from a fresh query of the goals subcollection on every write — never
// `FieldValue.increment` (see the waitlist "ONE SEAT WRITER" precedent in
// CLAUDE.md). A goal can be created, evaluated, completed, abandoned or
// re-dated from several independent places (the admin tab, Space, the mobile
// app), and only a recount can never drift.
//
// ── CLEARING `overdue_at` LIVES HERE, NOT IN THE DAILY JOB ─────────────────
// `dailyTasks/stampOverdueGoals.ts` is the only writer that turns `overdue_at`
// ON, because falling overdue involves NO write of its own — the target_date
// stays put and the clock moves, so nothing else could ever notice. Turning it
// back OFF is the opposite case: completing a goal, abandoning it, or pushing
// its target_date out IS itself a write to this very document, and this
// trigger already runs on every one of those writes. So the clear happens
// here, on the same pass, rather than waiting up to a day for the next sweep.
// It is self-terminating: the clearing update sets `overdue_at` to `null`, the
// resulting re-entry into this trigger finds nothing left to clear, and stops.
//
// ── ACTIVITY LOG — ONLY ON THE TRANSITION ──────────────────────────────────
// A row is written only when `status` actually changes into 'achieved' or
// 'abandoned' on THIS write — never on every write, and never twice for the
// same transition (an unrelated edit to an already-achieved goal leaves
// `status` unchanged, so it is silently skipped). `type: 'task'` reaching
// 'achieved' is `goal_step_completed`, not `goal_achieved` — a step is not a
// goal. A task moving to 'abandoned' is not named here (no dedicated event
// exists for it and none was asked for); only a top-level goal's abandonment
// is logged.

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  CONTACT_GOALS_SUBCOLLECTION,
  goalIsArchived,
  goalIsOverdue,
  type Goal,
  type ActivityEventType,
} from '@linyup/shared'
import { to } from '../utils/async'
import { logActivity } from '../utils/users'
import { fireGoalCompleted } from './events'

const GOAL_OPEN_STATUSES = new Set(['open', 'in_progress'])

export const trackGoals = onDocumentWritten(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_GOALS_SUBCOLLECTION}/{goalId}`,
  async (event) => {
    const { contactId, goalId } = event.params
    const afterSnap = event.data?.after
    const beforeSnap = event.data?.before
    const after = afterSnap?.exists ? (afterSnap.data() as Goal) : null
    const before = beforeSnap?.exists ? (beforeSnap.data() as Goal) : null
    if (!after && !before) return

    const db = admin.firestore()
    const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)

    // ── Clear a stale overdue_at the moment THIS write makes the goal not
    // overdue — see the module header for why this belongs here rather than
    // in the daily job.
    if (
      after &&
      afterSnap &&
      after.overdue_at &&
      !goalIsOverdue({ status: after.status, target_date: after.target_date })
    ) {
      const [clearErr] = await to(afterSnap.ref.update({ overdue_at: null }))
      if (clearErr) {
        console.error(`[coaching] trackGoals: failed to clear overdue_at for ${goalId}:`, clearErr) // eslint-disable-line no-console
      } else {
        // Keep the in-memory copy consistent for the recount below, so this
        // same pass reports the corrected counter rather than waiting for the
        // re-entry the clearing write above just caused.
        after.overdue_at = null
      }
    }

    // ── Load the contact once — needed for teamId (to file the log under),
    // the current counters (to skip a no-op write) and the fullname (for the
    // log description). Legacy docs may still carry `teacher` instead of
    // `teamId` (see trackContacts' same fallback in analytics/index.ts).
    const [contactErr, contactSnap] = await to(contactRef.get())
    if (contactErr || !contactSnap?.exists) return
    const contact = contactSnap.data()!
    const teamId = (contact.teamId as string | undefined) || (contact.teacher as string | undefined)
    if (!teamId) return

    // ── ONE WRITER of the contact's coaching counters — see module header.
    const [goalsErr, goalsSnap] = await to(contactRef.collection(CONTACT_GOALS_SUBCOLLECTION).get())
    if (!goalsErr && goalsSnap) {
      let open = 0
      let overdue = 0
      for (const doc of goalsSnap.docs) {
        const g = doc.data() as Goal
        // Filed away — out of the counters, which is half of what archiving is
        // FOR: a goal nobody is working on should stop showing up as an open
        // one on the contact list. Tested in memory because `archived_at` is
        // absent on pre-2026-09 goals (see the field's own note).
        if (goalIsArchived(g)) continue
        if (GOAL_OPEN_STATUSES.has(g.status)) {
          open++
          if (g.overdue_at) overdue++
        }
      }
      const currentOpen = (contact.coaching_open_count as number | undefined) ?? 0
      const currentOverdue = (contact.coaching_overdue_count as number | undefined) ?? 0
      if (currentOpen !== open || currentOverdue !== overdue) {
        const [updateErr] = await to(
          contactRef.update({ coaching_open_count: open, coaching_overdue_count: overdue }),
        )
        if (updateErr) {
          console.error(`[coaching] trackGoals: counter update failed for ${contactId}:`, updateErr) // eslint-disable-line no-console
        }
      }
    }

    // ── Activity log — only on the transition ────────────────────────────────
    const oldStatus = before?.status
    const newStatus = after?.status
    if (!after || !newStatus || oldStatus === newStatus) return

    let logEvent: ActivityEventType | null = null
    if (after.type === 'task' && newStatus === 'achieved') logEvent = 'goal_step_completed'
    else if (after.type !== 'task' && newStatus === 'achieved') logEvent = 'goal_achieved'
    else if (after.type !== 'task' && newStatus === 'abandoned') logEvent = 'goal_abandoned'
    if (!logEvent) return

    const fullname =
      `${(contact.firstname as string) || ''} ${(contact.lastname as string) || ''}`.trim() || contactId
    const descriptions: Record<string, string> = {
      goal_achieved: `${fullname} achieved a goal: "${after.title}".`,
      goal_abandoned: `${fullname} gave up on a goal: "${after.title}".`,
      goal_step_completed: `${fullname} completed a step: "${after.title}".`,
    }

    const [logErr] = await to(
      logActivity(teamId, {
        event: logEvent,
        created_at: FieldValue.serverTimestamp(),
        parameters: {
          description: descriptions[logEvent],
          goal_id: goalId,
          goal_type: after.type,
          status: newStatus,
        },
        refs: { contact: contactId, user: teamId },
      }),
    )
    // Loud, and swallowed: a feed row that failed to write must never be able
    // to fail the status write that produced it.
    if (logErr) {
      console.error(`[coaching] trackGoals: activity log failed for ${goalId}:`, logErr) // eslint-disable-line no-console
    }

    if (logEvent === 'goal_achieved') {
      await fireGoalCompleted({
        teamId,
        contactId,
        goalId,
        title: after.title,
        categories: after.categories ?? [],
      })
    }
  },
)
