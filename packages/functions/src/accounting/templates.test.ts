import assert from 'node:assert/strict'
import {
  CHART_TEMPLATES,
  STARTER_ENTRY_TEMPLATES,
  buildTemplateLines,
  computeNextRunMs,
  monthKey,
  resolveTemplateName,
  templateEntryId,
  validateEntryTemplate,
  type ChartTemplateId,
  type EntryTemplateDraft,
} from '@linyup/shared'

// Unit tests for the entry-template helpers (validate / lines / recurrence /
// starter-template integrity). Run with: pnpm --filter @linyup/functions test

const ACCOUNTS = [
  { code: '6000', active: true },
  { code: '1020', active: true },
  { code: '2400', active: true },
  { code: '6040', active: false },
]

const draft = (over: Partial<EntryTemplateDraft>): EntryTemplateDraft => ({
  name: 'Rent',
  debit_account_code: '6000',
  credit_account_code: '1020',
  amount_minor: 150000,
  recurrence: 'none',
  day_of_month: null,
  month_of_year: null,
  ...over,
})

describe('validateEntryTemplate', () => {
  it('accepts a valid one-off template (amount optional)', () => {
    assert.deepEqual(validateEntryTemplate(draft({}), ACCOUNTS), [])
    assert.deepEqual(validateEntryTemplate(draft({ amount_minor: null }), ACCOUNTS), [])
  })

  it('requires a name', () => {
    assert.ok(validateEntryTemplate(draft({ name: '  ' }), ACCOUNTS).includes('name_required'))
  })

  it('requires both accounts and rejects identical ones', () => {
    assert.ok(
      validateEntryTemplate(draft({ debit_account_code: '' }), ACCOUNTS).includes(
        'debit_account_required'
      )
    )
    assert.ok(
      validateEntryTemplate(draft({ credit_account_code: '' }), ACCOUNTS).includes(
        'credit_account_required'
      )
    )
    assert.ok(
      validateEntryTemplate(draft({ credit_account_code: '6000' }), ACCOUNTS).includes(
        'same_account'
      )
    )
  })

  it('rejects unknown and inactive accounts', () => {
    assert.ok(
      validateEntryTemplate(draft({ debit_account_code: '9999' }), ACCOUNTS).includes(
        'unknown_account:9999'
      )
    )
    assert.ok(
      validateEntryTemplate(draft({ debit_account_code: '6040' }), ACCOUNTS).includes(
        'inactive_account:6040'
      )
    )
  })

  it('rejects non-positive or fractional amounts', () => {
    assert.ok(
      validateEntryTemplate(draft({ amount_minor: 0 }), ACCOUNTS).includes('amount_invalid')
    )
    assert.ok(
      validateEntryTemplate(draft({ amount_minor: -100 }), ACCOUNTS).includes('amount_invalid')
    )
    assert.ok(
      validateEntryTemplate(draft({ amount_minor: 12.5 }), ACCOUNTS).includes('amount_invalid')
    )
  })

  it('recurrence requires a fixed amount and a valid day', () => {
    const r = validateEntryTemplate(
      draft({ recurrence: 'monthly', amount_minor: null, day_of_month: null }),
      ACCOUNTS
    )
    assert.ok(r.includes('amount_required_for_recurrence'))
    assert.ok(r.includes('day_of_month_range'))
    assert.ok(
      validateEntryTemplate(draft({ recurrence: 'monthly', day_of_month: 29 }), ACCOUNTS).includes(
        'day_of_month_range'
      )
    )
    assert.deepEqual(
      validateEntryTemplate(draft({ recurrence: 'monthly', day_of_month: 1 }), ACCOUNTS),
      []
    )
  })

  it('yearly additionally requires a valid month', () => {
    assert.ok(
      validateEntryTemplate(
        draft({ recurrence: 'yearly', day_of_month: 15, month_of_year: null }),
        ACCOUNTS
      ).includes('month_of_year_range')
    )
    assert.deepEqual(
      validateEntryTemplate(
        draft({ recurrence: 'yearly', day_of_month: 15, month_of_year: 3 }),
        ACCOUNTS
      ),
      []
    )
  })
})

describe('buildTemplateLines', () => {
  it('builds two balanced lines, one side each', () => {
    const lines = buildTemplateLines(
      { debit_account_code: '6000', credit_account_code: '1020' },
      150000
    )
    assert.equal(lines.length, 2)
    assert.deepEqual(lines[0], { account_code: '6000', debit: 150000, credit: 0 })
    assert.deepEqual(lines[1], { account_code: '1020', debit: 0, credit: 150000 })
    const debit = lines.reduce((s, l) => s + l.debit, 0)
    const credit = lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(debit, credit)
  })
})

