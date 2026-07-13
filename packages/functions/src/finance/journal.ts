/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Finance journal writers — the ONLY module that writes finance_transactions.
//
// Journal writing is CORE INFRASTRUCTURE: always on for every team, never gated
// by the finance plugin (the plugin gates export/UI, not data capture). Rows are
// written inline from the webhooks/callables that already know the money event —
// see types/finance.ts in @linyup/shared for the full architecture note.
//
// Every writer is idempotent (deterministic doc ids + create()) and every hook
// site wraps the call in try/catch: a journal failure must NEVER break payment
// processing. Missed rows are reconciled by scripts/backfill-finance-journal.ts.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  FINANCE_TRANSACTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  type ConnectChargeFees,
  type FinanceTransactionInput,
} from '@linyup/shared'
import { getConnectStripe } from '../utils/connect/client'

function txnRef(teamId: string, txnId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
    .doc(txnId)
}

/** Builder output → Firestore doc (Timestamps + status + recorded_at). */
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

/**
 * Append a journal row. Returns false when the row already existed (webhook
 * retry / duplicate delivery / backfill re-run) — never an error.
 */
export async function recordFinanceTransaction(input: FinanceTransactionInput): Promise<boolean> {
  try {
    await txnRef(input.teamId, input.id).create(toDoc(input))
    return true
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) return false // ALREADY_EXISTS
    throw err
  }
}

/**
 * Upgrade a degraded row's fee breakdown (fee_source 'recorded' → the
 * authoritative balance-transaction split). The ONLY financial-field mutation the
 * journal permits, and only while fee_source !== 'balance_transaction'. Used by
 * the backfill's --force-fees pass. Returns false when no upgrade applied.
 */
export async function upgradeFees(
  teamId: string,
  txnId: string,
  fees: ConnectChargeFees
): Promise<boolean> {
  const ref = txnRef(teamId, txnId)
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const d = snap.data()!
    if (d.fee_source === 'balance_transaction') return false
    const gross = d.gross as number
    const platformFeeAbs = fees.applicationFee ?? -(d.platform_fee as number)
    tx.update(ref, {
      stripe_fee: -fees.stripeFee,
      platform_fee: -platformFeeAbs,
      net: fees.net,
      fee_source: 'balance_transaction',
      balance_txn_id: fees.balanceTxnId,
    })
    // Sanity log only — Stripe's split is authoritative even if our recorded
    // platform fee disagreed.
    if (gross - fees.stripeFee - platformFeeAbs !== fees.net) {
      console.warn(`[finance] upgradeFees ${teamId}/${txnId}: balance txn does not tie to gross`)
    }
    return true
  })
}

/**
 * Heal a degraded charge row once its balance transaction exists. Async payment
 * methods (TWINT, …) have no balance transaction at payment_intent.succeeded
 * time, so their row was written with fee_source 'recorded' (Stripe fee 0);
 * Stripe emits charge.updated the moment balance_transaction is populated —
 * fetch the authoritative split and upgrade the row in place (which also gives
 * it the balance_txn_id needed for payout linkage). onFinanceTransactionWrite
 * re-posts the accounting entry automatically. No-ops when the row is missing
 * (charge.updated raced ahead of payment_intent.succeeded — the initial write
 * will then enrich directly) or already authoritative.
 */
export async function upgradeChargeFeesIfDegraded(
  teamId: string,
  accountId: string,
  paymentIntentId: string,
  chargeId: string
): Promise<boolean> {
  const txnId = `connect:charge:${paymentIntentId}`
  const snap = await txnRef(teamId, txnId).get()
  if (!snap.exists || snap.data()?.fee_source === 'balance_transaction') return false
  const fees = await retrieveChargeFees(accountId, chargeId)
  if (!fees) return false
  return upgradeFees(teamId, txnId, fees)
}

/** Non-financial metadata linkage: stamp the contact onto an existing charge row
 * (checkout handlers resolve the buyer AFTER payment_intent.succeeded fired).
 * No-op when the row doesn't exist yet — the backfill reconciles from the
 * member_payments doc, which carries the final contactId. */
export async function linkFinanceTxnContact(
  teamId: string,
  txnId: string,
  contactId: string
): Promise<void> {
  try {
    await txnRef(teamId, txnId).update({ contact_id: contactId })
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 5) return // NOT_FOUND — row not written yet
    throw err
  }
}

/** Payout linkage: stamp payout_id onto the charge rows whose balance
 * transactions the payout swept. Metadata only — never touches amounts. */
export async function linkFinanceTxnPayout(
  teamId: string,
  balanceTxnId: string,
  payoutId: string
): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
    .where('balance_txn_id', '==', balanceTxnId)
    .get()
  let linked = 0
  for (const doc of snap.docs) {
    if (doc.data().payout_id !== payoutId) {
      await doc.ref.update({ payout_id: payoutId })
      linked += 1
    }
  }
  return linked
}

/**
 * Fetch the authoritative gross/fee/net split for a Connect direct charge from
 * its balance transaction (on the CONNECTED account, whose fee_details carries
 * BOTH the Stripe processing fee and the application fee). Returns null on any
 * failure — callers record the row with fee_source 'recorded' instead; never
 * drop a row because the enrichment call failed.
 */
export async function retrieveChargeFees(
  accountId: string,
  chargeId: string
): Promise<ConnectChargeFees | null> {
  try {
    const stripe = await getConnectStripe()
    const charge: any = await stripe.charges.retrieve(
      chargeId,
      { expand: ['balance_transaction'] },
      { stripeAccount: accountId }
    )
    const bt: any = charge?.balance_transaction
    if (!bt || typeof bt !== 'object' || typeof bt.net !== 'number') {
      // Async payment methods (TWINT, …) have NO balance transaction yet when
      // payment_intent.succeeded fires — this is expected, not an error. The
      // charge.updated healer (upgradeChargeFeesIfDegraded) fixes the row once
      // Stripe populates it. Log so degraded rows are diagnosable.
      console.warn(
        `[finance] balance transaction not available yet (charge=${chargeId}) — recording without Stripe fee`
      )
      return null
    }
    let stripeFee = 0
    let applicationFee: number | null = null
    for (const fd of (bt.fee_details ?? []) as any[]) {
      if (fd.type === 'stripe_fee') stripeFee += (fd.amount as number) ?? 0
      else if (fd.type === 'application_fee') applicationFee = ((fd.amount as number) ?? 0) + (applicationFee ?? 0)
    }
    // fee_details absent/opaque → fall back to the aggregate fee as Stripe fee.
    if (stripeFee === 0 && applicationFee == null && typeof bt.fee === 'number') stripeFee = bt.fee
    return { stripeFee, applicationFee, net: bt.net as number, balanceTxnId: bt.id as string }
  } catch (err) {
    console.warn(`[finance] balance-transaction fetch failed (charge=${chargeId}):`, err)
    return null
  }
}
