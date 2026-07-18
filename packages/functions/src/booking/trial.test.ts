import assert from 'node:assert/strict'
import { resolveFreeTrialPaymentGate, resolveTrialEligibility } from './index'

// Unit tests for the paid-trial pure decision logic — shared by bookSession's
// free trial door and createDropInCheckout's `trial: true` checkout (see
// booking/index.ts's module doc comment). The trial's ELIGIBILITY semantics
// (newcomer/guest-only, once) are unchanged by paid trials — only the money
// changes.

describe('resolveFreeTrialPaymentGate', () => {
  it('an absent trialPriceAmount always passes — the free trial door is untouched', () => {
    assert.deepEqual(resolveFreeTrialPaymentGate(undefined), { ok: true })
  })

  it('a null trialPriceAmount also passes (explicit "no price")', () => {
    assert.deepEqual(resolveFreeTrialPaymentGate(null), { ok: true })
  })

  it('a numeric trialPriceAmount refuses the free path with payment_required + the price', () => {
    assert.deepEqual(resolveFreeTrialPaymentGate(30), {
      ok: false,
      reason: 'payment_required',
      priceAmount: 30,
    })
  })

  it('a zero trialPriceAmount is still a number — it refuses too (CHF 0 is a configured price, not "unset")', () => {
    assert.deepEqual(resolveFreeTrialPaymentGate(0), {
      ok: false,
      reason: 'payment_required',
      priceAmount: 0,
    })
  })
})

describe('resolveTrialEligibility', () => {
  it('no trial_used_at (undefined/null) passes — first trial for this email', () => {
    assert.deepEqual(resolveTrialEligibility(undefined), { ok: true })
    assert.deepEqual(resolveTrialEligibility(null), { ok: true })
  })

  it('any truthy trial_used_at (a Firestore Timestamp in production) refuses with trial_used', () => {
    assert.deepEqual(resolveTrialEligibility({ toMillis: () => 1 }), { ok: false, reason: 'trial_used' })
    assert.deepEqual(resolveTrialEligibility(true), { ok: false, reason: 'trial_used' })
  })
})
