import assert from 'node:assert/strict'
import {
  CHART_TEMPLATES,
  buildClosingEntry,
  buildEntryFromFinanceTxn,
  buildReversalEntry,
  validateManualEntryInput,
  type AccountingSettings,
  type PostableFinanceTxn,
} from '@linyup/shared'

// Unit tests for the pure posting engine — every FinanceTxnType must fold into
// a balanced entry against every chart template's mapping.
// Run with: pnpm --filter @linyup/functions test

const T0 = Date.UTC(2026, 5, 14, 10, 0) // June 2026 in Zurich

const settingsFor = (template: keyof typeof CHART_TEMPLATES): AccountingSettings => ({
  base_currency: 'CHF',
  fiscal_year_start_month: 1,
  chart_template: template,
  mapping: CHART_TEMPLATES[template].mapping,
  closed_through_fiscal_year: null,
  seeded_at: { toDate: () => new Date(0), toMillis: () => 0, seconds: 0, nanoseconds: 0 },
  version: 1,
})

const txn = (over: Partial<PostableFinanceTxn> = {}): PostableFinanceTxn => ({
  id: 'connect:charge:pi_1',
  teamId: 't1',
  type: 'charge',
  source: 'connect',
  category: 'membership',
  currency: 'CHF',
  gross: 5000,
  stripe_fee: -145,
  platform_fee: -35,
  net: 4820,
  occurred_at_ms: T0,
  month: '2026-06',
  description: 'Monthly Unlimited',
  ...over,
})

const lineFor = (entry: { lines: { account_code: string; debit: number; credit: number }[] }, code: string) =>
  entry.lines.find((l) => l.account_code === code)

