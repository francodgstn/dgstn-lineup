/**
 * Backfill / reconcile the finance journal (teams/{id}/finance_transactions).
 *
 * Walks the existing payment records and (re)creates journal rows with the same
 * deterministic ids the webhooks use, so this script is FULLY RE-RUNNABLE: rows
 * that already exist are skipped (create() + ALREADY_EXISTS), which also makes
 * it the reconcile tool for webhook events that were missed or failed mid-way.
 *
 *   Pass A — Connect:  member_payments (succeeded/refunded/partially_refunded)
 *            → charge rows (fees fetched from the charge's balance transaction),
 *              refund rows (from the persisted refunds[]), dispute rows (best
 *              effort from the persisted dispute_* fields).
 *   Pass B — Payouts:  stripe.payouts.list per connected account → payout rows
 *            + payout_id linkage onto the swept charge rows.
 *   Pass C — BYO/manual: payment_events → fee-blind charge rows (no Stripe calls).
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use --skip-stripe.
 * Stripe: STRIPE_SECRET_KEY env var or --stripe-key (the platform key — charges
 * live on connected accounts and are read via the stripeAccount request option).
 *
 * Usage:
 *   tsx scripts/backfill-finance-journal.ts --project linyup-staging [--team t1]
 *       [--dry-run] [--skip-stripe] [--force-fees]
 *
 *   --dry-run     report what would be written, write nothing
 *   --skip-stripe no Stripe calls: Connect charge rows get fee_source 'recorded'
 *                 (platform fee from our record, Stripe fee 0); Pass B skipped
 *   --force-fees  re-fetch balance transactions and upgrade existing rows that
 *                 were written with fee_source 'recorded'
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import {
  CONNECT_ACCOUNTS_COLLECTION,
  FINANCE_TRANSACTIONS_SUBCOLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  buildConnectChargeTxn,
  buildConnectRefundTxn,
  buildExternalPaymentTxn,
  buildPayoutTxn,
  financeTxnId,
  type ConnectChargeFees,
  type FinanceTransactionInput,
} from '@linyup/shared'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'skip-stripe': { type: 'boolean', default: false },
    'force-fees': { type: 'boolean', default: false },
    'stripe-key': { type: 'string' },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)')
  process.exit(1)
}
const dryRun = values['dry-run'] === true
const skipStripe = values['skip-stripe'] === true
const forceFees = values['force-fees'] === true

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

const stripeKey = values['stripe-key'] ?? process.env.STRIPE_SECRET_KEY ?? null
if (!skipStripe && !stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY (or --stripe-key) is required unless --skip-stripe is set')
  process.exit(1)
}
const stripe = stripeKey ? new Stripe(stripeKey) : null

// ── Stripe rate limiting: ≤4 in-flight, exponential backoff on 429 ───────────
let inFlight = 0
const queue: Array<() => void> = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= 4) await new Promise<void>((resolve) => queue.push(resolve))
  inFlight += 1
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn()
      } catch (err: unknown) {
        const code = (err as { statusCode?: number; code?: string }).statusCode
        const type = (err as { type?: string }).type
        if ((code === 429 || type === 'StripeRateLimitError') && attempt < 5) {
          const wait = 500 * 2 ** attempt
          console.warn(`   ⏳ rate limited — retrying in ${wait}ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        throw err
      }
    }
  } finally {
    inFlight -= 1
    queue.shift()?.()
  }
}

const stats = { created: 0, existed: 0, feesUpgraded: 0, feeFetchFailed: 0, linked: 0, skipped: 0 }

function txnRef(teamId: string, txnId: string) {
  return db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
    .doc(txnId)
}

/** Mirror of functions/src/finance/journal.ts toDoc — scripts must not import
 * from @linyup/functions (not a published workspace lib). */
function toDoc(input: FinanceTransactionInput): Record<string, unknown> {
  const { occurred_at_ms, payout_arrival_date_ms, ...rest } = input
  return {
    ...rest,
    occurred_at: Timestamp.fromMillis(occurred_at_ms),
    recorded_at: FieldValue.serverTimestamp(),
    status: 'recorded',
    payout_id: input.payout_id ?? null,
    ...(payout_arrival_date_ms != null
      ? { payout_arrival_date: Timestamp.fromMillis(payout_arrival_date_ms) }
      : {}),
  }
}

async function writeTxn(input: FinanceTransactionInput): Promise<boolean> {
  if (dryRun) {
    stats.created += 1
    return true
  }
  try {
    await txnRef(input.teamId, input.id).create(toDoc(input))
    stats.created += 1
    return true
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) {
      stats.existed += 1
      return false
    }
    throw err
  }
}

