/* eslint-disable no-console */
// exportFinanceReport — the monthly CSV export (the "hand this to your
// accountant" file). Returns the CSV inline: even a busy studio's month is a
// few thousand rows ≈ well under the 10 MB callable response limit; a hard
// guard rejects pathological sizes instead of silently truncating.
//
// Gated by the finance plugin's install state (assertFinancePluginActive) —
// NOT a PlanFeature flag. Column schema: docs/finance-reports.md.

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  FINANCE_TRANSACTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  toFinanceCsv,
  type FinanceCsvRow,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { assertFinancePluginActive } from './access'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_CSV_BYTES = 8 * 1024 * 1024

export const exportFinanceReport = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as { teamId?: string; month?: string }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!data?.month || !MONTH_RE.test(data.month)) {
    throw new HttpsError('invalid-argument', 'month must be YYYY-MM')
  }
  const { teamId, month } = data as { teamId: string; month: string }

  await assertManager(request.auth.uid, teamId)
  await assertFinancePluginActive(teamId)

  const snap = await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(FINANCE_TRANSACTIONS_SUBCOLLECTION)
    .where('month', '==', month)
    .orderBy('occurred_at', 'asc')
    .get()

  const csv = toFinanceCsv(snap.docs.map((d) => d.data() as unknown as FinanceCsvRow))
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw new HttpsError('resource-exhausted', 'Export too large — contact support for a bulk export.')
  }

  console.log(`[finance] export team=${teamId} month=${month} rows=${snap.size}`)
  return {
    filename: `linyup-finance-${teamId}-${month}.csv`,
    csv,
    rowCount: snap.size,
    month,
  }
})
