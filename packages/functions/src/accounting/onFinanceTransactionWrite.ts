/* eslint-disable no-console */
// onFinanceTransactionWrite — incremental posting: every finance-journal write
// folds into its accounting entry while the finance plugin is active.
//
// Why a trigger (not inline in the webhooks): the journal has many writers
// (Connect webhook, two BYO webhooks, recordManualPayment, the backfill
// script) — this is the single choke-point that catches them all, including
// the backfill, with zero coupling into Part-A code. Deterministic entry ids
// (txn:{journalId}) make every write a replay-safe pure overwrite; the
// rebuildAccountingLedger callable is the primary correctness mechanism for
// anything the trigger missed (plugin installed later, transient failures).

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  buildEntryFromFinanceTxn,
  buildReversalEntry,
  monthKey,
  type FinanceTransaction,
  type PostableFinanceTxn,
} from '@linyup/shared'
import { isFinancePluginActive } from '../finance/access'
import { loadAccountingSettings } from './seed'
import { createEntry, entriesCollection, recomputePeriodSummary, upsertAutoEntry } from './store'

/** Stored journal doc → the pure engine's input shape. */
export function toPostable(teamId: string, txn: FinanceTransaction): PostableFinanceTxn {
  return {
    id: txn.id,
    teamId,
    type: txn.type,
    source: txn.source,
    category: txn.category,
    currency: txn.currency,
    gross: txn.gross,
    stripe_fee: txn.stripe_fee,
    platform_fee: txn.platform_fee,
    net: txn.net,
    occurred_at_ms: txn.occurred_at.toMillis(),
    month: txn.month,
    description: txn.description ?? null,
  }
}

export const onFinanceTransactionWrite = onDocumentWritten(
  'teams/{teamId}/finance_transactions/{txnId}',
  async (event) => {
    const { teamId } = event.params
    if (!event.data?.after.exists) return // journal rows are never deleted in practice

    if (!(await isFinancePluginActive(teamId))) return
    const settings = await loadAccountingSettings(teamId)
    if (!settings) return // not yet seeded — the install hook's rebuild will catch up

    const txn = event.data.after.data() as FinanceTransaction
    const before = event.data.before.exists ? (event.data.before.data() as FinanceTransaction) : null

    try {
      const dirtyPeriods = new Set<string>()

      if (txn.status === 'recorded') {
        const entry = buildEntryFromFinanceTxn(toPostable(teamId, txn), settings)
        if (entry) {
          const { changed } = await upsertAutoEntry(entry)
          if (changed) dirtyPeriods.add(entry.period)
        } else if (txn.gross !== 0 || txn.net !== 0) {
          console.log(`[accounting] skipped foreign-currency txn ${txn.id} (team=${teamId})`)
        }
      } else if (txn.status === 'corrected' && before?.status !== 'corrected') {
        // The journal row was superseded by a compensating adjustment row —
        // reverse its entry (dated now; the correcting row posts on its own).
        const entryId = `txn:${txn.id}`
        const entrySnap = await entriesCollection(teamId).doc(entryId).get()
        if (entrySnap.exists && entrySnap.data()?.status === 'posted') {
          const e = entrySnap.data()!
          const nowMs = Date.now()
          const period = monthKey(nowMs)
          const reversal = buildReversalEntry(
            { id: entryId, teamId, description: e.description as string, currency: e.currency as string, lines: e.lines },
            {
              id: `${entryId}:rev`,
              dateMs: nowMs,
              period,
              fiscalYearStartMonth: settings.fiscal_year_start_month,
              createdBy: 'system',
            }
          )
          try {
            await createEntry(reversal)
            await entrySnap.ref.update({ status: 'reversed', reversed_by: reversal.id })
            dirtyPeriods.add(period)
            dirtyPeriods.add(e.period as string)
          } catch (err: unknown) {
            if ((err as { code?: number }).code !== 6) throw err // exists = already reversed
          }
        }
      }

      for (const period of dirtyPeriods) {
        await recomputePeriodSummary(teamId, period)
      }
    } catch (err) {
      console.error(`[accounting] posting failed team=${teamId} txn=${event.params.txnId}:`, err)
    }
  }
)
