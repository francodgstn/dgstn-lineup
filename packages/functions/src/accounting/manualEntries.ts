/* eslint-disable no-console */
// Manual accounting entries — owner-only (financial records; managers read).
// createManualEntry: opening balances, corrections, BYO gateway-fee bookings.
// reverseEntry: THE correction mechanism — entries are never edited or deleted.

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  buildReversalEntry,
  fiscalYearOf,
  monthKey,
  validateManualEntryInput,
  type AccountingEntryInput,
  type ManualEntryInput,
} from '@linyup/shared'
import { assertOwner } from '../connect/access'
import { assertFinancePluginActive } from '../finance/access'
import { accountingSettingsRef, accountsCollection, loadAccountingSettings } from './seed'
import { createEntry, entriesCollection, recomputePeriodSummary } from './store'

export const createManualEntry = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as {
    teamId?: string
    dateMs?: number
    description?: string
    lines?: Array<{ account_code?: string; debit?: number; credit?: number; description?: string | null }>
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  const teamId = data.teamId

  await assertOwner(request.auth.uid, teamId)
  await assertFinancePluginActive(teamId)
  const settings = await loadAccountingSettings(teamId)
  if (!settings) throw new HttpsError('failed-precondition', 'Accounting is not initialized for this team.')

  const input: ManualEntryInput = {
    dateMs: typeof data.dateMs === 'number' ? data.dateMs : Date.now(),
    description: (data.description ?? '').toString().trim(),
    lines: (Array.isArray(data.lines) ? data.lines : []).map((l) => ({
      account_code: String(l?.account_code ?? ''),
      debit: (l?.debit as number) ?? 0,
      credit: (l?.credit as number) ?? 0,
      ...(l?.description ? { description: String(l.description).slice(0, 200) } : {}),
    })),
  }

  const accountsSnap = await accountsCollection(teamId).get()
  const accounts = accountsSnap.docs.map((d) => ({
    code: d.id,
    active: d.data().active !== false,
  }))
  const period = monthKey(input.dateMs)
  const errors = validateManualEntryInput(input, accounts, settings, Date.now(), period)
  if (errors.length > 0) {
    throw new HttpsError('invalid-argument', `Invalid entry: ${errors.join(', ')}`, { errors })
  }

  const id = `manual:${entriesCollection(teamId).doc().id}`
  const entry: AccountingEntryInput = {
    id,
    teamId,
    date_ms: input.dateMs,
    period,
    fiscal_year: fiscalYearOf(period, settings.fiscal_year_start_month),
    source: 'manual',
    description: input.description,
    currency: settings.base_currency,
    lines: input.lines,
    total_debit: input.lines.reduce((s, l) => s + l.debit, 0),
    total_credit: input.lines.reduce((s, l) => s + l.credit, 0),
    created_by: request.auth.uid,
  }
  await createEntry(entry)
  await recomputePeriodSummary(teamId, period)
  return { id, period }
})

export const reverseEntry = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const data = request.data as { teamId?: string; entryId?: string }
  if (!data?.teamId || !data?.entryId) {
    throw new HttpsError('invalid-argument', 'teamId and entryId are required')
  }
  const { teamId, entryId } = data as { teamId: string; entryId: string }

  await assertOwner(request.auth.uid, teamId)
  await assertFinancePluginActive(teamId)
  const settings = await loadAccountingSettings(teamId)
  if (!settings) throw new HttpsError('failed-precondition', 'Accounting is not initialized for this team.')

  const ref = entriesCollection(teamId).doc(entryId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Entry not found')
  const entry = snap.data()!
  if (entry.status !== 'posted') {
    throw new HttpsError('failed-precondition', 'Entry is already reversed')
  }

  const isClosingEntry = entry.source === 'closing'
  const entryFy = entry.fiscal_year as number
  // Reversing inside a closed year is forbidden — EXCEPT reversing the close
  // entry itself, which REOPENS the year. Only the MOST RECENT close can be
  // reversed (years close in sequence; they reopen in sequence too).
  if (isClosingEntry) {
    if (entryFy !== settings.closed_through_fiscal_year) {
      throw new HttpsError('failed-precondition', 'Only the most recent fiscal-year close can be reversed.')
    }
  } else if (
    settings.closed_through_fiscal_year != null &&
    entryFy <= settings.closed_through_fiscal_year
  ) {
    throw new HttpsError('failed-precondition', 'Fiscal year is closed — reverse the close entry first.')
  }

  const nowMs = Date.now()
  const period = monthKey(nowMs)
  const reversal = buildReversalEntry(
    {
      id: entryId,
      teamId,
      description: entry.description as string,
      currency: entry.currency as string,
      lines: entry.lines,
    },
    {
      id: `rev:${entryId}`,
      dateMs: nowMs,
      period,
      fiscalYearStartMonth: settings.fiscal_year_start_month,
      createdBy: request.auth.uid,
    }
  )
  try {
    await createEntry(reversal)
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) {
      throw new HttpsError('failed-precondition', 'Entry is already reversed')
    }
    throw err
  }
  await ref.update({ status: 'reversed', reversed_by: reversal.id })

  if (isClosingEntry) {
    // Reopen: closed_through steps back to the previous year iff its close
    // entry exists and is still posted; otherwise nothing remains closed.
    const prevClose = await entriesCollection(teamId).doc(`close:${entryFy - 1}`).get()
    const prevClosed = prevClose.exists && prevClose.data()?.status === 'posted'
    await accountingSettingsRef(teamId).set(
      { closed_through_fiscal_year: prevClosed ? entryFy - 1 : null },
      { merge: true }
    )
  }

  await recomputePeriodSummary(teamId, period)
  if ((entry.period as string) !== period) {
    await recomputePeriodSummary(teamId, entry.period as string)
  }
  return { id: reversal.id }
})
