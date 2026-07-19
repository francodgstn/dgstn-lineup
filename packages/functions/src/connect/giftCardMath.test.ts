import assert from 'node:assert/strict'
import {
  MIN_CHARGE_MAJOR,
  formatGiftCardCode,
  giftCardAvailable,
  planGiftCardRedemption,
} from '@linyup/shared'

// Unit tests for the gift-card money math (E3) — the reserve/commit safety
// depends on these being exact. Run with: pnpm --filter @linyup/functions test

const ts = (ms: number) => ({ toMillis: () => ms }) as never

describe('giftCardAvailable', () => {
  const now = 1_000_000
  it('balance minus LIVE holds only; expired holds do not reserve', () => {
    const card = {
      status: 'active' as const,
      balance: 100,
      holds: {
        cs_live: { amount: 30, expires_at: ts(now + 60_000) },
        cs_stale: { amount: 50, expires_at: ts(now - 1) },
      },
    }
    assert.equal(giftCardAvailable(card, now), 70)
  })
  it('void/depleted cards have nothing available', () => {
    assert.equal(giftCardAvailable({ status: 'void', balance: 100 }, now), 0)
    assert.equal(giftCardAvailable({ status: 'depleted', balance: 0 }, now), 0)
  })
  it('over-held cards floor at 0 (never negative)', () => {
    const card = {
      status: 'active' as const,
      balance: 20,
      holds: { a: { amount: 30, expires_at: ts(now + 1000) } },
    }
    assert.equal(giftCardAvailable(card, now), 0)
  })
})

describe('planGiftCardRedemption', () => {
  it('full cover: drawdown = total, residual 0 (Stripe skipped)', () => {
    assert.deepEqual(planGiftCardRedemption(100, 45), { drawdown: 45, residual: 0 })
    assert.deepEqual(planGiftCardRedemption(45, 45), { drawdown: 45, residual: 0 })
  })
  it('partial cover: residual charged via Stripe', () => {
    assert.deepEqual(planGiftCardRedemption(30, 45), { drawdown: 30, residual: 15 })
  })
  it('sub-minimum residual: drawdown shrinks so the charge stays valid', () => {
    // available 44.8 of 45 would leave 0.20 — instead charge the 0.50 floor.
    assert.deepEqual(planGiftCardRedemption(44.8, 45), {
      drawdown: 44.5,
      residual: MIN_CHARGE_MAJOR,
    })
  })
  it('nothing available / worthless totals return null', () => {
    assert.equal(planGiftCardRedemption(0, 45), null)
    assert.equal(planGiftCardRedemption(20, 0), null)
    // A 0.40 total can never split validly with a partial card (0.30 avail).
    assert.equal(planGiftCardRedemption(0.3, 0.4), null)
  })
  it('float artifacts stay two-decimal', () => {
    const plan = planGiftCardRedemption(10.1, 30.3)
    assert.deepEqual(plan, { drawdown: 10.1, residual: 20.2 })
  })
})

describe('formatGiftCardCode', () => {
  it('shapes GC-XXXX-XXXX from bytes, ambiguous glyphs excluded', () => {
    const code = formatGiftCardCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    assert.match(code, /^GC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    assert.ok(!/[01OI]/.test(code.slice(3)))
  })
})