describe('buildEntryFromFinanceTxn', () => {
  const settings = settingsFor('ch_kmu')

  it('posts a gateway charge: Dr clearing/fees, Cr revenue', () => {
    const e = buildEntryFromFinanceTxn(txn(), settings)!
    assert.equal(e.id, 'txn:connect:charge:pi_1')
    assert.equal(e.period, '2026-06')
    assert.equal(e.fiscal_year, 2026)
    assert.equal(e.total_debit, e.total_credit)
    assert.equal(lineFor(e, '1022')!.debit, 4820) // clearing net
    assert.equal(lineFor(e, '6940')!.debit, 145) // stripe fee expense
    assert.equal(lineFor(e, '6941')!.debit, 35) // platform fee expense
    assert.equal(lineFor(e, '3400')!.credit, 5000) // membership revenue
  })

  it('posts a manual charge: Dr cash, Cr revenue', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'manual:charge:x', source: 'manual', category: 'drop_in', gross: 1500, stripe_fee: 0, platform_fee: 0, net: 1500 }),
      settings
    )!
    assert.equal(e.lines.length, 2)
    assert.equal(lineFor(e, '1000')!.debit, 1500)
    assert.equal(lineFor(e, '3401')!.credit, 1500)
  })

  it('posts a refund as the contra entry with the fee return', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'connect:refund:re_1', type: 'refund', gross: -2000, stripe_fee: 0, platform_fee: 14, net: -1986 }),
      settings
    )!
    assert.equal(lineFor(e, '3400')!.debit, 2000) // revenue contra
    assert.equal(lineFor(e, '1022')!.credit, 1986) // clearing out
    assert.equal(lineFor(e, '6941')!.credit, 14) // platform fee returned reduces expense
    assert.equal(e.total_debit, 2000)
  })

  it('posts a dispute to the chargeback account with the dispute fee', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'connect:dispute:dp_1', type: 'dispute', gross: -5000, stripe_fee: -1500, platform_fee: 0, net: -6500 }),
      settings
    )!
    assert.equal(lineFor(e, '3901')!.debit, 5000)
    assert.equal(lineFor(e, '6940')!.debit, 1500)
    assert.equal(lineFor(e, '1022')!.credit, 6500)
  })

  it('posts a won dispute reversal as the mirror', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'connect:dispute_reversal:dp_1', type: 'dispute_reversal', gross: 5000, stripe_fee: 1500, platform_fee: 0, net: 6500 }),
      settings
    )!
    assert.equal(lineFor(e, '1022')!.debit, 6500)
    assert.equal(lineFor(e, '3901')!.credit, 5000)
    assert.equal(lineFor(e, '6940')!.credit, 1500)
  })

  it('posts a payout: Dr bank, Cr clearing', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'connect:payout:po_1', type: 'payout', gross: 0, stripe_fee: 0, platform_fee: 0, net: -12000 }),
      settings
    )!
    assert.equal(e.lines.length, 2)
    assert.equal(lineFor(e, '1020')!.debit, 12000)
    assert.equal(lineFor(e, '1022')!.credit, 12000)
  })

  it('posts a failed payout as the return movement', () => {
    const e = buildEntryFromFinanceTxn(
      txn({ id: 'connect:payout:po_1:failed', type: 'payout', gross: 0, stripe_fee: 0, platform_fee: 0, net: 12000 }),
      settings
    )!
    assert.equal(lineFor(e, '1020')!.credit, 12000)
    assert.equal(lineFor(e, '1022')!.debit, 12000)
  })

  it('skips foreign-currency rows (single-currency v1 ledger)', () => {
    assert.equal(buildEntryFromFinanceTxn(txn({ currency: 'EUR' }), settings), null)
  })

  it('skips all-zero rows', () => {
    assert.equal(
      buildEntryFromFinanceTxn(txn({ gross: 0, stripe_fee: 0, platform_fee: 0, net: 0 }), settings),
      null
    )
  })

  it('respects a non-calendar fiscal year start', () => {
    const s = { ...settings, fiscal_year_start_month: 4 }
    const e = buildEntryFromFinanceTxn(txn({ month: '2027-02', occurred_at_ms: Date.UTC(2027, 1, 10) }), s)!
    assert.equal(e.fiscal_year, 2026) // Feb 2027 belongs to FY 2026 (Apr 2026 – Mar 2027)
  })

  const types: PostableFinanceTxn[] = [
    txn(),
    txn({ id: 'r', type: 'refund', gross: -2000, stripe_fee: 0, platform_fee: 14, net: -1986 }),
    txn({ id: 'd', type: 'dispute', gross: -5000, stripe_fee: -1500, platform_fee: 0, net: -6500 }),
    txn({ id: 'dr', type: 'dispute_reversal', gross: 5000, stripe_fee: 1500, platform_fee: 0, net: 6500 }),
    txn({ id: 'p', type: 'payout', gross: 0, stripe_fee: 0, platform_fee: 0, net: -3000 }),
    txn({ id: 'a', type: 'adjustment', gross: -100, stripe_fee: 0, platform_fee: 0, net: -100, category: 'other' }),
  ]
  const sources: PostableFinanceTxn['source'][] = ['connect', 'byo_stripe', 'payrexx', 'manual']

  for (const template of ['ch_kmu', 'de_skr04', 'it_standard'] as const) {
    it(`balances every type × source against the ${template} mapping`, () => {
      const s = settingsFor(template)
      for (const base of types) {
        for (const source of sources) {
          const e = buildEntryFromFinanceTxn({ ...base, source }, s)
          if (e) {
            assert.equal(e.total_debit, e.total_credit, `${template} ${base.type} ${source}`)
            assert.ok(e.lines.every((l) => (l.debit > 0) !== (l.credit > 0)))
          }
        }
      }
    })
  }
})

describe('buildReversalEntry', () => {
  it('swaps sides and stays balanced', () => {
    const original = buildEntryFromFinanceTxn(txn(), settingsFor('ch_kmu'))!
    const rev = buildReversalEntry(
      { id: original.id, teamId: 't1', description: original.description, currency: original.currency, lines: original.lines },
      { id: `rev:${original.id}`, dateMs: T0, period: '2026-06', fiscalYearStartMonth: 1, createdBy: 'u1' }
    )
    assert.equal(rev.reverses, original.id)
    assert.equal(rev.total_debit, original.total_credit)
    const revenue = rev.lines.find((l) => l.account_code === '3400')!
    assert.equal(revenue.debit, 5000) // was a credit on the original
  })
})

