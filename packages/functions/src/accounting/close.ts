/* eslint-disable no-console */
// closeFiscalYear — rolls a fully-elapsed fiscal year's P&L into retained
// earnings (entry id close:{year}, deterministic ⇒ idempotent). Years close in
// SEQUENCE (no gaps) so cumulative balance-sheet math stays coherent; reopening
// = reversing the close entry (see reverseEntry).

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  buildClosingEntry,
  fiscalYearOf,
  monthKey,
} from '@linyup/shared'
import { assertOwner } from '../connect/access'
import { assertFinancePluginActive } from '../finance/access'
import { monthRange } from '../finance/monthlyReports'
import { fiscalYearEndPeriod } from '@linyup/shared'
import { accountingSettingsRef, accountsCollection, loadAccountingSettings } from './seed'
import { createEntry, recomputePeriodSummary, summariesCollection } from './store'

export const closeFiscalYear = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; fiscalYear?: number }
  if (!data?.teamId || !Number.isInteger(data?.fiscalYear)) {
    throw new HttpsError('invalid-argument', 'teamId and fiscalYear are required')
  }
  const { teamId } = data as { teamId: string }
  const fiscalYear = data.fiscalYear as number

  await assertOwner(request.auth.uid, teamId)
  await assertFinancePluginActive(teamId)
  const settings = await loadAccountingSettings(teamId)
  if (!settings) throw new HttpsError('failed-precondition', 'Accounting is not initialized for this team.')

  // The year must be fully elapsed.
  const currentFy = fiscalYearOf(monthKey(Date.now()), settings.fiscal_year_start_month)
  if (fiscalYear >= currentFy) {
    throw new HttpsError('failed-precondition', 'The fiscal year is not over yet.')
  }
  if (settings.closed_through_fiscal_year != null && fiscalYear <= settings.closed_through_fiscal_year) {
    throw new HttpsError('failed-precondition', 'This fiscal year is already closed.')
  }

  // No gaps: close in sequence, starting from the earliest year with entries.
  const summariesSnap = await summariesCollection(teamId).orderBy('period', 'asc').limit(1).get()
  if (summariesSnap.empty) throw new HttpsError('failed-precondition', 'Nothing to close.')
  const firstFy = fiscalYearOf(summariesSnap.docs[0].id, settings.fiscal_year_start_month)
  const expected = settings.closed_through_fiscal_year != null ? settings.closed_through_fiscal_year + 1 : firstFy
  if (fiscalYear !== expected) {
    throw new HttpsError('failed-precondition', `Close fiscal year ${expected} first (years close in sequence).`)
  }

  // Aggregate the FY's per-account totals from its period summaries.
  const fySummaries = await summariesCollection(teamId).where('fiscal_year', '==', fiscalYear).get()
  const totals: Record<string, { debit: number; credit: number }> = {}
  for (const doc of fySummaries.docs) {
    for (const [code, t] of Object.entries(doc.data().totals as Record<string, { debit: number; credit: number }>)) {
      const acc = (totals[code] ??= { debit: 0, credit: 0 })
      acc.debit += t.debit
      acc.credit += t.credit
    }
  }

  const accountsSnap = await accountsCollection(teamId).get()
  const accounts = accountsSnap.docs.map((d) => ({
    code: d.id,
    type: d.data().type as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  }))

  const endPeriod = fiscalYearEndPeriod(fiscalYear, settings.fiscal_year_start_month)
  const closeDateMs = monthRange(endPeriod).end.getTime() - 1 // last instant of the FY
  const entry = buildClosingEntry(fiscalYear, totals, accounts, settings, {
    dateMs: closeDateMs,
    createdBy: request.auth.uid,
  })
  if (!entry) throw new HttpsError('failed-precondition', 'No profit-and-loss activity to close.')
  entry.teamId = teamId

  try {
    await createEntry(entry)
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) {
      throw new HttpsError('failed-precondition', 'This fiscal year is already closed.')
    }
    throw err
  }
  await accountingSettingsRef(teamId).set({ closed_through_fiscal_year: fiscalYear }, { merge: true })
  await recomputePeriodSummary(teamId, endPeriod)
  console.log(`[accounting] fiscal year ${fiscalYear} closed team=${teamId}`)
  return { id: entry.id, period: endPeriod }
})