async function fetchChargeFees(accountId: string, chargeId: string): Promise<ConnectChargeFees | null> {
  if (!stripe || skipStripe) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge: any = await limited(() =>
      stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] }, { stripeAccount: accountId })
    )
    const bt = charge?.balance_transaction
    if (!bt || typeof bt !== 'object' || typeof bt.net !== 'number') return null
    let stripeFee = 0
    let applicationFee: number | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const fd of (bt.fee_details ?? []) as any[]) {
      if (fd.type === 'stripe_fee') stripeFee += fd.amount ?? 0
      else if (fd.type === 'application_fee') applicationFee = (fd.amount ?? 0) + (applicationFee ?? 0)
    }
    if (stripeFee === 0 && applicationFee == null && typeof bt.fee === 'number') stripeFee = bt.fee
    return { stripeFee, applicationFee, net: bt.net, balanceTxnId: bt.id }
  } catch (err) {
    stats.feeFetchFailed += 1
    console.warn(`   ⚠ fee fetch failed charge=${chargeId}:`, (err as Error).message)
    return null
  }
}

// ── Pass A: Connect member_payments ──────────────────────────────────────────
async function backfillConnect(teamId: string, accountId: string | null): Promise<void> {
  const snap = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
    .where('status', 'in', ['succeeded', 'refunded', 'partially_refunded'])
    .get()

  for (const doc of snap.docs) {
    const p = doc.data()
    const piId = (p.paymentIntentId as string) ?? doc.id
    const chargeId = (p.chargeId as string | undefined) ?? null
    const occurredAtMs =
      (p.created_at as Timestamp | undefined)?.toMillis() ?? Date.now()

    const chargeTxnId = financeTxnId('connect', 'charge', piId)
    const existing = await txnRef(teamId, chargeTxnId).get()

    let fees: ConnectChargeFees | null = null
    const needsFees =
      !existing.exists || (forceFees && existing.data()?.fee_source !== 'balance_transaction')
    if (needsFees && accountId && chargeId) fees = await fetchChargeFees(accountId, chargeId)

    if (!existing.exists) {
      await writeTxn(
        buildConnectChargeTxn({
          teamId,
          paymentIntentId: piId,
          amount: (p.amount as number) ?? 0,
          currency: p.currency as string | undefined,
          applicationFeeAmount: (p.application_fee_amount as number) ?? 0,
          fees,
          kind: (p.kind as string | undefined) ?? null,
          contactId: (p.contactId as string | undefined) ?? null,
          description:
            (p.comment as string | undefined) ??
            (p.subscriptionTypeName as string | undefined) ??
            (p.productName as string | undefined) ??
            (p.courseName as string | undefined) ??
            null,
          occurredAtMs,
          eventId: 'backfill',
        })
      )
    } else if (forceFees && fees && existing.data()?.fee_source !== 'balance_transaction') {
      if (!dryRun) {
        const d = existing.data()!
        const platformFeeAbs = fees.applicationFee ?? -(d.platform_fee as number)
        await existing.ref.update({
          stripe_fee: fees.stripeFee === 0 ? 0 : -fees.stripeFee,
          platform_fee: platformFeeAbs === 0 ? 0 : -platformFeeAbs,
          net: fees.net,
          fee_source: 'balance_transaction',
          balance_txn_id: fees.balanceTxnId,
        })
      }
      stats.feesUpgraded += 1
    } else if (existing.exists) {
      // Sync late-resolved contact linkage (checkout stamped after the webhook row).
      const rowContact = existing.data()?.contact_id ?? null
      if (!rowContact && p.contactId && !dryRun) {
        await existing.ref.update({ contact_id: p.contactId })
        stats.linked += 1
      }
      stats.existed += 1
    }

    // Refund rows from the persisted refunds[] (feeReversed already computed).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((p.refunds ?? []) as any[])) {
      if (!r?.refundId || !r?.amount) continue
      await writeTxn(
        buildConnectRefundTxn({
          teamId,
          refundId: r.refundId,
          paymentIntentId: piId,
          amount: r.amount,
          feeReversed: r.feeReversed ?? 0,
          currency: p.currency as string | undefined,
          kind: (p.kind as string | undefined) ?? null,
          contactId: (p.contactId as string | undefined) ?? null,
          occurredAtMs: (r.created_at as Timestamp | undefined)?.toMillis() ?? occurredAtMs,
          eventId: 'backfill',
        })
      )
    }
  }
  console.log(`   pass A (connect): ${snap.size} payments walked`)
}

