/* eslint-disable no-console */
// Accounting entry store + period summaries — the ONLY module that writes
// accounting_entries and accounting_period_summaries.
//
// Summaries hold per-account debit/credit totals over ALL of a month's entries
// (a reversed entry and its reversal both stay in and cancel). They are
// recomputed inside a Firestore TRANSACTION: two finance transactions landing
// in the same month trigger concurrent recomputes, and a plain read-then-write
// would lose one update. The rebuild fixes any residual drift, but known lost
// updates are not acceptable as a design.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  ACCOUNTING_ENTRIES_SUBCOLLECTION,
  ACCOUNTING_PERIOD_SUMMARIES_SUBCOLLECTION,
  TEAMS_COLLECTION,
  fiscalYearOf,
  type AccountingEntryInput,
} from '@linyup/shared'

export function entriesCollection(teamId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACCOUNTING_ENTRIES_SUBCOLLECTION)
}

export function summariesCollection(teamId: string) {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACCOUNTING_PERIOD_SUMMARIES_SUBCOLLECTION)
}

/** Engine output → Firestore doc. */
export function entryToDoc(
  input: AccountingEntryInput,
  extra: { rebuildRunId?: string | null } = {}
): Record<string, unknown> {
  const { date_ms, ...rest } = input
  return {
    ...rest,
    finance_txn_id: input.finance_txn_id ?? null,
    reverses: input.reverses ?? null,
    date: Timestamp.fromMillis(date_ms),
    status: 'posted',
    reversed_by: null,
    created_at: FieldValue.serverTimestamp(),
    rebuild_run_id: extra.rebuildRunId ?? null,
  }
}

/**
 * Upsert an AUTO entry (deterministic id — replay-safe pure overwrite). Skips
 * the write when an identical entry already exists (e.g. a payout_id linkage
 * mutation re-fired the journal trigger) and reports whether the period's
 * summary needs a recompute.
 */
export async function upsertAutoEntry(
  input: AccountingEntryInput,
  rebuildRunId?: string | null
): Promise<{ changed: boolean }> {
  const ref = entriesCollection(input.teamId).doc(input.id)
  const existing = await ref.get()
  if (existing.exists) {
    const d = existing.data()!
    const same =
      d.period === input.period &&
      d.total_debit === input.total_debit &&
      d.total_credit === input.total_credit &&
      JSON.stringify(d.lines) === JSON.stringify(input.lines)
    if (same) return { changed: false }
  }
  await ref.set(entryToDoc(input, { rebuildRunId }))
  return { changed: true }
}

/** Create-only write for manual/reversal/closing entries (immutable). Throws
 * ALREADY_EXISTS through to the caller — deterministic ids make that the
 * idempotency signal, not an error. */
export async function createEntry(input: AccountingEntryInput): Promise<void> {
  await entriesCollection(input.teamId).doc(input.id).create(entryToDoc(input))
}

/**
 * Transactionally recompute one month's per-account totals from its entries.
 */
export async function recomputePeriodSummary(teamId: string, period: string): Promise<void> {
  const db = admin.firestore()
  await db.runTransaction(async (tx) => {
    const entriesSnap = await tx.get(entriesCollection(teamId).where('period', '==', period))
    const totals: Record<string, { debit: number; credit: number }> = {}
    let fiscalYear = fiscalYearOf(period)
    for (const doc of entriesSnap.docs) {
      const e = doc.data()
      fiscalYear = (e.fiscal_year as number) ?? fiscalYear
      for (const l of (e.lines ?? []) as Array<{ account_code: string; debit: number; credit: number }>) {
        const t = (totals[l.account_code] ??= { debit: 0, credit: 0 })
        t.debit += l.debit ?? 0
        t.credit += l.credit ?? 0
      }
    }
    const ref = summariesCollection(teamId).doc(period)
    if (entriesSnap.empty) {
      tx.delete(ref)
    } else {
      tx.set(ref, {
        teamId,
        period,
        fiscal_year: fiscalYear,
        totals,
        entry_count: entriesSnap.size,
        computed_at: FieldValue.serverTimestamp(),
      })
    }
  })
}
