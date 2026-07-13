// Posting engine — the pure core of the accounting module. Folds finance-
// journal rows into balanced double-entry accounting entries, builds reversals,
// validates manual entries, and builds the fiscal-year close.
//
// Everything here is pure and unit-tested; the Cloud Functions layer
// (functions/src/accounting/) only queries, calls these, and writes.
//
// The generic posting rule exploits the journal invariant
// (gross + stripe_fee + platform_fee === net): expressed as SIGNED DEBIT
// amounts, every non-payout row posts as
//     clearing[source]        net
//     stripe_fee_account     -stripe_fee
//     platform_fee_account   -platform_fee
//     revenue[category]      -gross        (chargeback account for disputes)
// which sums to zero BY CONSTRUCTION — the entry cannot be unbalanced unless
// the journal row itself violates the invariant. Payouts post
// Dr bank / Cr clearing for -net.

import {
  fiscalYearOf,
  type AccountingAccount,
  type AccountingEntryInput,
  type AccountingEntryLine,
  type AccountingMapping,
  type AccountingSettings,
  type AccountType,
} from '../types/accounting'
import { fiscalYearEndPeriod } from '../types/accounting'
import { normalizeCurrency, type FinanceCategory, type FinanceTxnSource, type FinanceTxnType } from '../types/finance'

// ─── Input shapes ─────────────────────────────────────────────────────────────

/** The journal-row fields the engine needs (both FinanceTransactionInput and a
 * stored doc — after converting occurred_at to ms — satisfy it). */
export interface PostableFinanceTxn {
  id: string
  teamId: string
  type: FinanceTxnType
  source: FinanceTxnSource
  category: FinanceCategory
  currency: string
  gross: number
  stripe_fee: number
  platform_fee: number
  net: number
  occurred_at_ms: number
  month: string
  description?: string | null
}

// ─── Line assembly ────────────────────────────────────────────────────────────

/** Merge signed-debit postings per account, drop zeros, convert to lines. */
function toLines(signedDebits: Array<[string, number]>): AccountingEntryLine[] {
  const byAccount = new Map<string, number>()
  for (const [code, amount] of signedDebits) {
    if (!Number.isInteger(amount)) {
      throw new Error(`posting: non-integer amount ${amount} for account ${code}`)
    }
    byAccount.set(code, (byAccount.get(code) ?? 0) + amount)
  }
  const lines: AccountingEntryLine[] = []
  for (const [code, amount] of byAccount) {
    if (amount === 0) continue
    lines.push({
      account_code: code,
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
    })
  }
  return lines
}

function totals(lines: AccountingEntryLine[]): { total_debit: number; total_credit: number } {
  let total_debit = 0
  let total_credit = 0
  for (const l of lines) {
    total_debit += l.debit
    total_credit += l.credit
  }
  return { total_debit, total_credit }
}

/** Every entry MUST balance — a violation is a bug, never data. */
export function assertBalanced(entry: { id: string; total_debit: number; total_credit: number }): void {
  if (entry.total_debit !== entry.total_credit) {
    throw new Error(
      `accounting entry ${entry.id}: unbalanced — debit ${entry.total_debit} !== credit ${entry.total_credit}`
    )
  }
}

// ─── Auto posting ─────────────────────────────────────────────────────────────

/**
 * Fold one finance-journal row into a balanced entry. Returns null when the
 * row is in a foreign currency (v1 single-currency ledger — callers count the
 * skip) or produces no movement at all.
 */
export function buildEntryFromFinanceTxn(
  txn: PostableFinanceTxn,
  settings: AccountingSettings
): AccountingEntryInput | null {
  if (normalizeCurrency(txn.currency) !== normalizeCurrency(settings.base_currency)) return null

  const m: AccountingMapping = settings.mapping
  const clearing = m.clearing_by_source[txn.source]
  let signedDebits: Array<[string, number]>

  if (txn.type === 'payout') {
    // Balance movement: Dr bank / Cr clearing (signs flip for failed payouts).
    signedDebits = [
      [m.bank_account, -txn.net],
      [clearing, txn.net],
    ]
  } else {
    const counterAccount =
      txn.type === 'dispute' || txn.type === 'dispute_reversal'
        ? m.chargeback_account
        : (m.revenue_by_category[txn.category] ?? m.revenue_by_category.other)
    signedDebits = [
      [clearing, txn.net],
      [m.stripe_fee_account, -txn.stripe_fee],
      [m.platform_fee_account, -txn.platform_fee],
      [counterAccount, -txn.gross],
    ]
  }

  const lines = toLines(signedDebits)
  if (lines.length === 0) return null

  const entry: AccountingEntryInput = {
    id: `txn:${txn.id}`,
    teamId: txn.teamId,
    date_ms: txn.occurred_at_ms,
    period: txn.month,
    fiscal_year: fiscalYearOf(txn.month, settings.fiscal_year_start_month),
    source: 'auto',
    finance_txn_id: txn.id,
    description: txn.description ?? txn.id,
    currency: normalizeCurrency(settings.base_currency),
    lines,
    ...totals(lines),
    created_by: 'system',
  }
  assertBalanced(entry)
  return entry
}

// ─── Reversal ─────────────────────────────────────────────────────────────────

/** The entry fields a reversal needs (stored entries satisfy it). */
export interface ReversibleEntry {
  id: string
  teamId: string
  description: string
  currency: string
  lines: AccountingEntryLine[]
}

