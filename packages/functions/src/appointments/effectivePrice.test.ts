import assert from 'node:assert/strict'
import { resolveEffectiveAppointmentPrice, type ActivityDuration } from '@linyup/shared'

// Unit tests for the appointment PRICE gate (independent of the ACCESS gate).
// Run with: pnpm --filter @linyup/functions test (requires @linyup/shared built
// first — turbo builds deps in CI).

describe('resolveEffectiveAppointmentPrice', () => {
  it('an unpriced duration always resolves free, regardless of held types', () => {
    const unpriced: ActivityDuration = { minutes: 60 }
    assert.deepEqual(resolveEffectiveAppointmentPrice(unpriced, []), { free: true, amount: null })
    assert.deepEqual(resolveEffectiveAppointmentPrice(unpriced, ['sub_a']), { free: true, amount: null })
  })

  it('a priced duration with no matching entries costs base for a guest', () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const result = resolveEffectiveAppointmentPrice(priced, [])
    assert.equal(result.free, false)
    assert.equal(result.amount, 85)
    assert.equal(result.viaSubscriptionTypeId, null)
  })

  it('a priced duration with NO subscriptionPricing entry costs base even for a subscriber — the benefit is explicit data, never implied', () => {
    const priced: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const result = resolveEffectiveAppointmentPrice(priced, ['premium'])
    assert.equal(result.free, false)
    assert.equal(result.amount, 85)
  })

  it('an "included" (priceAmount: null) matching entry is free and beats any amount', () => {
    const duration: ActivityDuration = {
      minutes: 60,
      priceAmount: 85,
      subscriptionPricing: [{ subscriptionTypeId: 'premium', priceAmount: null }],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['premium'])
    assert.deepEqual(result, { free: true, amount: null, viaSubscriptionTypeId: 'premium' })
  })

  it('a matching priced entry (a member price) beats the base price', () => {
    const duration: ActivityDuration = {
      minutes: 60,
      priceAmount: 85,
      subscriptionPricing: [{ subscriptionTypeId: 'basic', priceAmount: 40 }],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['basic'])
    assert.equal(result.free, false)
    assert.equal(result.amount, 40)
    assert.equal(result.viaSubscriptionTypeId, 'basic')
  })

  it('holding TWO types with different entries pays the LOWEST amount', () => {
    const duration: ActivityDuration = {
      minutes: 60,
      priceAmount: 85,
      subscriptionPricing: [
        { subscriptionTypeId: 'basic', priceAmount: 60 },
        { subscriptionTypeId: 'plus', priceAmount: 40 },
      ],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['basic', 'plus'])
    assert.equal(result.amount, 40)
    assert.equal(result.viaSubscriptionTypeId, 'plus')
  })

  it('an "included" entry wins outright even when another held entry has a lower-looking numeric price — included always beats an amount', () => {
    const duration: ActivityDuration = {
      minutes: 60,
      priceAmount: 85,
      subscriptionPricing: [
        { subscriptionTypeId: 'basic', priceAmount: 10 },
        { subscriptionTypeId: 'vip', priceAmount: null },
      ],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['basic', 'vip'])
    assert.deepEqual(result, { free: true, amount: null, viaSubscriptionTypeId: 'vip' })
  })

  it('non-matching subscriptionPricing entries are ignored — held types must intersect', () => {
    const duration: ActivityDuration = {
      minutes: 60,
      priceAmount: 85,
      subscriptionPricing: [{ subscriptionTypeId: 'other', priceAmount: 20 }],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['basic'])
    assert.equal(result.amount, 85)
    assert.equal(result.viaSubscriptionTypeId, null)
  })

  it('defaults heldSubscriptionTypeIds to empty when omitted', () => {
    const duration: ActivityDuration = { minutes: 60, priceAmount: 85 }
    const result = resolveEffectiveAppointmentPrice(duration)
    assert.equal(result.amount, 85)
  })

  it('an unpriced base with a matching priced (non-included) entry still resolves that entry\'s price — held-type coverage need not depend on a base price existing', () => {
    const duration: ActivityDuration = {
      minutes: 30,
      subscriptionPricing: [{ subscriptionTypeId: 'basic', priceAmount: 15 }],
    }
    const result = resolveEffectiveAppointmentPrice(duration, ['basic'])
    assert.equal(result.free, false)
    assert.equal(result.amount, 15)
  })
})
