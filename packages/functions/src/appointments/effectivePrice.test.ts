import assert from 'node:assert/strict'
import {
  MIN_CHARGE_MAJOR,
  resolveEffectiveAppointmentPrice,
  type ActivityDuration,
  type ActivityMemberBenefit,
} from '@linyup/shared'

// Unit tests for the appointment PRICE gate — "the price is the gate": there is
// no separate access check for appointments any more (see docs/appointments.md
// "Paid appointments" + the simplify-appointment-pricing plan). Member benefit
// is ONE rule per activity (`ActivityMemberBenefit`), never a per-duration ×
// per-subscription-type matrix (the 10 tests that used to live here died with
// that matrix).
// Run with: pnpm --filter @linyup/functions test (requires @linyup/shared built
// first — turbo builds deps in CI).

describe('resolveEffectiveAppointmentPrice', () => {
  it('an unpriced duration always resolves free, regardless of held types or benefit', () => {
    const unpriced: ActivityDuration = { minutes: 60 }
    const benefit: ActivityMemberBenefit = { subscriptionTypeIds: ['sub_a'], kind: 'included' }
    assert.deepEqual(resolveEffectiveAppointmentPrice(unpriced, []), { free: true, amount: null })
    assert.deepEqual(resolveEffectiveAppointmentPrice(unpriced, ['sub_a'], benefit), {
      free: true,
      amount: null,
    })
  })

  it('a priced duration with no benefit configured costs base for a guest', () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const result = resolveEffectiveAppointmentPrice(priced, [])
    assert.equal(result.free, false)
    assert.equal(result.amount, 85)
    assert.equal(result.viaSubscriptionTypeId, null)
  })

  it('a priced duration with a benefit costs base when the caller holds none of the listed types', () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = { subscriptionTypeIds: ['premium'], kind: 'included' }
    const result = resolveEffectiveAppointmentPrice(priced, ['other'], benefit)
    assert.equal(result.free, false)
    assert.equal(result.amount, 85)
    assert.equal(result.viaSubscriptionTypeId, null)
  })

  it("kind 'included': a held benefit type books free, and viaSubscriptionTypeId is that type", () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = { subscriptionTypeIds: ['premium'], kind: 'included' }
    const result = resolveEffectiveAppointmentPrice(priced, ['premium'], benefit)
    assert.deepEqual(result, { free: true, amount: null, viaSubscriptionTypeId: 'premium' })
  })

  it("kind 'discount': a held benefit type pays the correctly rounded discounted amount", () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = {
      subscriptionTypeIds: ['basic'],
      kind: 'discount',
      discountPercent: 20,
    }
    const result = resolveEffectiveAppointmentPrice(priced, ['basic'], benefit)
    // 85 * 0.8 = 68.00
    assert.equal(result.free, false)
    assert.equal(result.amount, 68)
    assert.equal(result.viaSubscriptionTypeId, 'basic')
  })

  it("kind 'discount': rounds to 2 decimals", () => {
    const priced: ActivityDuration = { minutes: 45, priceAmount: 45 }
    const benefit: ActivityMemberBenefit = {
      subscriptionTypeIds: ['basic'],
      kind: 'discount',
      discountPercent: 33,
    }
    const result = resolveEffectiveAppointmentPrice(priced, ['basic'], benefit)
    // 45 * 0.67 = 30.15
    assert.equal(result.amount, 30.15)
  })

  it("kind 'discount': the discounted amount is clamped to Stripe's 0.50 floor, never lower", () => {
    const priced: ActivityDuration = { minutes: 30, priceAmount: 1 }
    const benefit: ActivityMemberBenefit = {
      subscriptionTypeIds: ['basic'],
      kind: 'discount',
      discountPercent: 90,
    }
    const result = resolveEffectiveAppointmentPrice(priced, ['basic'], benefit)
    // 1 * 0.10 = 0.10 -> clamped to the shared floor (import, don't re-literal —
    // the clamp and the checkout guard must never drift apart).
    assert.equal(result.free, false)
    assert.equal(result.amount, MIN_CHARGE_MAJOR)
    assert.equal(result.viaSubscriptionTypeId, 'basic')
  })

  it("kind 'discount': a missing or non-positive discountPercent falls back to base price", () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const noPercent: ActivityMemberBenefit = { subscriptionTypeIds: ['basic'], kind: 'discount' }
    const zeroPercent: ActivityMemberBenefit = {
      subscriptionTypeIds: ['basic'],
      kind: 'discount',
      discountPercent: 0,
    }
    assert.deepEqual(resolveEffectiveAppointmentPrice(priced, ['basic'], noPercent), {
      free: false,
      amount: 85,
      viaSubscriptionTypeId: null,
    })
    assert.deepEqual(resolveEffectiveAppointmentPrice(priced, ['basic'], zeroPercent), {
      free: false,
      amount: 85,
      viaSubscriptionTypeId: null,
    })
  })

  it("kind 'discount': discountPercent >= 100 clamps to the 0.50 floor rather than going free", () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = {
      subscriptionTypeIds: ['basic'],
      kind: 'discount',
      discountPercent: 150,
    }
    const result = resolveEffectiveAppointmentPrice(priced, ['basic'], benefit)
    assert.equal(result.free, false)
    assert.equal(result.amount, MIN_CHARGE_MAJOR)
    assert.equal(result.viaSubscriptionTypeId, 'basic')
  })

  it('an empty subscriptionTypeIds list on the benefit resolves to base — no benefit to match', () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = { subscriptionTypeIds: [], kind: 'included' }
    const result = resolveEffectiveAppointmentPrice(priced, ['premium'], benefit)
    assert.equal(result.free, false)
    assert.equal(result.amount, 85)
    assert.equal(result.viaSubscriptionTypeId, null)
  })

  it("holding multiple benefit types: the FIRST id in the benefit's configured order wins for 'included'", () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const benefit: ActivityMemberBenefit = {
      subscriptionTypeIds: ['elite', 'basic'],
      kind: 'included',
    }
    // Caller holds both 'basic' and 'elite' — 'elite' is listed first on the benefit.
    const result = resolveEffectiveAppointmentPrice(priced, ['basic', 'elite'], benefit)
    assert.deepEqual(result, { free: true, amount: null, viaSubscriptionTypeId: 'elite' })
  })
})
