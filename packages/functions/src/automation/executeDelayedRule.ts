// Tier 2 — Cloud Tasks handler for delayed automation rule execution.
// Registered as a task queue function (onTaskDispatched). Firebase automatically
// creates the Cloud Tasks queue with the same name as this function.
//
// Enqueued by: onSessionWrite (session_ended trigger with delayMinutes > 0)
// Payload: { ruleId, teamId, sessionId, contactIds, idempotencyKey }
//
// Idempotency: before executing, checks automation_logs for a doc with
// idempotency_key matching the payload. If found, the task is a no-op.
// This prevents double-execution when a session's end time changes and
// multiple tasks are enqueued with the same ruleId:sessionId key.
import { onTaskDispatched } from 'firebase-functions/v2/tasks'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { normalizeRule, runRule, type ContactData, type DelayedRulePayload } from '../utils/automationEngine'

export const executeDelayedRule = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 20 },
  },
  async (req) => {
    const { ruleId, teamId, sessionId, contactIds, idempotencyKey } = req.data as DelayedRulePayload

    if (!ruleId || !teamId || !idempotencyKey) {
      console.error('[executeDelayedRule] Invalid payload:', req.data) // eslint-disable-line no-console
      return // Don't throw — Cloud Tasks would retry
    }

    const db = admin.firestore()

    // Idempotency check — if we've already executed this key, skip silently
    const [checkErr, logSnap] = await to(
      db
        .collection('teams').doc(teamId)
        .collection('automation_logs')
        .where('idempotency_key', '==', idempotencyKey)
        .limit(1)
        .get()
    )
    if (!checkErr && logSnap && !logSnap.empty) {
      console.log(`[executeDelayedRule] Already executed idempotencyKey=${idempotencyKey}, skipping`) // eslint-disable-line no-console
      return
    }

    // Load rule
    const [ruleErr, ruleDoc] = await to(
      db.collection('teams').doc(teamId).collection('automation_rules').doc(ruleId).get()
    )
    if (ruleErr || !ruleDoc || !ruleDoc.exists) {
      console.error(`[executeDelayedRule] Rule ${ruleId} not found for team ${teamId}`) // eslint-disable-line no-console
      return
    }

    const rule = normalizeRule(ruleId, ruleDoc.data() as Record<string, unknown>)
    if (!rule.active) {
      console.log(`[executeDelayedRule] Rule ${ruleId} is inactive, skipping`) // eslint-disable-line no-console
      return
    }

    // Load team data for variable substitution
    const [teamErr, teamDoc] = await to(db.collection('teams').doc(teamId).get())
    const teamData = !teamErr && teamDoc && teamDoc.exists
      ? (teamDoc.data() as Record<string, unknown>)
      : {}

    // Load participants at execution time from the session's participants subcollection.
    // We intentionally do NOT use the snapshotted contactIds because participants are created
    // during check-in (which happens during/after the session, not at enqueue time).
    // Loading at execution time ensures we capture everyone who actually attended.
    const contacts: ContactData[] = []
    if (sessionId) {
      const [partErr, partSnap] = await to(
        db.collection('sessions').doc(sessionId).collection('participants').get()
      )
      if (!partErr && partSnap && !partSnap.empty) {
        for (const partDoc of partSnap.docs) {
          const [cErr, cDoc] = await to(db.collection('contacts').doc(partDoc.id).get())
          if (!cErr && cDoc && cDoc.exists) {
            contacts.push({ id: partDoc.id, ...(cDoc.data() as Omit<ContactData, 'id'>) })
          }
        }
      }
    }

    if (contacts.length === 0) {
      console.log(`[executeDelayedRule] No participants for rule=${ruleId} session=${sessionId} — writing idempotency log only`) // eslint-disable-line no-console
      // Still write a log entry so the idempotency guard works on duplicate tasks
    }

    const log = await runRule(rule, contacts, teamId, teamData, {
      triggerTier: 'delayed',
      force: false,
    })

    // Write idempotency-guarded log entry
    await to(
      db.collection('teams').doc(teamId).collection('automation_logs').add({
        ...log,
        idempotency_key: idempotencyKey,
        session_id: sessionId,
      })
    )
    await to(
      db.collection('teams').doc(teamId).collection('automation_rules').doc(ruleId).update({
        last_run_at: FieldValue.serverTimestamp(),
        last_run_sent: log.actions_executed,
      })
    )

    console.log(`[executeDelayedRule] rule=${ruleId} team=${teamId} session=${sessionId}`, { // eslint-disable-line no-console
      contacts: contacts.length,
      executed: log.actions_executed,
      failed: log.actions_failed,
    })
  }
)
