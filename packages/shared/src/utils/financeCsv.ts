// Finance CSV serializer — the generic monthly export studios hand to their
// accountant / accounting tool. Pure (no SDK types beyond the Timestamp shape),
// shared so the exportFinanceReport callable and any future client-side export
// serialize identically. Column schema is documented in docs/finance-reports.md
// — treat it as a public contract: append columns, never rename or reorder.

import { FINANCE_TIMEZONE } from '../types/finance'
import type { FinanceCategory, FinanceFeeSource, FinanceTxnSource, FinanceTxnType } from '../types/finance'

/** The journal-row fields the CSV needs (stored FinanceTransaction docs satisfy it). */
export interface FinanceCsvRow {
  id: string
  occurred_at: { toMillis(): number }
  month: string
  type: FinanceTxnType
  source: FinanceTxnSource
  source_ref: string
  payout_id?: string | null
  status: 'recorded' | 'corrected'
  contact_id?: string | null
  category: FinanceCategory
  description?: string | null
  currency: string
  gross: number
  stripe_fee: number
  platform_fee: number
  net: number
  fee_source: FinanceFeeSource
}

export const FINANCE_CSV_COLUMNS = [
  'txn_id',
  'occurred_at',
  'month',
  'type',
  'source',
  'source_ref',
  'payout_id',
  'status',
  'contact_id',
  'category',
  'description',
  'currency',
  'gross',
  'stripe_fee',
  'platform_fee',
  'net',
  'fee_source',
] as const

/**
 * Signed 2-dp major-unit rendering of an integer minor-unit amount, by integer
 * split (never float division): -1986 → '-19.86', 5 → '0.05', 0 → '0.00'.
 */
export function formatMinorUnits(minor: number): string {
  if (!Number.isInteger(minor)) throw new Error(`formatMinorUnits: expected integer, got ${minor}`)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const int = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${int}.${frac}`
}

/** Offset (ms) of `timeZone` relative to UTC at the given instant. */
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

/** ISO 8601 with the finance-timezone offset, e.g. '2026-06-14T18:32:11+02:00'. */
export function formatFinanceTimestamp(utcMs: number, timeZone: string = FINANCE_TIMEZONE): string {
  const offsetMs = zoneOffsetMs(utcMs, timeZone)
  const wall = new Date(utcMs + offsetMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = Math.round(offsetMs / 60000)
  const offSign = offsetMin < 0 ? '-' : '+'
  const offAbs = Math.abs(offsetMin)
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${offSign}${pad(Math.floor(offAbs / 60))}:${pad(offAbs % 60)}`
  )
}

/** RFC 4180 field quoting: quote when the field contains a comma, quote, or
 * newline; embedded quotes are doubled. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * Serialize journal rows to the documented CSV: UTF-8, CRLF line endings,
 * header row always present, rows in the order given (callers order by
 * occurred_at so charges and payouts interleave chronologically).
 */
export function toFinanceCsv(rows: FinanceCsvRow[]): string {
  const lines: string[] = [FINANCE_CSV_COLUMNS.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.id,
        formatFinanceTimestamp(r.occurred_at.toMillis()),
        r.month,
        r.type,
        r.source,
        r.source_ref,
        r.payout_id ?? '',
        r.status,
        r.contact_id ?? '',
        r.category,
        r.description ?? '',
        r.currency,
        formatMinorUnits(r.gross),
        formatMinorUnits(r.stripe_fee),
        formatMinorUnits(r.platform_fee),
        formatMinorUnits(r.net),
        r.fee_source,
      ]
        .map((v) => csvField(String(v)))
        .join(',')
    )
  }
  return lines.join('\r\n') + '\r\n'
}