describe('computeNextRunMs', () => {
  it('monthly: same month when the day is still ahead, else next month', () => {
    const afterMs = Date.UTC(2026, 6, 10) // 2026-07-10T00:00Z
    assert.equal(computeNextRunMs('monthly', 15, null, afterMs), Date.UTC(2026, 6, 15, 12))
    assert.equal(computeNextRunMs('monthly', 5, null, afterMs), Date.UTC(2026, 7, 5, 12))
  })

  it('monthly: strictly after — the occurrence at afterMs itself advances', () => {
    const at = Date.UTC(2026, 6, 15, 12)
    assert.equal(computeNextRunMs('monthly', 15, null, at), Date.UTC(2026, 7, 15, 12))
  })

  it('monthly: December rolls into January', () => {
    const afterMs = Date.UTC(2026, 11, 20)
    assert.equal(computeNextRunMs('monthly', 1, null, afterMs), Date.UTC(2027, 0, 1, 12))
  })

  it('monthly: day 28 lands in February safely', () => {
    const afterMs = Date.UTC(2027, 1, 1) // 2027-02-01
    assert.equal(computeNextRunMs('monthly', 28, null, afterMs), Date.UTC(2027, 1, 28, 12))
  })

  it('clamps out-of-range days to 1..28', () => {
    const afterMs = Date.UTC(2026, 0, 1)
    assert.equal(computeNextRunMs('monthly', 31, null, afterMs), Date.UTC(2026, 0, 28, 12))
    assert.equal(computeNextRunMs('monthly', 0, null, afterMs), Date.UTC(2026, 0, 1, 12))
  })

  it('yearly: this year when ahead, next year when passed', () => {
    const afterMs = Date.UTC(2026, 6, 10)
    assert.equal(computeNextRunMs('yearly', 1, 9, afterMs), Date.UTC(2026, 8, 1, 12))
    assert.equal(computeNextRunMs('yearly', 1, 3, afterMs), Date.UTC(2027, 2, 1, 12))
  })

  it('noon UTC buckets into the intended Europe/Zurich period', () => {
    const runMs = computeNextRunMs('monthly', 1, null, Date.UTC(2026, 11, 20))
    assert.equal(monthKey(runMs), '2027-01')
  })
})

describe('templateEntryId', () => {
  it('is deterministic per template + period', () => {
    assert.equal(templateEntryId('tpl_rent', '2026-07'), 'manual:tpl:tpl_rent:2026-07')
  })
})

describe('STARTER_ENTRY_TEMPLATES', () => {
  it('has unique ids and en names', () => {
    const ids = STARTER_ENTRY_TEMPLATES.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const t of STARTER_ENTRY_TEMPLATES) assert.ok(t.names.en, `${t.id} missing en name`)
  })

  for (const [id, template] of Object.entries(CHART_TEMPLATES)) {
    it(`references only seeded ${id} accounts, with sensible types`, () => {
      const byCode = new Map(template.accounts.map((a) => [a.code, a]))
      for (const t of STARTER_ENTRY_TEMPLATES) {
        const dr = byCode.get(t.debit_by_chart[id as ChartTemplateId])
        const cr = byCode.get(t.credit_by_chart[id as ChartTemplateId])
        assert.ok(dr, `${t.id} debit ${t.debit_by_chart[id as ChartTemplateId]} not in ${id}`)
        assert.ok(cr, `${t.id} credit ${t.credit_by_chart[id as ChartTemplateId]} not in ${id}`)
        assert.notEqual(dr!.code, cr!.code, `${t.id} same account in ${id}`)
        // Every starter template moves money: exactly one side is a money-ish
        // asset account (bank), the other an expense or liability.
        const types = new Set([dr!.type, cr!.type])
        assert.ok(types.has('asset'), `${t.id} in ${id} should touch a money account`)
      }
    })
  }

  it('resolves localized names with en fallback', () => {
    const rent = STARTER_ENTRY_TEMPLATES.find((t) => t.id === 'tpl_rent')!
    assert.equal(resolveTemplateName(rent, 'de-CH'), 'Miete')
    assert.equal(resolveTemplateName(rent, 'pt'), 'Rent')
  })
})
