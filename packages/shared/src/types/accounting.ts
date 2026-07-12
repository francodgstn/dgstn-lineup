// Double-entry accounting — data model for the `finance` plugin's accounting
// module. Built ON TOP of the finance journal (types/finance.ts): every journal
// row folds mechanically into one balanced accounting entry via the pure posting
// engine (accounting/posting.ts); the ledger is replayable at any time
// (rebuildAccountingLedger), which is the primary correctness mechanism.
//
// Storage (all per-team subcollections, purged with the team subtree —
// intentionally NOT in TENANT_DATA_COLLECTIONS, which lists top-level
// collections only):
//   teams/{id}/accounting_accounts/{code}            chart of accounts (doc id = code)
//   teams/{id}/accounting_settings/config            singleton settings + account mapping
//   teams/{id}/accounting_entries/{entryId}          balanced entries, embedded lines[]
//   teams/{id}/accounting_period_summaries/{YYYY-MM} per-account monthly totals
//
// Immutability: entries are NEVER edited or deleted — corrections are a
// reversal entry (`rev:{id}`) plus a new entry. Enforced by rules
// (`write: if false`) and by the callables.
//
// Cash-basis only: entries mirror money events. No deferred revenue, no
// accruals — the receivable/payable/RA accounts are seeded for MANUAL use.
// VAT: schema-ready only (tax_code fields + a seeded VAT-payable account);
// nothing computes or reports VAT. See docs/accounting.md for limitations.

import type { Timestamp } from './common'
import type { FinanceCategory, FinanceTxnSource } from './finance'

// ─── Accounts ─────────────────────────────────────────────────────────────────

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export type NormalSide = 'debit' | 'credit'

/** Derived, never persisted — a single source of truth that cannot drift. */
export function normalSideForType(type: AccountType): NormalSide {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit'
}

export interface AccountingAccount {
  /** Account code, e.g. '1020'. Also the doc id. IMMUTABLE — entries embed it;
   * renumbering = deactivate + create + manual transfer entry. */
  code: string
  /** Display name. Seeded in the team's locale from the chart template and
   * stored as a plain EDITABLE string (account names are user data, not UI
   * chrome — they deliberately don't follow later UI-language switches). */
  name: string
  type: AccountType
  /** Seeded default — cannot be deleted; code/type locked (rules-enforced). */
  system: boolean
  /** Deactivate instead of delete (historical entries keep referencing it). */
  active: boolean
  /** Schema-ready VAT — unused in v1. */
  tax_code?: string | null
  description?: string | null
  created_at: Timestamp
  updated_at: Timestamp
  /** uid, or 'system' for seeded accounts. */
  created_by?: string
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export type ChartTemplateId = 'ch_kmu' | 'de_skr04' | 'it_standard'

/** Journal-dimension → account-code map. The posting engine reads codes
 * EXCLUSIVELY from here — never account-code literals. Each chart template
 * ships its own defaults; the studio can remap in settings. */
export interface AccountingMapping {
  revenue_by_category: Record<FinanceCategory, string>
  clearing_by_source: Record<FinanceTxnSource, string>
  bank_account: string
  stripe_fee_account: string
  platform_fee_account: string
  chargeback_account: string
  retained_earnings_account: string
}

export const ACCOUNTING_SETTINGS_VERSION = 1

export interface AccountingSettings {
  /** Uppercase ISO 4217. The v1 ledger is single-currency: journal rows in any
   * other currency are skipped (counted in last_rebuild.skipped_foreign_currency). */
  base_currency: string
  /** 1–12; 1 = calendar year (default). */
  fiscal_year_start_month: number
  /** Chosen at install from the team's country; LOCKED once the first entry is
   * posted (switching numbering mid-ledger is a migration, not a toggle). */
  chart_template: ChartTemplateId
  mapping: AccountingMapping
  /** Last closed fiscal year — entries dated inside a closed year are rejected. */
  closed_through_fiscal_year?: number | null
  last_rebuild?: {
    at: Timestamp
    entries_written: number
    skipped_foreign_currency: number
    run_id: string
  } | null
  seeded_at: Timestamp
  version: number
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export type AccountingEntrySource = 'auto' | 'manual' | 'closing'

export interface AccountingEntryLine {
  account_code: string
  /** Minor units, >= 0; EXACTLY one of debit/credit is > 0 per line. */
  debit: number
  credit: number
  description?: string | null
  /** Schema-ready VAT — unused in v1. */
  tax_code?: string | null
  tax_rate_bp?: number | null
}

/**
 * Pure engine output — the functions layer converts `date_ms` to a Firestore
 * Timestamp and stamps created_at server-side.
 *
 * Entry ids are deterministic:
 *   'txn:{financeTxnId}'      auto entry for a journal row (replay-safe overwrite)
 *   'txn:{financeTxnId}:rev'  reversal when the journal row was corrected
 *   'manual:{autoId}'         manual entry
 *   'rev:{entryId}'           manual reversal of an entry
 *   'close:{fiscalYear}'      the year-close entry
 */
export interface AccountingEntryInput {
  id: string
  teamId: string
  date_ms: number
  /** 'YYYY-MM' (finance timezone) — the summary bucket. */
  period: string
  fiscal_year: number
  source: AccountingEntrySource
  finance_txn_id?: string | null
  description: string
  /** Always === settings.base_currency. */
  currency: string
  lines: AccountingEntryLine[]
  total_debit: number
  total_credit: number
  reverses?: string | null
  created_by: string
}

/** Stored shape (Firestore document). */
export interface AccountingEntry extends Omit<AccountingEntryInput, 'date_ms'> {
  date: Timestamp
  status: 'posted' | 'reversed'
  reversed_by?: string | null
  created_at: Timestamp
  rebuild_run_id?: string | null
}

// ─── Period summaries ─────────────────────────────────────────────────────────
// Per-month per-account debit/credit totals — the report substrate. Recomputed
// transactionally whenever a month's entries change, and wholesale by rebuild.
// Reports (trial balance / P&L / balance sheet) are computed CLIENT-SIDE from
// these docs; the balance sheet sums all summaries from inception → as-of month.

export interface AccountingPeriodSummary {
  teamId: string
  period: string
  fiscal_year: number
  /** account_code → month totals over ALL entries. A reversed entry and its
   * reversal both stay in the totals and cancel — classic bookkeeping; the
   * 'reversed' status is display metadata, never an exclusion filter. */
  totals: Record<string, { debit: number; credit: number }>
  entry_count: number
  computed_at: Timestamp
}

// ─── Fiscal year helper ───────────────────────────────────────────────────────

/**
 * Fiscal year of a 'YYYY-MM' period. The FY is labeled by its STARTING year:
 * with start month 4, period 2027-02 belongs to FY 2026 (2026-04 … 2027-03).
 * Calendar years (start month 1) label as the year itself.
 */
export function fiscalYearOf(period: string, fiscalYearStartMonth: number = 1): number {
  const [y, m] = period.split('-').map((v) => parseInt(v, 10))
  return m >= fiscalYearStartMonth ? y : y - 1
}

/** Last 'YYYY-MM' period of a fiscal year. */
export function fiscalYearEndPeriod(fiscalYear: number, fiscalYearStartMonth: number = 1): string {
  const endMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1
  const endYear = fiscalYearStartMonth === 1 ? fiscalYear : fiscalYear + 1
  return `${endYear}-${String(endMonth).padStart(2, '0')}`
}
