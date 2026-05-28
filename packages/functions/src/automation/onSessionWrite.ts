// Tier 1+2 trigger — detects when a session is created or its end time changes.
// For each active 'session_ended' rule, enqueues a Cloud Task scheduled at
// session.end + rule.trigger.delayMinutes (Tier 2).
//
// Trigger path: sessions/{sessionId}
// Sessions have a teamId field and store end as a Firestore Timestamp.
//
// Idempotency: key = "{ruleId}:{sessionId}". If end time changes and a new task
// is enqueued with the same key, the first task to execute wins; the duplicate
// is a no-op (executeDelayedRule checks the automation_logs before running).
import { Timestamp } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import { normalizeRule, enqueueDelayedRule, fireEventRules, type ContactData } from '../utils/automationEngine'

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (typeof (ts as Timestamp).toDate === 'function') return (ts as Timestamp).toDate()
  if (typeof (ts as { seconds: number }).seconds === 'number') {
    return new Date((ts as { seconds: number }).seconds * 1000)
  }
  return null
}

export const onSessionWrite = onDocumentWritten(
  'sessions/{sessionId}',
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()

    if (!after) return // session deleted — no automation

    const teamId = after.teamId as string | undefined
    if (!teamId) return

    // Only act when a session is created or its end time changes
    const prevEnd = toDate(before?.end)
    const nextEnd = toDate(after.end)
    if (!nextEnd) return

    const isNew = !before
    const endChanged = prevEnd?.getTime() !== nextEnd.getTime()
    if (!isNew && !endChanged) return

    const now = new Date()

    // If session already ended, fire rules immediately (no delay possible)
    if (nextEnd <= now) {
      await fireImmediateSessionRules(event.params.sessionId, teamId, nextEnd)
      return
    }

    // Session is in the future — enqueue Cloud Tasks for each session_ended rule
    const db = admin.firestore()
    const [rulesErr, rulesSnap] = await to(
      db
        .collection('teams').doc(teamId)
        .collection('automation_rules')
        .where('active', '==', true)
        .get()
    )
    if (rulesErr || !rulesSnap || rulesSnap.empty) return

    // Load participants now so we have contactIds at enqueue time
    const [partErr, partSnap] = await to(
      db.collection('sessions').doc(event.params.sessionId).collection('participants').get()
    )
    const contactIds: string[] = !partErr && partSnap
      ? partSnap.docs.map((d) => d.id)
      : []

    for (const ruleDoc of rulesSnap.docs) {
      const rule = normalizeRule(ruleDoc.id, ruleDoc.data() as Record<string, unknown>)
      if (rule.trigger.type !== 'session_ended') continue

      const [enqueueErr] = await to(
        enqueueDelayedRule(rule, teamId, event.params.sessionId, nextEnd, contactIds)
      )
      if (enqueueErr) {
        console.error(`[onSessionWrite] Failed to enqueue rule=${rule.id} session=${event.params.sessionId}:`, (enqueueErr as Error).message) // eslint-disable-line no-console
      }
    }
  }
)

/**
 * For sessions that are already in the past when written (e.g. imported or
 * backfilled), fire session_ended rules immediately for confirmed participants.
 */
async function fireImmediateSessionRules(
  sessionId: string,
  teamId: string,
  _sessionEnd: Date
): Promise<void> {
  const db = admin.firestore()

  const [partErr, partSnap] = await to(
    db.collection('sessions').doc(sessionId).collection('participants').get()
  )
  if (partErr || !partSnap || partSnap.empty) return

  const contacts: ContactData[] = []
  for (const partDoc of partSnap.docs) {
    const [cErr, cDoc] = await to(db.collection('contacts').doc(partDoc.id).get())
    if (!cErr && cDoc && cDoc.exists) {
      contacts.push({ id: partDoc.id, ...(cDoc.data() as Omit<ContactData, 'id'>) })
    }
  }

  if (contacts.length === 0) return

  await fireEventRules(teamId, 'session_ended', contacts)
}
