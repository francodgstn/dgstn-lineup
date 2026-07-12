import assert from 'node:assert/strict'
import {
  FINANCE_CSV_COLUMNS,
  formatFinanceTimestamp,
  formatMinorUnits,
  toFinanceCsv,
  type FinanceCsvRow,
} from '@linyup/shared'

// Unit tests for the finance CSV serializer (documented public contract —
// see docs/finance-reports.md). Run with: pnpm --filter @linyup/functions test

const ts = (ms: number) => ({ toMillis: () => ms })

const row = (over: Partial<FinanceCsvRow> = {}): FinanceCsvRow => ({
  id: 'connect:charge:pi_1',
  occurred_at: ts(Date.UTC(2026, 5, 14, 16, 32, 11)), // 18:32:11 CEST
  month: '2026-06',
  type: 'charge',
  source: 'connect',
  source_ref: 'pi_1',
  payout_id: null,
  status: 'recorded',
  contact_id: 'c1',
  category: 'membership',
  description: 'Monthly Unlimited',
  currency: 'CHF',
  gross: 5000,
  stripe_fee: -145,
  platform_fee: -35,
  net: 4820,
  fee_source: 'balance_transaction',
  ...over,
})

describe('formatMinorUnits', () => {
  it('renders signed 2-dp major units by integer split', () => {
    assert.equal(formatMinorUnits(-1986), '-19.86')
    assert.equal(formatMinorUnits(5), '0.05')
    assert.equal(formatMinorUnits(0), '0.00')
    assert.equal(formatMinorUnits(5000), '50.00')
    assert.equal(formatMinorUnits(-5), '-0.05')
  })
  it('rejects non-integers', () => {
    assert.throws(() => formatMinorUnits(19.86))
  })
})

describe('formatFinanceTimestamp', () => {
  it('renders ISO 8601 with the Zurich offset (summer +02:00)', () => {
    assert.equal(formatFinanceTimestamp(Date.UTC(2026, 5, 14, 16, 32, 11)), '2026-06-14T18:32:11+02:00')
  })
  it('renders winter +01:00', () => {
    assert.equal(formatFinanceTimestamp(Date.UTC(2026, 0, 14, 16, 0, 0)), '2026-01-14T17:00:00+01:00')
  })
})

describe('toFinanceCsv', () => {
  it('emits the documented header and CRLF endings', () => {
    const csv = toFinanceCsv([row()])
    const lines = csv.split('\r\n')
    assert.equal(lines[0], FINANCE_CSV_COLUMNS.join(','))
    assert.equal(lines.length, 3) // header + row + trailing empty from final CRLF
    assert.equal(lines[2], '')
  })

  it('serializes a charge row with formatted amounts', () => {
    const csv = toFinanceCsv([row()])
    const line = csv.split('\r\n')[1]
    assert.equal(
      line,
      'connect:charge:pi_1,2026-06-14T18:32:11+02:00,2026-06,charge,connect,pi_1,,recorded,c1,membership,Monthly Unlimited,CHF,50.00,-1.45,-0.35,48.20,balance_transaction'
    )
  })

  it('quotes fields containing commas, quotes, and newlines (RFC 4180)', () => {
    const csv = toFinanceCsv([row({ description: 'Pack "10x", incl.\nbonus' })])
    assert.ok(csv.includes('"Pack ""10x"", incl.\nbonus"'))
  })

  it('renders empty strings for null linkage fields', () => {
    const line = toFinanceCsv([row({ contact_id: null, description: null })]).split('\r\n')[1]
    const cols = line.split(',')
    assert.equal(cols[8], '') // contact_id
    assert.equal(cols[10], '') // description
  })
})