describe('validateManualEntryInput', () => {
  const accounts = [
    { code: '1000', active: true },
    { code: '2800', active: true },
    { code: '6000', active: false },
  ]
  const settings = { fiscal_year_start_month: 1, closed_through_fiscal_year: 2024 }
  const now = Date.UTC(2026, 5, 20)
  const valid = {
    dateMs: Date.UTC(2026, 5, 14),
    description: 'Opening balance',
    lines: [
      { account_code: '1000', debit: 10000, credit: 0 },
      { account_code: '2800', debit: 0, credit: 10000 },
    ],
  }

  it('accepts a balanced two-line entry', () => {
    assert.deepEqual(validateManualEntryInput(valid, accounts, settings, now, '2026-06'), [])
  })

  it('rejects unbalanced, single-line, and both-sides lines', () => {
    assert.ok(
      validateManualEntryInput(
        { ...valid, lines: [valid.lines[0], { account_code: '2800', debit: 0, credit: 9000 }] },
        accounts, settings, now, '2026-06'
      ).includes('unbalanced')
    )
    assert.ok(
      validateManualEntryInput({ ...valid, lines: [valid.lines[0]] }, accounts, settings, now, '2026-06').includes('line_count')
    )
    assert.ok(
      validateManualEntryInput(
        { ...valid, lines: [{ account_code: '1000', debit: 100, credit: 100 }, valid.lines[1]] },
        accounts, settings, now, '2026-06'
      ).some((e) => e.startsWith('line_amounts'))
    )
  })

  it('rejects floats and negatives', () => {
    assert.ok(
      validateManualEntryInput(
        { ...valid, lines: [{ account_code: '1000', debit: 100.5, credit: 0 }, { account_code: '2800', debit: 0, credit: 100.5 }] },
        accounts, settings, now, '2026-06'
      ).some((e) => e.startsWith('line_amounts'))
    )
  })

  it('rejects unknown and inactive accounts', () => {
    const errors = validateManualEntryInput(
      { ...valid, lines: [{ account_code: '9999', debit: 100, credit: 0 }, { account_code: '6000', debit: 0, credit: 100 }] },
      accounts, settings, now, '2026-06'
    )
    assert.ok(errors.includes('unknown_account:9999'))
    assert.ok(errors.includes('inactive_account:6000'))
  })

  it('rejects future dates and closed fiscal years', () => {
    assert.ok(
      validateManualEntryInput({ ...valid, dateMs: now + 86400000 }, accounts, settings, now, '2026-06').includes('future_date')
    )
    assert.ok(
      validateManualEntryInput(valid, accounts, settings, now, '2024-06').includes('closed_fiscal_year')
    )
  })
})

describe('buildClosingEntry', () => {
  const settings = settingsFor('ch_kmu')
  const accounts = CHART_TEMPLATES.ch_kmu.accounts.map(({ code, type }) => ({ code, type }))

  it('zeroes P&L accounts and posts the profit to retained earnings', () => {
    const totals = {
      '3400': { debit: 0, credit: 120000 }, // revenue
      '6940': { debit: 3000, credit: 0 }, // fees expense
      '1022': { debit: 117000, credit: 0 }, // asset — must be ignored
    }
    const e = buildClosingEntry(2026, totals, accounts, settings, { dateMs: Date.UTC(2026, 11, 31), createdBy: 'u1' })!
    assert.equal(e.id, 'close:2026')
    assert.equal(e.period, '2026-12')
    assert.equal(e.total_debit, e.total_credit)
    assert.equal(lineFor(e, '3400')!.debit, 120000) // revenue zeroed
    assert.equal(lineFor(e, '6940')!.credit, 3000) // expense zeroed
    assert.equal(lineFor(e, '2979')!.credit, 117000) // profit → retained earnings
    assert.equal(lineFor(e, '1022'), undefined) // balance-sheet account untouched
  })

  it('posts a loss as a debit to retained earnings', () => {
    const totals = { '3400': { debit: 0, credit: 1000 }, '6000': { debit: 5000, credit: 0 } }
    const e = buildClosingEntry(2026, totals, accounts, settings, { dateMs: Date.UTC(2026, 11, 31), createdBy: 'u1' })!
    assert.equal(lineFor(e, '2979')!.debit, 4000)
  })

  it('returns null when there is nothing to close', () => {
    assert.equal(
      buildClosingEntry(2026, { '1020': { debit: 5000, credit: 0 } }, accounts, settings, { dateMs: T0, createdBy: 'u1' }),
      null
    )
  })
})
