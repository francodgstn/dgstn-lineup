/**
 * Shared Stripe Connect wiring for the dev/seed scripts.
 *
 * Writes the two Firestore docs the "pay with Linyup" (member → studio) flow reads:
 *   • connect_accounts/{acct}       — the webhook's account → team map + status mirror
 *   • teams/{teamId}.payments       — the compact mirror checkout gates on
 *     (requireChargeableAccount() needs connectStatus === 'enabled')
 *
 * No Stripe call by default: it TRUSTS that the given acct_ id is an already-onboarded
 * TEST account and marks it chargeable (ASSUMED_ENABLED). Pass a real status (fetched
 * from Stripe) to override. The actual charge later runs against the real Stripe test
 * account via the Functions, so the acct must genuinely be onboarded.
 */
import type admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION, CONNECT_ACCOUNTS_COLLECTION } from '@linyup/shared'

export type ConnectModel = 'byo' | 'managed'

export interface ConnectStatus {
  status: 'pending' | 'restricted' | 'enabled' | 'rejected'
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  capabilities: Record<string, string>
  requirements_currently_due: string[]
}

/** Force-enabled status for a known-onboarded test account (no Stripe call). */
export const ASSUMED_ENABLED: ConnectStatus = {
  status: 'enabled',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: 'active', twint_payments: 'active' },
  requirements_currently_due: [],
}

/** Wire a Stripe connected account to a team (both docs). Idempotent (merge). */
export async function linkConnectAccount(params: {
  db: admin.firestore.Firestore
  teamId: string
  accountId: string
  model?: ConnectModel
  status?: ConnectStatus
}): Promise<void> {
  const { db, teamId, accountId } = params
  const model = params.model ?? 'managed'
  const status = params.status ?? ASSUMED_ENABLED
  const now = FieldValue.serverTimestamp()

  // 1) connect_accounts/{acct} — account → team map + status mirror.
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
        requirements_disabled_reason: null,
        default_currency: 'chf',
        updated_at: now,
        created_at: now,
      },
      { merge: true }
    )

  // 2) teams/{teamId}.payments — compact mirror checkout + dashboard read.
  await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .set(
      { payments: { connectEnabled: true, connectAccountId: accountId, connectModel: model, connectStatus: status.status } },
      { merge: true }
    )
}
