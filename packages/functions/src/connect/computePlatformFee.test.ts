import assert from 'node:assert/strict'
import {
  applyTakeRate,
  computePlatformFee,
  CONNECT_TAKE_RATE,
  type ConnectTakeRate,
} from '@linyup/shared'

// Unit tests for the central platform-fee calculation (the Connect take-rate).
// Money is always integer Rappen. Run with: pnpm --filter @linyup/functions test
// (requires @linyup/shared to be built first — turbo builds deps in CI).

describe('computePlatformFee', () => {
  // CHF 100.00 = 10_000 Rappen — exercises each tier at the configured rate.
  const CHF_100 = 10_000

  it('applies the configured per-tier rate on a round amount', () => {
    assert.equal(computePlatformFee({ tier: 'free', amount: CHF_100 }), 170) // 1.7%
    assert.equal(computePlatformFee({ tier: 'coach', amount: CHF_100 }), 120) // 1.2%
    assert.equal(computePlatformFee({ tier: 'studio', amount: CHF_100 }), 70) // 0.7%
    assert.equal(computePlatformFee({ tier: 'organization', amount: CHF_100 }), 40) // 0.4%
  })

  it('floors fractional Rappen (never rounds up, never returns a float)', () => {
    // 333 * 70 / 10000 = 2.331 → 2
    const fee = computePlatformFee({ tier: 'studio', amount: 333 })
    assert.equal(fee, 2)
    assert.ok(Number.isInteger(fee))
  })

  it('returns 0 for a zero or negative amount (zero-fee handling)', () => {
    assert.equal(computePlatformFee({ tier: 'studio', amount: 0 }), 0)
    assert.equal(computePlatformFee({ tier: 'studio', amount: -500 }), 0)
  })

  it('throws on a non-integer amount (guards against float Rappen)', () => {
    assert.throws(() => computePlatformFee({ tier: 'studio', amount: 100.5 }), /integer/)
  })

  it('falls back to the free (highest) rate for an unknown tier — never zero', () => {
    // Defensive: a misconfigured tier must not silently ship a free transaction.
    const fee = computePlatformFee({ tier: 'bogus' as never, amount: CHF_100 })
    assert.equal(fee, applyTakeRate(CHF_100, CONNECT_TAKE_RATE.free))
    assert.equal(fee, 170)
  })

  it('ignores the model (both byo/managed use the same take-rate in Phase 1)', () => {
    assert.equal(
      computePlatformFee({ tier: 'coach', amount: CHF_100, model: 'byo' }),
      computePlatformFee({ tier: 'coach', amount: CHF_100, model: 'managed' })
    )
  })
})

describe('applyTakeRate', () => {
  it('raises the fee to the configured minimum on small charges', () => {
    // 2% of 100 Rappen = 2, but minimum is 50 → 50.
    const rate: ConnectTakeRate = { bps: 200, minFeeRappen: 50 }
    assert.equal(applyTakeRate(100, rate), 50)
  })

  it('does not apply the minimum above it', () => {
    const rate: ConnectTakeRate = { bps: 200, minFeeRappen: 50 }
    // 2% of 10_000 = 200, well above the 50 minimum.
    assert.equal(applyTakeRate(10_000, rate), 200)
  })

  it('clamps the fee to never exceed the charge amount', () => {
    // minimum (200) larger than a tiny charge (100) must not over-charge.
    const rate: ConnectTakeRate = { bps: 200, minFeeRappen: 200 }
    assert.equal(applyTakeRate(100, rate), 100)
  })

  it('returns 0 for a zero-rate config', () => {
    const rate: ConnectTakeRate = { bps: 0, minFeeRappen: 0 }
    assert.equal(applyTakeRate(10_000, rate), 0)
  })
})
