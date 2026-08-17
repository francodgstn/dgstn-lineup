import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'
import { planIsAtLeast, type SaasPlan } from '@linyup/shared'

/**
 * Throws HttpsError('permission-denied') if the team's plan is below minPlan.
 * Also rejects inactive plans (past_due, cancelled) unless `allowTrial` is true
 * (trial is considered active for all feature checks).
 *
 * BOTH refusals carry `details.reason` — 'plan_inactive' for a lapsed
 * subscription, 'plan_required' for a tier below the gate — because the message
 * strings here are the STUDIO's, in English, and this gate is reachable from a
 * public surface. `joinWaitlist` is the one public caller today (every other
 * one is behind `request.auth` + a team-membership check), and a visitor on a
 * German booking page must not be shown the studio's upgrade prose. The reason
 * is what lets that client say "the queue is not available for this class"
 * instead. A new public caller must map these two codes as well.
 */
export async function requirePlan(teamId: string, minPlan: SaasPlan): Promise<void> {
  const snap = await admin.firestore().collection('teams').doc(teamId).get()

  if (!snap.exists) {
    throw new HttpsError('not-found', `Team ${teamId} not found`)
  }

  const data = snap.data()!
  // Unknown/legacy teams fail closed: treat a missing plan as Free (lowest tier).
  const plan: SaasPlan = data.plan ?? 'free'
  const status: string = data.plan_status ?? 'trial'

  if (status === 'past_due' || status === 'cancelled') {
    throw new HttpsError(
      'permission-denied',
      'Your subscription is inactive. Please update your billing.',
      { reason: 'plan_inactive' }
    )
  }

  if (!planIsAtLeast(plan, minPlan)) {
    throw new HttpsError('permission-denied', `This feature requires the ${minPlan} plan or higher.`, {
      reason: 'plan_required',
    })
  }
}
