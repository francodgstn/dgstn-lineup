// THE ONE IMPLEMENTATION OF "erase this tenant".
//
// It lives in its own module for the same reason `downgrade.ts` does: callers
// outside the billing package need it, and importing `saas-billing/index.ts` —
// a module whose top level REGISTERS every billing function — drags the whole
// Cloud Functions runtime along with it. The caller that forced the move is
// `scripts/purge-team.ts`, the CLI that finally gave this function an
// invocation path (it had none: not re-exported from the functions entrypoint,
// no callable, no script — so seven of the twelve boxes in
// `docs/launch/data-safety-checklist.md` §3 described something nobody could
// run).
//
// Deliberately a SCRIPT and not a callable: a callable would be new public
// attack surface for a function whose entire purpose is irreversible deletion,
// and the operator already has a shell.
//
// Callers: `saas-billing/index.ts` (re-export, for back-compat with anything
// importing it from there) and `scripts/purge-team.ts`.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  TENANT_DATA_COLLECTIONS,
  TENANT_TEAM_DOC_COLLECTION,
  tenantStoragePrefix,
} from '@linyup/shared'

/**
 * Hard-delete every team-scoped record (Firestore + Storage). Keeps Auth users.
 * When `dryRun` is true, NOTHING is deleted — it only logs what it would remove
 * (counts per collection).
 *
 * The set of tenant-scoped collections is driven by TENANT_DATA_COLLECTIONS in
 * `@linyup/shared` (the single source of truth, guarded by a completeness test)
 * so a newly added tenant collection is purged automatically once registered.
 * NEVER hand-copy that list into a caller — the copies go stale.
 *
 * DORMANT as a schedule (the 90-day trial purge was retired when lapsed trials
 * began downgrading to Free). Kept as the manual GDPR / account-deletion (and
 * QA "reset account") utility.
 *
 * NOTE: this removes Firestore + Storage only. Provider-side state for entries
 * flagged `externalTeardown` (e.g. the Stripe Connect account + its member
 * subscriptions) must be cancelled/disconnected separately — a warning is logged.
 */
export async function purgeTeam(teamId: string, dryRun: boolean): Promise<void> {
  const db = admin.firestore()
  const tag = dryRun ? '[purge][dry-run]' : '[purge]'

  for (const entry of TENANT_DATA_COLLECTIONS) {
    if (entry.match.by === 'field') {
      const q = db.collection(entry.collection).where(entry.match.field, '==', teamId)
      if (dryRun) {
        const c = await q.count().get()
        console.log(`${tag} team ${teamId}: would delete ${c.data().count} ${entry.collection}`)
      } else {
        const snap = await q.get()
        for (const d of snap.docs) await db.recursiveDelete(d.ref)
      }
    } else {
      // doc id IS the teamId
      const ref = db.collection(entry.collection).doc(teamId)
      if (dryRun) {
        const exists = (await ref.get()).exists
        console.log(
          `${tag} team ${teamId}: would delete ${exists ? 1 : 0} ${entry.collection}/${teamId}`
        )
      } else {
        await db.recursiveDelete(ref)
      }
    }
    if (entry.externalTeardown === 'stripe_connect') {
      console.warn(
        `${tag} team ${teamId}: ${entry.collection} removed from Firestore — the Stripe Connect ` +
          `account & its member subscriptions still require provider-side teardown (cancel/disconnect).`
      )
    }
    if (entry.externalTeardown === 'cloudflare_hostname') {
      console.warn(
        `${tag} team ${teamId}: ${entry.collection} removed from Firestore — the Cloudflare custom ` +
          `hostname still exists and keeps serving (and billing). Delete it in the Cloudflare zone.`
      )
    }
  }

  if (dryRun) {
    console.log(
      `${tag} team ${teamId}: would recursively delete ${TENANT_TEAM_DOC_COLLECTION}/${teamId} ` +
        `(doc + all subcollections) and Storage ${tenantStoragePrefix(teamId)}`
    )
    return
  }

  // Team doc + ALL its subcollections (team_members, installed_plugins,
  // integrations, subscription_types, products, member_payments/subscriptions, …).
  await db.recursiveDelete(db.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId))

  // Team Storage files.
  try {
    await admin.storage().bucket().deleteFiles({ prefix: tenantStoragePrefix(teamId) })
  } catch (err) {
    console.error(`${tag} storage cleanup failed for ${teamId}:`, err)
  }

  // Audit trail (best-effort; never block the purge on it).
  await db
    .collection('team_audits')
    .add({ action: 'purge_team', teamId, at: FieldValue.serverTimestamp() })
    .catch((err) => console.error(`${tag} audit write failed for ${teamId}:`, err))
}