// ── Pass B: payouts per connected account ─────────────────────────────────────
async function backfillPayouts(teamId: string, accountId: string): Promise<void> {
  if (!stripe || skipStripe) return
  let startingAfter: string | undefined
  let count = 0
  for (let page = 0; page < 50; page += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any = await limited(() =>
      stripe.payouts.list(
        { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        { stripeAccount: accountId }
      )
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const po of (list.data ?? []) as any[]) {
      if (po.status !== 'paid' && po.status !== 'failed') continue
      count += 1
      await writeTxn(
        buildPayoutTxn({
          teamId,
          payoutId: po.id,
          amount: po.amount ?? 0,
          kind: po.status === 'failed' ? 'failed' : 'paid',
          currency: po.currency,
          occurredAtMs: typeof po.created === 'number' ? po.created * 1000 : Date.now(),
          arrivalDateMs: typeof po.arrival_date === 'number' ? po.arrival_date * 1000 : null,
          eventId: 'backfill',
        })
      )
      if (po.status !== 'paid' || dryRun) continue

      // Linkage: stamp payout_id onto the journal rows the payout swept.
      let btAfter: string | undefined
      for (let btPage = 0; btPage < 20; btPage += 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bts: any = await limited(() =>
          stripe.balanceTransactions.list(
            { payout: po.id, limit: 100, ...(btAfter ? { starting_after: btAfter } : {}) },
            { stripeAccount: accountId }
          )
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const bt of (bts.data ?? []) as any[]) {
          if (bt.type === 'payout') continue
          const rows = await db
            .collection(TEAMS_COLLECTION)
            .doc(teamId)
            .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
            .where('balance_txn_id', '==', bt.id)
            .get()
          for (const row of rows.docs) {
            if (row.data().payout_id !== po.id) {
              await row.ref.update({ payout_id: po.id })
              stats.linked += 1
            }
          }
        }
        if (!bts.has_more || !bts.data?.length) break
        btAfter = bts.data[bts.data.length - 1].id
      }
    }
    if (!list.has_more || !list.data?.length) break
    startingAfter = list.data[list.data.length - 1].id
  }
  console.log(`   pass B (payouts): ${count} payouts walked`)
}

// ── Pass C: BYO/manual payment_events ─────────────────────────────────────────
async function backfillExternal(teamId: string): Promise<void> {
  const snap = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(PAYMENT_EVENTS_SUBCOLLECTION)
    .get()
  for (const doc of snap.docs) {
    const p = doc.data()
    const gateway = p.gateway as 'payrexx' | 'stripe' | 'manual' | undefined
    const amount = p.amount as number | null
    if (!gateway || !amount || amount <= 0) {
      stats.skipped += 1
      continue
    }
    await writeTxn(
      buildExternalPaymentTxn({
        teamId,
        gateway,
        gatewayRef: (p.gatewayRef as string) ?? doc.id.split(':').slice(1).join(':'),
        amount,
        currency: p.currency as string | undefined,
        contactId: (p.contact_id as string | undefined) ?? null,
        lineItemKind: (p.line_item?.kind as string | undefined) ?? (p.subscription_type_id ? 'subscription' : null),
        description: (p.comment as string | undefined) ?? (p.line_item?.label as string | undefined) ?? null,
        occurredAtMs: (p.processed_at as Timestamp | undefined)?.toMillis() ?? Date.now(),
        eventId: 'backfill',
      })
    )
  }
  console.log(`   pass C (byo/manual): ${snap.size} payment events walked`)
}

async function main() {
  console.log(
    `\n🔧 Finance-journal backfill on '${values.project}' ${dryRun ? '(DRY-RUN)' : '(APPLY)'}` +
      `${skipStripe ? ' [skip-stripe]' : ''}${forceFees ? ' [force-fees]' : ''}\n`
  )

  let teamsQuery = db.collection(TEAMS_COLLECTION) as FirebaseFirestore.Query
  if (values.team) teamsQuery = teamsQuery.where(admin.firestore.FieldPath.documentId(), '==', values.team)
  const teams = await teamsQuery.get()

  for (const teamDoc of teams.docs) {
    const team = teamDoc.data()
    if (team.archived_at) continue
    const teamId = teamDoc.id

    // Resolve the connected account (pointer on the team; fall back to reverse lookup).
    let accountId = (team.payments?.connectAccountId as string | undefined) ?? null
    if (!accountId) {
      const acctSnap = await db
        .collection(CONNECT_ACCOUNTS_COLLECTION)
        .where('teamId', '==', teamId)
        .limit(1)
        .get()
      accountId = acctSnap.empty ? null : acctSnap.docs[0].id
    }

    console.log(`▶ team ${teamId} (${team.name ?? '?'})${accountId ? ` acct=${accountId}` : ''}`)
    await backfillConnect(teamId, accountId)
    if (accountId) await backfillPayouts(teamId, accountId)
    await backfillExternal(teamId)
  }

  console.log(
    `\n✅ Done. created=${stats.created} existed=${stats.existed} feesUpgraded=${stats.feesUpgraded}` +
      ` linked=${stats.linked} feeFetchFailed=${stats.feeFetchFailed} skipped=${stats.skipped}`
  )
  if (dryRun) console.log('   Dry-run — re-run without --dry-run to write.\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill failed:', err)
    process.exit(1)
  })