/** Build the compensating entry: same lines with debit/credit swapped. */
export function buildReversalEntry(
  entry: ReversibleEntry,
  opts: { id: string; dateMs: number; period: string; fiscalYearStartMonth: number; createdBy: string }
): AccountingEntryInput {
  const lines: AccountingEntryLine[] = entry.lines.map((l) => ({
    account_code: l.account_code,
    debit: l.credit,
    credit: l.debit,
    ...(l.description ? { description: l.description } : {}),
    ...(l.tax_code != null ? { tax_code: l.tax_code } : {}),
    ...(l.tax_rate_bp != null ? { tax_rate_bp: l.tax_rate_bp } : {}),
  }))
  const reversal: AccountingEntryInput = {
    id: opts.id,
    teamId: entry.teamId,
    date_ms: opts.dateMs,
    period: opts.period,
    fiscal_year: fiscalYearOf(opts.period, opts.fiscalYearStartMonth),
    source: 'manual',
    description: `Reversal of ${entry.id} — ${entry.description}`,
    currency: entry.currency,
    lines,
    ...totals(lines),
    reverses: entry.id,
    created_by: opts.createdBy,
  }
  assertBalanced(reversal)
  return reversal
}

// ─── Manual entries ───────────────────────────────────────────────────────────

export interface ManualEntryInput {
  dateMs: number
  description: string
  lines: Array<{
    account_code: string
    debit: number
    credit: number
    description?: string | null
  }>
}

export const MANUAL_ENTRY_MIN_LINES = 2
export const MANUAL_ENTRY_MAX_LINES = 20
export const MANUAL_ENTRY_MAX_DESCRIPTION = 500

/**
 * Validate a manual entry. Returns machine-readable error codes (empty = valid)
 * so the callable and the form can map them to i18n messages:
 *   description_required · line_count · unknown_account:{code} ·
 *   inactive_account:{code} · line_amounts:{i} · unbalanced · future_date ·
 *   closed_fiscal_year
 */
export function validateManualEntryInput(
  input: ManualEntryInput,
  accounts: Pick<AccountingAccount, 'code' | 'active'>[],
  settings: Pick<AccountingSettings, 'fiscal_year_start_month' | 'closed_through_fiscal_year'>,
  nowMs: number,
  period: string
): string[] {
  const errors: string[] = []

  if (!input.description || !input.description.trim() || input.description.length > MANUAL_ENTRY_MAX_DESCRIPTION) {
    errors.push('description_required')
  }
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < MANUAL_ENTRY_MIN_LINES ||
    input.lines.length > MANUAL_ENTRY_MAX_LINES
  ) {
    errors.push('line_count')
    return errors // nothing meaningful to validate below
  }

  const byCode = new Map(accounts.map((a) => [a.code, a]))
  let debit = 0
  let credit = 0
  input.lines.forEach((l, i) => {
    const account = byCode.get(l.account_code)
    if (!account) errors.push(`unknown_account:${l.account_code}`)
    else if (!account.active) errors.push(`inactive_account:${l.account_code}`)
    const validAmounts =
      Number.isInteger(l.debit) &&
      Number.isInteger(l.credit) &&
      l.debit >= 0 &&
      l.credit >= 0 &&
      (l.debit > 0) !== (l.credit > 0) // exactly one side
    if (!validAmounts) errors.push(`line_amounts:${i}`)
    debit += l.debit
    credit += l.credit
  })
  if (debit !== credit || debit === 0) errors.push('unbalanced')
  if (input.dateMs > nowMs) errors.push('future_date')

  const fy = fiscalYearOf(period, settings.fiscal_year_start_month)
  if (settings.closed_through_fiscal_year != null && fy <= settings.closed_through_fiscal_year) {
    errors.push('closed_fiscal_year')
  }
  return errors
}

// ─── Fiscal-year close ────────────────────────────────────────────────────────

/**
 * Build the closing entry for a fiscal year: zero every revenue/expense
 * account balance into retained earnings. `accountTotals` are the FY's
 * cumulative per-account debit/credit sums (from the period summaries).
 * Returns null when there is nothing to close.
 */
export function buildClosingEntry(
  fiscalYear: number,
  accountTotals: Record<string, { debit: number; credit: number }>,
  accounts: Pick<AccountingAccount, 'code' | 'type'>[],
  settings: AccountingSettings,
  opts: { dateMs: number; createdBy: string }
): AccountingEntryInput | null {
  const typeByCode = new Map(accounts.map((a) => [a.code, a.type]))
  const signedDebits: Array<[string, number]> = []
  let result = 0 // profit (+) / loss (−)

  for (const [code, t] of Object.entries(accountTotals)) {
    const type: AccountType | undefined = typeByCode.get(code)
    if (type !== 'revenue' && type !== 'expense') continue
    const balanceSigned = t.debit - t.credit // debit-positive
    if (balanceSigned === 0) continue
    // Zero the account: post the opposite of its balance.
    signedDebits.push([code, -balanceSigned])
    // Profit contribution is the credit surplus: revenue (credit balance,
    // balanceSigned < 0) adds, expense (debit balance) subtracts.
    result += -balanceSigned
  }
  if (signedDebits.length === 0) return null

  // The counter-posting: profit credits retained earnings, loss debits it.
  // result = Σ(-balanceSigned) over P&L accounts = credit-surplus = net profit.
  signedDebits.push([settings.mapping.retained_earnings_account, -result])

  const period = fiscalYearEndPeriod(fiscalYear, settings.fiscal_year_start_month)
  const lines = toLines(signedDebits)
  const entry: AccountingEntryInput = {
    id: `close:${fiscalYear}`,
    teamId: '', // stamped by the caller
    date_ms: opts.dateMs,
    period,
    fiscal_year: fiscalYear,
    source: 'closing',
    description: `Fiscal year ${fiscalYear} close`,
    currency: normalizeCurrency(settings.base_currency),
    lines,
    ...totals(lines),
    created_by: opts.createdBy,
  }
  assertBalanced(entry)
  return entry
}
