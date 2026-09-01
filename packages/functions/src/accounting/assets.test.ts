import assert from 'node:assert/strict'
import { assetBookValue, DEFAULT_USEFUL_LIFE_MONTHS, ASSET_CATEGORIES } from '@linyup/shared'

// Indicative straight-line valuation (shared accounting/assets.ts): whole-month
// UTC granularity, acquisition month = tranche 1, floor(cost·m/life) rounding
// that lands EXACTLY on cost in the final month. These are the figures the
// register page and the statement-of-assets report display — and the future
// accrual activation's NBV carry-in reads the same function.

const ms = (y: number, m: number, d = 15) => Date.UTC(y, m - 1, d)

describe('assetBookValue', () => {
  const base = { cost_minor: 600_000, useful_life_months: 60, acquired_at_ms: ms(2026, 1) }

  it('counts the acquisition month as the first tranche', () => {
    const v = assetBookValue(base, ms(2026, 1, 31))
    assert.equal(v.months_elapsed, 1)
    assert.equal(v.accumulated_minor, 10_000) // 600000 / 60
    assert.equal(v.book_value_minor, 590_000)
    assert.equal(v.fully_depreciated, false)
  })

  it('is zero before the acquisition month', () => {
    const v = assetBookValue(base, ms(2025, 12, 31))
    assert.equal(v.months_elapsed, 0)
    assert.equal(v.accumulated_minor, 0)
    assert.equal(v.book_value_minor, base.cost_minor)
  })

  it('accrues straight-line mid-life', () => {
    // Jan 2026 … Jun 2028 inclusive = 30 months of 60.
    const v = assetBookValue(base, ms(2028, 6))
    assert.equal(v.months_elapsed, 30)
    assert.equal(v.accumulated_minor, 300_000)
    assert.equal(v.book_value_minor, 300_000)
  })

  it('clamps at the schedule end and lands EXACTLY on cost — book value 0, no rounding residue', () => {
    for (const asOf of [ms(2030, 12), ms(2031, 6), ms(2040, 1)]) {
      const v = assetBookValue(base, asOf)
      assert.equal(v.months_elapsed, 60)
      assert.equal(v.accumulated_minor, base.cost_minor)
      assert.equal(v.book_value_minor, 0)
      assert.equal(v.fully_depreciated, true)
    }
  })

  it('distributes rounding across the schedule when cost does not divide by life', () => {
    const odd = { cost_minor: 100_000, useful_life_months: 36, acquired_at_ms: ms(2026, 1) }
    assert.equal(assetBookValue(odd, ms(2026, 1)).accumulated_minor, 2_777) // floor(100000/36)
    assert.equal(assetBookValue(odd, ms(2028, 11)).accumulated_minor, 97_222) // month 35
    assert.equal(assetBookValue(odd, ms(2028, 12)).accumulated_minor, 100_000) // month 36 — exact
    // Monotonic: no month ever shows less accumulated than the one before.
    let prev = 0
    for (let m = 0; m < 36; m += 1) {
      const v = assetBookValue(odd, ms(2026, 1 + m, 20))
      assert.ok(v.accumulated_minor >= prev)
      prev = v.accumulated_minor
    }
  })

  it('treats a life below one month as one (fully depreciated in the acquisition month)', () => {
    const v = assetBookValue({ ...base, useful_life_months: 0 }, ms(2026, 1, 31))
    assert.equal(v.months_elapsed, 1)
    assert.equal(v.accumulated_minor, base.cost_minor)
    assert.equal(v.fully_depreciated, true)
  })

  it('ships a default useful life for every category', () => {
    for (const c of ASSET_CATEGORIES) {
      assert.ok(DEFAULT_USEFUL_LIFE_MONTHS[c] >= 1, c)
    }
  })
})
