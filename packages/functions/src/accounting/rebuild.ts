/* eslint-disable no-console */
// rebuildAccountingLedger — the accounting module's primary correctness
// mechanism: replay the ENTIRE finance journal into accounting entries.
//
// Deterministic entry ids make the replay a pure overwrite of `txn:*` entries;
// manual:/rev:/close: entries are never touched. Handles: plugin installed
// after journal history exists, uninstall/reinstall, posting-map changes, and
// trigger failures. Runs on install (onInstalledPluginStatusChange) and from
// the "Rebuild ledger" button.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  FINANCE_TRANSACTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  buildEntryFromFinanceTxn,
  type FinanceTransaction,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { assertFinancePluginActive } from '../finance/access'
import { toPostable } from './onFinanceTransactionWrite'
import { accountingSettingsRef, ensureAccountingSeeded } from './seed'
import { entriesCollection, entryToDoc, recomputePeriodSummary, summariesCollection } from './store'

const PAGE_SIZE = 300

export async function rebuildLedgerForTeam(
  teamId: string
): Promise<{ entries_written: number; skipped_foreign_currency: number }> {
  const db = admin.firestore()
  const runId = `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const settings = await ensureAccountingSeeded(teamId)

  let entriesWritten = 0
  let skipped = 0
  const dirtyPeriods = new Set<string>()

  // Pass 1: replay every journal row into its txn:* entry (BulkWriter batches).
  let writer = db.bulkWriter()
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let q = db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
      .orderBy('occurred_at', 'asc')
      .limit(PAGE_SIZE)
    if (last) q = q.startAfter(last)
    const page = await q.get()
    if (page.empty) break

    for (const doc of page.docs) {
      const txn = doc.data() as FinanceTransaction
      if (txn.status === 'corrected') continue // its reversal entry already exists; leave as-is
      const entry = buildEntryFromFinanceTxn(toPostable(teamId, txn), settings)
      if (!entry) {
        if (txn.gross !== 0 || txn.net !== 0) skipped += 1
        continue
      }
      void writer.set(entriesCollection(teamId).doc(entry.id), entryToDoc(entry, { rebuildRunId: runId }))
      entriesWritten += 1
      dirtyPeriods.add(entry.period)
    }
    last = page.docs[page.docs.length - 1]
    if (page.size < PAGE_SIZE) break
  }
  await writer.close()

  // Pass 2: recompute every affected period — plus every existing summary (a
  // remapped posting can empty a month, and manual entries live in months the
  // journal never touched).
  const existing = await summariesCollection(teamId).get()
  for (const doc of existing.docs) dirtyPeriods.add(doc.id)
  // Manual/closing entries may sit in periods with no summary yet (edge: crash
  // between entry write and recompute) — sweep their periods too.
  const manualPeriods = await entriesCollection(teamId).where('source', '!=', 'auto').get()
  for (const doc of manualPeriods.docs) dirtyPeriods.add(doc.data().period as string)

  for (const period of dirtyPeriods) {
    await recomputePeriodSummary(teamId, period)
  }

  await accountingSettingsRef(teamId).set(
    {
      last_rebuild: {
        at: FieldValue.serverTimestamp(),
        entries_written: entriesWritten,
        skipped_foreign_currency: skipped,
        run_id: runId,
      },
    },
    { merge: true }
  )
  console.log(
    `[accounting] rebuild team=${teamId} run=${runId}: ${entriesWritten} entries, ${dirtyPeriods.size} periods, ${skipped} foreign-currency skipped`
  )
  return { entries_written: entriesWritten, skipped_foreign_currency: skipped }
}

export const rebuildAccountingLedger = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
    const teamId = (request.data as { teamId?: string })?.teamId
    if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
    await assertManager(request.auth.uid, teamId)
    await assertFinancePluginActive(teamId)
    return rebuildLedgerForTeam(teamId)
  }
)
