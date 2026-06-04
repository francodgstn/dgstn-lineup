import * as admin from 'firebase-admin'
import { HttpsError } from 'firebase-functions/v2/https'
import { planIsAtLeast, type SaasPlan } from '@linyup/shared'

/**
 * Throws HttpsError('permission-denied') if the team's plan is below minPlan.
 * Also rejects inactive plans (past_due, cancelled) unless `allowTrial` is true
 * (trial is considered active for all feature checks).
 */
export async function requirePlan(teamId: string, minPlan: SaasPlan): Promise<void> {
  const snap = await admin.firestore().collection('teams').doc(teamId).get()

  if (!snap.exists) {
    throw new HttpsError('not-found', `Team ${teamId} not found`)
  }

  const data = snap.data()!
  const plan: SaasPlan = data.plan ?? 'coach'
  const status: string = data.plan_status ?? 'trial'

  if (status === 'past_due' || status === 'cancelled') {
    throw new HttpsError('permission-denied', 'Your subscription is inactive. Please update your billing.')
  }

  if (!planIsAtLeast(plan, minPlan)) {
    throw new HttpsError(
      'permission-denied',
      `This feature requires the ${minPlan} plan or higher.`
    )
  }
}
