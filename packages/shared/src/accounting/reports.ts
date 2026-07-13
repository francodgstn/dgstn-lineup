// Accounting reports — pure computations over per-account debit/credit totals.
// The client fetches accounting_period_summaries docs (≤12 reads per year) and
// computes with these functions; there are no report callables in v1.
//
//   Trial balance  — totals for a period RANGE; grand debit === grand credit.
//   P&L            — revenue/expense balances for a period range.
//   Balance sheet  — CUMULATIVE totals from inception → as-of month, with a
//                    virtual "current-period result" equity line so the sheet
//                    balances mid-year; closing entries collapse prior years
//                    into retained earnings automatically.

import { normalSideForType, type AccountType } from '../types/accounting'

export interface AccountTotals {
  debit: number
  credit: number
}

export interface ReportAccountRef {
  code: string
  name: string
  type: AccountType
}

/** Merge per-period summary totals into one map (order-independent). */
export function sumAccountTotals(
  summaries: Array<Record<string, AccountTotals>>
): Record<string, AccountTotals> {
  const out: Record<string, AccountTotals> = {}
  for (const s of summaries) {
    for (const [code, t] of Object.entries(s)) {
      const acc = (out[code] ??= { debit: 0, credit: 0 })
      acc.debit += t.debit
      acc.credit += t.credit
    }
  }
  return out
}

// ─── Trial balance ────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  code: string
  name: string
  type: AccountType
  debit: number
  credit: number
  /** Signed balance on the account's NORMAL side (debit-normal: debit−credit). */
  balance: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  total_debit: number
  total_credit: number
}

export function computeTrialBalance(
  totals: Record<string, AccountTotals>,
  accounts: ReportAccountRef[]
): TrialBalance {
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const rows: TrialBalanceRow[] = []
  let total_debit = 0
  let total_credit = 0
  for (const [code, t] of Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))) {
    if (t.debit === 0 && t.credit === 0) continue
    const account = byCode.get(code)
    const type: AccountType = account?.type ?? 'expense'
    const balance =
      normalSideForType(type) === 'debit' ? t.debit - t.credit : t.credit - t.debit
    rows.push({ code, name: account?.name ?? code, type, debit: t.debit, credit: t.credit, balance })
    total_debit += t.debit
    total_credit += t.credit
  }
  return { rows, total_debit, total_credit }
}

// ─── Profit & loss ────────────────────────────────────────────────────────────

export interface ProfitAndLossRow {
  code: string
  name: string
  /** Positive on the section's natural side (revenue: credit surplus). */
  amount: number
}

export interface ProfitAndLoss {
  revenue: ProfitAndLossRow[]
  expenses: ProfitAndLossRow[]
  total_revenue: number
  total_expenses: number
  net_profit: number
}

export function computeProfitAndLoss(
  totals: Record<string, AccountTotals>,
  accounts: ReportAccountRef[]
): ProfitAndLoss {
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const revenue: ProfitAndLossRow[] = []
  const expenses: ProfitAndLossRow[] = []
  let total_revenue = 0
  let total_expenses = 0
  for (const [code, t] of Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))) {
    const account = byCode.get(code)
    if (!account) continue
    if (account.type === 'revenue') {
      const amount = t.credit - t.debit
      if (amount === 0 && t.credit === 0 && t.debit === 0) continue
      revenue.push({ code, name: account.name, amount })
      total_revenue += amount
    } else if (account.type === 'expense') {
      const amount = t.debit - t.credit
      if (amount === 0 && t.credit === 0 && t.debit === 0) continue
      expenses.push({ code, name: account.name, amount })
      total_expenses += amount
    }
  }
  return { revenue, expenses, total_revenue, total_expenses, net_profit: total_revenue - total_expenses }
}

// ─── Balance sheet ────────────────────────────────────────────────────────────

export interface BalanceSheetRow {
  code: string
  name: string
  /** Positive on the section's natural side. */
  amount: number
}

export interface BalanceSheet {
  assets: BalanceSheetRow[]
  liabilities: BalanceSheetRow[]
  equity: BalanceSheetRow[]
  /** Un-closed P&L result folded in as a virtual equity line ("current result")
   * so the sheet balances mid-year without a fiscal close. */
  current_result: number
  total_assets: number
  total_liabilities_equity: number
}

