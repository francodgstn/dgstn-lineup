import assert from 'node:assert/strict'
import {
  CHART_TEMPLATES,
  buildClosingEntry,
  buildEntryFromFinanceTxn,
  computeBalanceSheet,
  computeProfitAndLoss,
  computeTrialBalance,
  resolveAccountName,
  sumAccountTotals,
  type AccountingSettings,
  type AccountTotals,
  type PostableFinanceTxn,
  type ReportAccountRef,
} from '@linyup/shared'

// Unit tests for the pure report computations. The end-to-end shape is:
// posting engine → entry lines → (summary totals) → trial balance / P&L /
// balance sheet — so the tests drive real posted entries through the reports.
// Run with: pnpm --filter @linyup/functions test

const settings: AccountingSettings = {
  base_currency: 'CHF',
  fiscal_year_start_month: 1,
  chart_template: 'ch_kmu',
  mapping: CHART_TEMPLATES.ch_kmu.mapping,
  closed_through_fiscal_year: null,
  seeded_at: { toDate: () => new Date(0), toMillis: () => 0, seconds: 0, nanoseconds: 0 },
  version: 1,
}

const accounts: ReportAccountRef[] = CHART_TEMPLATES.ch_kmu.accounts.map((a) => ({
  code: a.code,
  name: resolveAccountName(a, 'en'),
  type: a.type,
}))

const txn = (over: Partial<PostableFinanceTxn>): PostableFinanceTxn => ({
  id: 'x',
  teamId: 't1',
  type: 'charge',
  source: 'connect',
  category: 'membership',
  currency: 'CHF',
  gross: 5000,
  stripe_fee: -145,
  platform_fee: -35,
  net: 4820,
  occurred_at_ms: Date.UTC(2026, 5, 14),
  month: '2026-06',
  ...over,
})

/** Fold entries' lines into per-account totals (mirrors recomputePeriodSummary). */
function totalsOf(entries: Array<{ lines: { account_code: string; debit: number; credit: number }[] }>) {
  const totals: Record<string, AccountTotals> = {}
  for (const e of entries) {
    for (const l of e.lines) {
      const t = (totals[l.account_code] ??= { debit: 0, credit: 0 })
      t.debit += l.debit
      t.credit += l.credit
    }
  }
  return totals
}

// A month of activity: two charges, a refund, a payout, an opening balance.
const june = [
  buildEntryFromFinanceTxn(txn({ id: 'c1' }), settings)!,
  buildEntryFromFinanceTxn(
    txn({ id: 'c2', category: 'product', gross: 3000, stripe_fee: -90, platform_fee: -21, net: 2889 }),
    settings
  )!,
  buildEntryFromFinanceTxn(
    txn({ id: 'r1', type: 'refund', gross: -2000, stripe_fee: 0, platform_fee: 14, net: -1986 }),
    settings
  )!,
  buildEntryFromFinanceTxn(
    txn({ id: 'p1', type: 'payout', gross: 0, stripe_fee: 0, platform_fee: 0, net: -4000 }),
    settings
  )!,
  {
    // Opening balance: Dr Bank 100.00 / Cr Equity 100.00
    lines: [
      { account_code: '1020', debit: 10000, credit: 0 },
      { account_code: '2800', debit: 0, credit: 10000 },
    ],
  },
]

describe('sumAccountTotals', () => {
  it('merges period maps additively', () => {
    const merged = sumAccountTotals([
      { '1020': { debit: 100, credit: 0 } },
      { '1020': { debit: 50, credit: 30 }, '3400': { debit: 0, credit: 500 } },
    ])
    assert.deepEqual(merged['1020'], { debit: 150, credit: 30 })
    assert.deepEqual(merged['3400'], { debit: 0, credit: 500 })
  })
})

describe('computeTrialBalance', () => {
  it('ties: grand debit === grand credit over real posted entries', () => {
    const tb = computeTrialBalance(totalsOf(june), accounts)
    assert.equal(tb.total_debit, tb.total_credit)
    assert.ok(tb.rows.length > 0)
    const revenue = tb.rows.find((r) => r.code === '3400')!
    assert.equal(revenue.balance, 3000) // 5000 credit − 2000 refund debit, credit-normal
  })
})

describe('computeProfitAndLoss', () => {
  it('computes revenue − expenses = net profit', () => {
    const pnl = computeProfitAndLoss(totalsOf(june), accounts)
    // Revenue: memberships 5000−2000=3000, products 3000 → 6000
    assert.equal(pnl.total_revenue, 6000)
    // Expenses: stripe fees 145+90=235, platform fees 35+21−14=42 → 277
    assert.equal(pnl.total_expenses, 277)
    assert.equal(pnl.net_profit, 5723)
  })
})

describe('computeBalanceSheet', () => {
  it('balances mid-year via the virtual current-result line', () => {
    const bs = computeBalanceSheet(totalsOf(june), accounts)
    assert.equal(bs.current_result, 5723) // = the P&L net profit
    assert.equal(bs.total_assets, bs.total_liabilities_equity)
    // Assets: clearing 4820+2889−1986−4000 = 1723, bank 10000 (opening) + 4000 (payout)
    const bank = bs.assets.find((r) => r.code === '1020')!
    assert.equal(bank.amount, 14000)
    const clearing = bs.assets.find((r) => r.code === '1022')!
    assert.equal(clearing.amount, 1723)
    assert.equal(bs.total_assets, 15723)
  })

  it('balances post-close with the result in retained earnings', () => {
    const totals = totalsOf(june)
    const close = buildClosingEntry(2026, totals, accounts, settings, {
      dateMs: Date.UTC(2026, 11, 31),
      createdBy: 'u1',
    })!
    const afterClose = sumAccountTotals([totals, totalsOf([close])])
    const bs = computeBalanceSheet(afterClose, accounts)
    assert.equal(bs.current_result, 0) // P&L zeroed by the close
    const retained = bs.equity.find((r) => r.code === '2979')!
    assert.equal(retained.amount, 5723)
    assert.equal(bs.total_assets, bs.total_liabilities_equity)
  })
})
