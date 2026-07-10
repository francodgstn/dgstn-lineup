import assert from 'node:assert/strict'
import {
  activityRequiresSubscription,
  contactHoldsCoveringSubscription,
} from '@linyup/shared'

const NOW = 1_800_000_000_000

function ts(ms: number) {
  return { toMillis: () => ms }
}

describe('activityRequiresSubscription', () => {
  it('returns null for open and members rules', () => {
    assert.equal(activityRequiresSubscription({ type: 'open' }), null)
    assert.equal(activityRequiresSubscription({ type: 'members' }), null)
    assert.equal(activityRequiresSubscription(undefined), null)
  })

  it('returns the ids (or empty array) for subscription rules', () => {
    assert.deepEqual(
      activityRequiresSubscription({ type: 'subscription', subscriptionTypeIds: ['a', 'b'] }),
      ['a', 'b'],
    )
    assert.deepEqual(activityRequiresSubscription({ type: 'subscription' }), [])
  })
})

describe('contactHoldsCoveringSubscription', () => {
  it('is false for a missing contact or empty allow-list', () => {
    assert.equal(contactHoldsCoveringSubscription(null, ['a'], NOW), false)
    assert.equal(contactHoldsCoveringSubscription({}, [], NOW), false)
    assert.equal(contactHoldsCoveringSubscription({}, null, NOW), false)
  })

  it('matches a live subscription from active_subscriptions', () => {
    const contact = { active_subscriptions: [{ subscription_type_id: 'a' }] }
    assert.equal(contactHoldsCoveringSubscription(contact, ['a'], NOW), true)
    assert.equal(contactHoldsCoveringSubscription(contact, ['b'], NOW), false)
  })

  it('matches the primary subscription_type_id snapshot', () => {
    assert.equal(
      contactHoldsCoveringSubscription({ subscription_type_id: 'a' }, ['a'], NOW),
      true,
    )
  })

  it('matches a valid lesson-credit balance', () => {
    const contact = {
      credit_summary: [
        { subscription_type_id: 'pack', remaining: 3, next_expires_at: ts(NOW + 1000) },
      ],
    }
    assert.equal(contactHoldsCoveringSubscription(contact, ['pack'], NOW), true)
  })

  it('ignores exhausted or expired credit balances', () => {
    const exhausted = { credit_summary: [{ subscription_type_id: 'pack', remaining: 0 }] }
    const expired = {
      credit_summary: [
        { subscription_type_id: 'pack', remaining: 5, next_expires_at: ts(NOW - 1) },
      ],
    }
    assert.equal(contactHoldsCoveringSubscription(exhausted, ['pack'], NOW), false)
    assert.equal(contactHoldsCoveringSubscription(expired, ['pack'], NOW), false)
  })

  it('a credit balance with no expiry counts', () => {
    const contact = { credit_summary: [{ subscription_type_id: 'pack', remaining: 1 }] }
    assert.equal(contactHoldsCoveringSubscription(contact, ['pack'], NOW), true)
  })
})
