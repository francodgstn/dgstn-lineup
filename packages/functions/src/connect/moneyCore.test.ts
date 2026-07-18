import assert from 'node:assert/strict'
import {
  MIN_CHARGE_MAJOR,
  MIN_CHARGE_MINOR,
  isChargeableMinorAmount,
  resolveStripeCurrency,
  toMinorUnits,
} from '@linyup/shared'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  defaultIdempotencyKey,
  requireChargeableAmountFromMajor,
  requireChargeableMinorAmount,
} from './checkout'

// Unit tests for the ONE money core (Phase A of the pricing consolidation).
// Run with: pnpm --filter @linyup/functions test

describe('money utils (shared)', () => {
  it('toMinorUnits converts major → integer minor and absorbs float artifacts', () => {
    assert.equal(toMinorUnits(49.9), 4990) // 49.9 * 100 === 4989.999… — must round
    assert.equal(toMinorUnits(0.5), 50)
    assert.equal(toMinorUnits(0), 0)
    assert.equal(toMinorUnits(1234.56), 123456)
    assert.ok(Number.isInteger(toMinorUnits(0.1 + 0.2)))
  })

  it('isChargeableMinorAmount enforces integer ≥ floor', () => {
    assert.equal(isChargeableMinorAmount(50), true)
    assert.equal(isChargeableMinorAmount(49), false)
    assert.equal(isChargeableMinorAmount(50.5), false)
    assert.equal(isChargeableMinorAmount('50'), false)
    assert.equal(isChargeableMinorAmount(NaN), false)
  })

  it('the major floor is exactly the minor floor / 100 (no constant drift)', () => {
    assert.equal(MIN_CHARGE_MAJOR, MIN_CHARGE_MINOR / 100)
  })

  it('resolveStripeCurrency is pinned to chf until the flip commit', () => {
    // Deliberate Phase-A behavior: plumbed but inert (see its doc comment).
    assert.equal(resolveStripeCurrency(undefined), 'chf')
    assert.equal(resolveStripeCurrency('CHF'), 'chf')
    assert.equal(resolveStripeCurrency('EUR'), 'chf')
    assert.equal(resolveStripeCurrency('garbage'), 'chf')
  })
})

describe('amount guards (one floor, one error shape)', () => {
  function assertBelowMinimum(fn: () => void) {
    try {
      fn()
      assert.fail('expected a below_minimum HttpsError')
    } catch (err) {
      assert.ok(err instanceof HttpsError)
      assert.equal(err.code, 'failed-precondition')
      const details = err.details as { reason?: string; min?: number }
      assert.equal(details?.reason, 'below_minimum')
      assert.equal(details?.min, MIN_CHARGE_MINOR)
    }
  }

  it('requireChargeableAmountFromMajor: 0.5 passes as 50; 0.499 throws', () => {
    assert.equal(requireChargeableAmountFromMajor(0.5), 50)
    assert.equal(requireChargeableAmountFromMajor(49.9), 4990)
    assertBelowMinimum(() => requireChargeableAmountFromMajor(0.49))
    assertBelowMinimum(() => requireChargeableAmountFromMajor(0.3))
  })

  it('requireChargeableAmountFromMajor: non-numbers throw not_priced', () => {
    for (const bad of [undefined, null, 'x', NaN, Infinity]) {
      try {
        requireChargeableAmountFromMajor(bad)
        assert.fail('expected an HttpsError')
      } catch (err) {
        assert.ok(err instanceof HttpsError)
        assert.equal(err.code, 'failed-precondition')
        assert.equal((err.details as { reason?: string })?.reason, 'not_priced')
      }
    }
  })

  it('requireChargeableMinorAmount: integer ≥ 50 passes; below floor throws unified shape', () => {
    assert.equal(requireChargeableMinorAmount(50), 50)
    assert.equal(requireChargeableMinorAmount(4990), 4990)
    assertBelowMinimum(() => requireChargeableMinorAmount(49))
  })

  it('requireChargeableMinorAmount: non-integers throw not_integer (same code)', () => {
    for (const bad of [50.5, '50', undefined, NaN]) {
      try {
        requireChargeableMinorAmount(bad)
        assert.fail('expected an HttpsError')
      } catch (err) {
        assert.ok(err instanceof HttpsError)
        assert.equal(err.code, 'failed-precondition')
        assert.equal((err.details as { reason?: string })?.reason, 'not_integer')
      }
    }
  })
})

describe('defaultIdempotencyKey — legacy formats are load-bearing (Stripe retry dedup)', () => {
  // Each callable's prefix + part order must reproduce the pre-refactor string
  // byte-for-byte; a drifted key would make Stripe treat a retried request
  // during a deploy window as a brand-new one. NEVER reorder.
  it('reproduces the eight legacy key shapes', () => {
    const bucket = String(Math.floor(Date.now() / 60_000))
    const cases: Array<[string, string[], string]> = [
      ['member-pay', ['t1', 'u1', '5000', 'belt test'], `member-pay:t1:u1:5000:belt test:${bucket}`],
      ['member-sub', ['t1', 'u1', '5000', 'month'], `member-sub:t1:u1:5000:month:${bucket}`],
      ['membership', ['t1', 'u1', 'p1'], `membership:t1:u1:p1:${bucket}`],
      ['membership-pub', ['t1', 'p1', 'c1'], `membership-pub:t1:p1:c1:${bucket}`],
      ['product-pub', ['t1', 'prod1', '_', 'c1'], `product-pub:t1:prod1:_:c1:${bucket}`],
      ['course-pub', ['t1', 'course1', 'c1'], `course-pub:t1:course1:c1:${bucket}`],
      ['dropin', ['t1', 's1', 'c1'], `dropin:t1:s1:c1:${bucket}`],
      ['apt', ['t1', 'apt_p_1', 'c1'], `apt:t1:apt_p_1:c1:${bucket}`],
    ]
    for (const [prefix, parts, expected] of cases) {
      assert.equal(defaultIdempotencyKey(prefix, ...parts), expected)
    }
  })
})
