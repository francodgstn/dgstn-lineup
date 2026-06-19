// Shared access-control + persistence helpers for the Connect feature, reused by
// the onboarding callables, the payment callables, the refund flow, and the
// webhook handler.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  CONNECT_ACCOUNTS_COLLECTION,
  TEAMS_COLLECTION,
  type ConnectOnboardingModel,
  type SaasPlan,
} from '@linyup/shared'
import { hasTeamRole } from '../utils/teams'
import { getHostingUrl } from '../utils/env'
import type { NormalizedAccountStatus } from '../utils/connect/client'

export async function assertOwner(uid: string, teamId: string): Promise<void> {
  if (!(await hasTeamRole(uid, teamId, 'owner'))) {
    throw new HttpsError('permission-denied', 'Owner access required')
  }
}

/** Managers and owners can take payments; only owners change onboarding. */
export async function assertManager(uid: string, teamId: string): Promise<void> {
  if (!(await hasTeamRole(uid, teamId, 'manager'))) {
    throw new HttpsError('permission-denied', 'Manager access required')
  }
}

export interface EnabledTeam {
  id: string
  plan: SaasPlan
  name?: string
  payments?: {
    connectEnabled?: boolean
    connectAccountId?: string
    connectModel?: ConnectOnboardingModel
    connectStatus?: string
  }
  data: FirebaseFirestore.DocumentData
}

/**
 * Loads the team and enforces the per-team Connect feature flag
 * (teams/{teamId}.payments.connectEnabled). Throws unless the flag is on, so the
 * feature ships dark until an operator enables it per studio.
 */
export async function loadEnabledTeam(teamId: string): Promise<EnabledTeam> {
  const snap = await admin.firestore().collection(TEAMS_COLLECTION).doc(teamId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Team not found')
  const data = snap.data()!
  if (data.payments?.connectEnabled !== true) {
    throw new HttpsError('failed-precondition', 'Connect payments are not enabled for this team')
  }
  return {
    id: snap.id,
    plan: (data.plan as SaasPlan | undefined) ?? 'free',
    name: data.name as string | undefined,
    payments: data.payments,
    data,
  }
}

/** Resolve the team's connected account, requiring it be ready to accept charges. */
export function requireChargeableAccount(team: EnabledTeam): {
  accountId: string
  model: ConnectOnboardingModel
} {
  const accountId = team.payments?.connectAccountId
  const model = team.payments?.connectModel ?? 'managed'
  if (!accountId) {
    throw new HttpsError('failed-precondition', 'No payment account — finish onboarding first')
  }
  if (team.payments?.connectStatus !== 'enabled') {
    throw new HttpsError('failed-precondition', 'Payment account setup is not complete')
  }
  return { accountId, model }
}

/** Best-effort owner email for the Stripe account contact / Checkout prefill. */
export async function ownerEmail(uid: string, team: EnabledTeam): Promise<string> {
  const userDoc = await admin.firestore().collection('users').doc(uid).get()
  const email = userDoc.data()?.email as string | undefined
  return email ?? (team.data.contact_email as string | undefined) ?? ''
}

/** Settings → Payments return/refresh targets for the hosted onboarding flow. */
export function onboardingUrls(locale: string): { returnUrl: string; refreshUrl: string } {
  const base = `${getHostingUrl()}/${locale}/team/settings`
  return {
    returnUrl: `${base}?tab=payments&connect=return`,
    refreshUrl: `${base}?tab=payments&connect=refresh`,
  }
}

/** Persist a normalized account status to the canonical doc + compact team mirror. */
export async function persistAccountStatus(
  teamId: string,
  accountId: string,
  model: ConnectOnboardingModel,
  status: NormalizedAccountStatus
): Promise<void> {
  const db = admin.firestore()
  const now = FieldValue.serverTimestamp()
  await db
    .collection(CONNECT_ACCOUNTS_COLLECTION)
    .doc(accountId)
    .set(
      {
        teamId,
        stripeAccountId: accountId,
        model,
        status: status.status,
        charges_enabled: status.charges_enabled,
        payouts_enabled: status.payouts_enabled,
        details_submitted: status.details_submitted,
        capabilities: status.capabilities,
        requirements_currently_due: status.requirements_currently_due,
        requirements_disabled_reason: status.requirements_disabled_reason ?? null,
        default_currency: 'chf',
        updated_at: now,
      },
      { merge: true }
    )
  await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .set(
      {
        payments: {
          connectAccountId: accountId,
          connectModel: model,
          connectStatus: status.status,
        },
        updated_at: now,
      },
      { merge: true }
    )
}
