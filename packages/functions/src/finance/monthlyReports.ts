/* eslint-disable no-console */
// monthlyFinanceReports — regenerates teams/{id}/finance_monthly_reports/{YYYY-MM}
// from the finance journal for the previous month AND the month before it.
//
// Runs on the 3rd at 03:00 Europe/Zurich so late-arriving events for the closed
// month (payout timing, refunds, disputes closing) are captured.
//
// UNLIKE weeklyReports (never overwrites — its doc accumulates mid-week
// increments and is the source of truth), finance reports ALWAYS overwrite:
// the journal is the source of truth and regeneration is the correctness
// mechanism. Generated for ALL teams — the finance plugin gates export/UI,
// not the data.

import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import {
  FINANCE_MONTHLY_REPORTS_SUBCOLLECTION,
  FINANCE_TIMEZONE,
  FINANCE_TRANSACTIONS_SUBCOLLECTION,
  MEMBER_PAYMENTS_SUBCOLLECTION,
  PAYMENT_EVENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  computeMonthlyFinanceReport,
  monthKey,
  type FinanceReportRow,
} from '@linyup/shared'
import { to } from '../utils/async'

/** 'YYYY-MM' → the previous month's key. */
export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10))
  const d = new Date(Date.UTC(y, m - 1 - 1, 1)) // one month back
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Offset (ms) of `timeZone` relative to UTC at the given UTC instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return wall - utcMs
}

/** UTC instants of the month's [start, end) in the finance timezone. */
export function monthRange(month: string, timeZone: string = FINANCE_TIMEZONE): { start: Date; end: Date } {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10))
  const startOf = (yy: number, mm: number): number => {
    const guess = Date.UTC(yy, mm - 1, 1)
    // Two-step correction handles the DST edge next to a month boundary.
    let utc = guess - zoneOffsetMs(guess, timeZone)
    utc = guess - zoneOffsetMs(utc, timeZone)
    return utc
  }
  const endY = m === 12 ? y + 1 : y
  const endM = m === 12 ? 1 : m + 1
  return { start: new Date(startOf(y, m)), end: new Date(startOf(endY, endM)) }
}

/**
 * Journal-vs-source drift check: count charge rows in the journal against the
 * source collections for the same period. A mismatch means a webhook write was
 * missed (run the backfill script to reconcile) — stamped on the report doc so
 * the gap is visible instead of silently absent.
 */
async function reconciliationCheck(
  teamId: string,
  month: string
): Promise<{ sources_count: number; journal_count: number; ok: boolean }> {
  const db = admin.firestore()
  const { start, end } = monthRange(month)
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId)

  const [mpSnap, peSnap, journalSnap] = await Promise.all([
    teamRef
      .collection(MEMBER_PAYMENTS_SUBCOLLECTION)
      .where('status', 'in', ['succeeded', 'refunded', 'partially_refunded'])
      .where('created_at', '>=', Timestamp.fromDate(start))
      .where('created_at', '<', Timestamp.fromDate(end))
      .count()
      .get(),
    teamRef
      .collection(PAYMENT_EVENTS_SUBCOLLECTION)
      .where('processed_at', '>=', Timestamp.fromDate(start))
      .where('processed_at', '<', Timestamp.fromDate(end))
      .count()
      .get(),
    teamRef
      .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
      .where('month', '==', month)
      .where('type', '==', 'charge')
      .count()
      .get(),
  ])

  // Note: a payment_events row with a null/zero amount is recorded but never
  // journaled — a rare, benign source of drift the warning message calls out.
  const sources = mpSnap.data().count + peSnap.data().count
  const journal = journalSnap.data().count
  return { sources_count: sources, journal_count: journal, ok: journal === sources }
}

/** Regenerate one team-month. Exported for reuse by the export callable
 * (compute-on-demand for a missing/current month) and emulator testing. */
export async function generateMonthlyFinanceReport(teamId: string, month: string): Promise<boolean> {
  const db = admin.firestore()
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId)
  const rowsSnap = await teamRef
    .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
    .where('month', '==', month)
    .orderBy('occurred_at', 'asc')
    .get()
  if (rowsSnap.empty) return false // don't litter empty report docs

  const rows = rowsSnap.docs.map((d) => d.data() as unknown as FinanceReportRow)
  const report = computeMonthlyFinanceReport(rows, month)
  const check = await reconciliationCheck(teamId, month)
  if (!check.ok) {
    console.warn(
      `[finance] reconciliation drift team=${teamId} month=${month}: sources=${check.sources_count} journal=${check.journal_count} — run pnpm backfill:finance`
    )
  }

  await teamRef
    .collection(FINANCE_MONTHLY_REPORTS_SUBCOLLECTION)
    .doc(month)
    .set({ ...report, reconciliation_check: check, generated_at: FieldValue.serverTimestamp() })
  return true
}

export const monthlyFinanceReports = onSchedule(
  { schedule: '0 3 3 * *', timeZone: FINANCE_TIMEZONE, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore()
    const prev = prevMonthKey(monthKey(Date.now()))
    const months = [prevMonthKey(prev), prev] // late events can land in either

    const [teamsErr, teamsSnap] = await to(
      db.collection(TEAMS_COLLECTION).where('archived_at', '==', null).get()
    )
    if (teamsErr || !teamsSnap || teamsSnap.empty) return

    let written = 0
    for (const teamDoc of teamsSnap.docs) {
      for (const month of months) {
        try {
          if (await generateMonthlyFinanceReport(teamDoc.id, month)) written += 1
        } catch (err) {
          console.error(`[finance] monthly report failed team=${teamDoc.id} month=${month}:`, err)
        }
      }
    }
    console.log(`[finance] monthly reports: ${written} team-months written for ${months.join(', ')}`)
  }
)