export function computeBalanceSheet(
  cumulativeTotals: Record<string, AccountTotals>,
  accounts: ReportAccountRef[]
): BalanceSheet {
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const assets: BalanceSheetRow[] = []
  const liabilities: BalanceSheetRow[] = []
  const equity: BalanceSheetRow[] = []
  let total_assets = 0
  let total_liabilities = 0
  let total_equity = 0
  let current_result = 0

  for (const [code, t] of Object.entries(cumulativeTotals).sort(([a], [b]) => a.localeCompare(b))) {
    const account = byCode.get(code)
    const type: AccountType = account?.type ?? 'expense'
    const name = account?.name ?? code
    switch (type) {
      case 'asset': {
        const amount = t.debit - t.credit
        if (amount !== 0) {
          assets.push({ code, name, amount })
          total_assets += amount
        }
        break
      }
      case 'liability': {
        const amount = t.credit - t.debit
        if (amount !== 0) {
          liabilities.push({ code, name, amount })
          total_liabilities += amount
        }
        break
      }
      case 'equity': {
        const amount = t.credit - t.debit
        if (amount !== 0) {
          equity.push({ code, name, amount })
          total_equity += amount
        }
        break
      }
      case 'revenue':
        current_result += t.credit - t.debit
        break
      case 'expense':
        current_result -= t.debit - t.credit
        break
    }
  }

  return {
    assets,
    liabilities,
    equity,
    current_result,
    total_assets,
    total_liabilities_equity: total_liabilities + total_equity + current_result,
  }
}

// ─── Monthly trend series (overview charts) ───────────────────────────────────

export interface MonthlyTrendPoint {
  period: string
  /** Σ revenue credit-surplus this month (minor units). */
  income: number
  /** Σ expense debit-surplus this month (minor units). */
  expenses: number
  net: number
  /** Cumulative Σ(debit−credit) over the money accounts from inception. */
  cash_balance: number
}

/**
 * Per-month income / expenses / net + running cash balance for the overview
 * trend charts. `months` is the ascending display window ('YYYY-MM'); cash
 * cumulates over ALL summaries from inception, so a 12-month window still shows
 * the true balance. `closingAdjustments` are the fiscal-year close entries'
 * lines (source 'closing'): a close zeroes every P&L account in the FY-end
 * month, which would show the whole year reversed in that month's bars —
 * subtracting the close's lines restores the real monthly figures. Cash uses
 * RAW totals (closes never touch money accounts, and the line must keep tying
 * to the balance sheet).
 */
export function computeMonthlySeries(
  summaries: Array<{ period: string; totals: Record<string, AccountTotals> }>,
  accounts: ReportAccountRef[],
  moneyAccountCodes: string[],
  months: string[],
  closingAdjustments: Array<{
    period: string
    lines: Array<{ account_code: string; debit: number; credit: number }>
  }> = []
): MonthlyTrendPoint[] {
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const money = new Set(moneyAccountCodes)

  const adjust = new Map<string, Record<string, AccountTotals>>()
  for (const c of closingAdjustments) {
    const m = adjust.get(c.period) ?? {}
    for (const l of c.lines) {
      const t = (m[l.account_code] ??= { debit: 0, credit: 0 })
      t.debit += l.debit
      t.credit += l.credit
    }
    adjust.set(c.period, m)
  }

  // One pass over all summaries in period order: monthly P&L flows + the cash
  // delta of each month (cumulated below).
  const sorted = [...summaries].sort((a, b) => a.period.localeCompare(b.period))
  const flows = new Map<string, { income: number; expenses: number; cash: number }>()
  for (const s of sorted) {
    const adj = adjust.get(s.period)
    let income = 0
    let expenses = 0
    let cash = 0
    for (const [code, t] of Object.entries(s.totals)) {
      const a = adj?.[code]
      const debit = t.debit - (a?.debit ?? 0)
      const credit = t.credit - (a?.credit ?? 0)
      const type = byCode.get(code)?.type
      if (type === 'revenue') income += credit - debit
      else if (type === 'expense') expenses += debit - credit
      if (money.has(code)) cash += t.debit - t.credit
    }
    flows.set(s.period, { income, expenses, cash })
  }

  const points: MonthlyTrendPoint[] = []
  const periods = sorted.map((s) => s.period)
  let running = 0
  let i = 0
  for (const month of months) {
    while (i < periods.length && periods[i] <= month) {
      running += flows.get(periods[i])!.cash
      i += 1
    }
    const f = flows.get(month)
    const income = f?.income ?? 0
    const expenses = f?.expenses ?? 0
    points.push({
      period: month,
      income,
      expenses,
      net: income - expenses,
      cash_balance: running,
    })
  }
  return points
}
