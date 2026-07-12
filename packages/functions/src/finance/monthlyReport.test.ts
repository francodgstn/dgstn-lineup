import assert from 'node:assert/strict'
import {
  computeMonthlyFinanceReport,
  type FinanceReportRow,
} from '@linyup/shared'
import { monthRange, prevMonthKey } from './monthlyReports'

// Unit tests for the pure monthly-report reducer + the cron's period helpers.
// Run with: pnpm --filter @linyup/functions test

const charge = (over: Partial<FinanceReportRow> = {}): FinanceReportRow => ({
  type: 'charge',
  source: 'connect',
  category: 'membership',
  currency: 'CHF',
  gross: 5000,
  stripe_fee: -145,
  platform_fee: -35,
  net: 4820,
  ...over,
})

describe('computeMonthlyFinanceReport', () => {
  it('aggregates totals, categories, and sources', () => {
    const rows: FinanceReportRow[] = [
      charge(),
      charge({ category: 'product', source: 'connect', gross: 3000, stripe_fee: -90, platform_fee: -21, net: 2889 }),
      charge({ source: 'manual', category: 'drop_in', gross: 1500, stripe_fee: 0, platform_fee: 0, net: 1500 }),
    ]
    const r = computeMonthlyFinanceReport(rows, '2026-06')
    assert.equal(r.month, '2026-06')
    assert.equal(r.txn_count, 3)
    assert.deepEqual(r.currencies, ['CHF'])
    assert.equal(r.totals.gross, 9500)
    assert.equal(r.totals.stripe_fees, -235)
    assert.equal(r.totals.platform_fees, -56)
    assert.equal(r.totals.net, 9209)
    assert.equal(r.by_category.membership.gross, 5000)
    assert.equal(r.by_category.product.gross, 3000)
    assert.equal(r.by_category.drop_in.gross, 1500)
    assert.equal(r.by_source.connect.count, 2)
    assert.equal(r.by_source.manual.count, 1)
    assert.equal(r.by_currency, undefined) // single currency → no breakdown
  })

  it('aggregates refunds and disputes with positive display amounts', () => {
    const rows: FinanceReportRow[] = [
      charge(),
      { type: 'refund', source: 'connect', category: 'membership', currency: 'CHF', gross: -2000, stripe_fee: 0, platform_fee: 14, net: -1986 },
      { type: 'dispute', source: 'connect', category: 'product', currency: 'CHF', gross: -3000, stripe_fee: -1500, platform_fee: 0, net: -4500 },
      { type: 'dispute_reversal', source: 'connect', category: 'product', currency: 'CHF', gross: 3000, stripe_fee: 1500, platform_fee: 0, net: 4500 },
    ]
    const r = computeMonthlyFinanceReport(rows, '2026-06')
    assert.equal(r.refunds.count, 1)
    assert.equal(r.refunds.amount, 2000)
    assert.equal(r.disputes.count, 1)
    assert.equal(r.disputes.withdrawn, 3000)
    assert.equal(r.disputes.reinstated, 3000)
    assert.equal(r.disputes.fees, 0) // 1500 charged, 1500 refunded on win
    // Activity net: 4820 - 1986 - 4500 + 4500
    assert.equal(r.totals.net, 2834)
  })

  it('treats payouts as balance movements, not activity, and reconciles', () => {
    const rows: FinanceReportRow[] = [
      charge(), // net +4820
      { type: 'payout', source: 'connect', category: 'other', currency: 'CHF', gross: 0, stripe_fee: 0, platform_fee: 0, net: -3000 },
    ]
    const r = computeMonthlyFinanceReport(rows, '2026-06')
    assert.equal(r.txn_count, 2)
    assert.equal(r.totals.gross, 5000) // payout does not appear in activity totals
    assert.equal(r.payouts.count, 1)
    assert.equal(r.payouts.total, 3000)
    assert.equal(r.reconciliation.net_activity, 4820)
    assert.equal(r.reconciliation.paid_out, 3000)
    assert.equal(r.reconciliation.delta, 1820)
  })

  it('excludes corrected rows', () => {
    const rows: FinanceReportRow[] = [charge(), charge({ status: 'corrected' })]
    const r = computeMonthlyFinanceReport(rows, '2026-06')
    assert.equal(r.txn_count, 1)
    assert.equal(r.totals.gross, 5000)
  })

  it('handles an empty month', () => {
    const r = computeMonthlyFinanceReport([], '2026-06')
    assert.equal(r.txn_count, 0)
    assert.equal(r.totals.gross, 0)
    assert.deepEqual(r.currencies, [])
  })

  it('splits per-currency and keeps primary-currency totals when mixed', () => {
    const rows: FinanceReportRow[] = [
      charge(),
      charge(),
      charge({ currency: 'eur', gross: 2000, stripe_fee: 0, platform_fee: 0, net: 2000 }),
    ]
    const r = computeMonthlyFinanceReport(rows, '2026-06')
    assert.deepEqual(r.currencies, ['CHF', 'EUR'])
    assert.equal(r.totals.gross, 10000) // primary = CHF (majority)
    assert.ok(r.by_currency)
    assert.equal(r.by_currency!.EUR.gross, 2000)
    assert.equal(r.by_currency!.CHF.gross, 10000)
  })
})

describe('prevMonthKey', () => {
  it('decrements within a year and across the year boundary', () => {
    assert.equal(prevMonthKey('2026-07'), '2026-06')
    assert.equal(prevMonthKey('2026-01'), '2025-12')
  })
})

describe('monthRange', () => {
  it('returns the Zurich month boundaries as UTC instants (winter)', () => {
    const { start, end } = monthRange('2026-01')
    // Jan 1 00:00 CET = Dec 31 23:00 UTC.
    assert.equal(start.toISOString(), '2025-12-31T23:00:00.000Z')
    assert.equal(end.toISOString(), '2026-01-31T23:00:00.000Z')
  })

  it('handles the CET→CEST switch (summer offset)', () => {
    const { start, end } = monthRange('2026-04')
    // Apr 1 00:00 CEST = Mar 31 22:00 UTC.
    assert.equal(start.toISOString(), '2026-03-31T22:00:00.000Z')
    assert.equal(end.toISOString(), '2026-04-30T22:00:00.000Z')
  })
})
