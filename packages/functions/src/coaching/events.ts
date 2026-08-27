// ─── Coaching automation events — THE ONE PLACE THAT FIRES THEM ──────────────
//
// The coaching plugin CONTRIBUTES three automation triggers, mounted the same
// way the referrals plugin's are (see `referrals/events.ts`, the reference
// this file follows exactly): the automations builder mounts every trigger an
// installed plugin declares, and until something calls `fireEventRules` with
// the matching name, a rule built on it waits forever — no error, no log,
// nothing to notice.
//
// The census — every site that fires a coaching trigger:
//   • `plugin:coaching:goal_completed`   — coaching/trackGoals.ts, on the
//     write that moves a goal (type: 'goal') into status 'achieved'.
//   • `plugin:coaching:task_overdue`     — dailyTasks/stampOverdueGoals.ts,
//     the moment a TASK (type: 'task') is first stamped `overdue_at`. A
//     top-level goal falling overdue surfaces as the `goal_overdue` contact
//     attention reason instead; only a task — the homework a coach actually
//     assigned — gets an automatable nudge. See stampOverdueGoals.ts.
//   • `plugin:coaching:checkin_submitted` — coaching/trackPerformanceCheckins.ts,
//     on every new check-in document.
// Add to this list; do not copy it.
//
// THE SUBJECT IS THE CONTACT the coaching item belongs to, always — the
// person whose goal/task/check-in this is, never the coach who authored it.
//
// Non-fatal by construction: a goal write, a daily sweep and a check-in
// submission must all succeed regardless of whether automation can run.

import * as admin from 'firebase-admin'
import { fireEventRules, type ContactData } from '../utils/automationEngine'
import { to } from '../utils/async'

/** Load the contact as an automation subject. Null when the contact is gone,
 *  archived/deleted, or has moved to another team — an automation must never
 *  run for somebody who is no longer this tenant's contact. */
async function loadSubject(teamId: string, contactId: string): Promise<ContactData | null> {
  const [err, snap] = await to(admin.firestore().collection('contacts').doc(contactId).get())
  if (err || !snap || !snap.exists) return null
  const data = snap.data() as Omit<ContactData, 'id'>
  if ((data as Record<string, unknown>).teamId !== teamId) return null
  if (data.deleted_at || data.archived_at) return null
  return { id: contactId, ...data }
}

async function fireCoachingEvent(
  trigger: 'plugin:coaching:goal_completed' | 'plugin:coaching:task_overdue' | 'plugin:coaching:checkin_submitted',
  teamId: string,
  contactId: string,
  payload: Record<string, unknown>,
  logId: string,
): Promise<void> {
  try {
    const subject = await loadSubject(teamId, contactId)
    if (!subject) return
    await fireEventRules(teamId, trigger, [subject], { payload })
  } catch (err) {
    console.error(`[coaching] ${trigger} automation fire failed (${logId}):`, err) // eslint-disable-line no-console
  }
}

/** A goal (not a step) was marked achieved. */
export async function fireGoalCompleted(params: {
  teamId: string
  contactId: string
  goalId: string
  title: string
  categories: string[]
}): Promise<void> {
  await fireCoachingEvent(
    'plugin:coaching:goal_completed',
    params.teamId,
    params.contactId,
    {
      goal_id: params.goalId,
      goal_title: params.title,
      categories: params.categories ?? [],
    },
    params.goalId,
  )
}

/** A task (a step in service of a goal, or unparented) was first observed past
 *  its target date. */
export async function fireTaskOverdue(params: {
  teamId: string
  contactId: string
  goalId: string
  title: string
  parentGoalId: string | null
}): Promise<void> {
  await fireCoachingEvent(
    'plugin:coaching:task_overdue',
    params.teamId,
    params.contactId,
    {
      goal_id: params.goalId,
      task_title: params.title,
      parent_goal_id: params.parentGoalId,
    },
    params.goalId,
  )
}

/** A performance check-in was submitted (created). */
export async function fireCheckinSubmitted(params: {
  teamId: string
  contactId: string
  checkinId: string
  profileKey: string | null
  primaryLever: string | null
}): Promise<void> {
  await fireCoachingEvent(
    'plugin:coaching:checkin_submitted',
    params.teamId,
    params.contactId,
    {
      checkin_id: params.checkinId,
      profile_key: params.profileKey,
      primary_lever: params.primaryLever,
    },
    params.checkinId,
  )
}
