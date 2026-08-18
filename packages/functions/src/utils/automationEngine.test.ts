// Unit tests for automationEngine condition evaluation and the delta-aware
// subscription/affiliation trigger helpers extracted below.
//
// Tests cover:
//   1. evaluateContactConditions — 'subscription' condition honours active_subscriptions
//   2. evaluateContactConditions — legacy subscription_missing / subscription_set aliases
//   3. resolveSubIds (exported via test helper) — multi-sub union logic
//   4. resolveContactEvents (exported via test helper) — delta diff logic

import assert from 'node:assert/strict'
import {
  evaluateContactConditions,
  recordRecipient,
  RECIPIENT_ID_CAP,
  type ContactData,
  type RuleStats,
} from './automationEngine'

// ---------------------------------------------------------------------------
// Helpers replicating the pure logic from onContactWrite — we duplicate them
// here so the tests don't import the trigger module (which pulls in Firebase).
// ---------------------------------------------------------------------------

function resolveSubIds(doc: Record<string, unknown> | undefined): Set<string> {
  const ids = new Set<string>()
  if (!doc) return ids
  const primary = doc.subscription_type_id as string | undefined
  if (primary) ids.add(primary)
  const active = doc.active_subscriptions as Array<{ subscription_type_id: string }> | undefined
  for (const s of active ?? []) {
    if (s.subscription_type_id) ids.add(s.subscription_type_id)
  }
  return ids
}

interface ContactEvent {
  triggerType: string
  delta?: { subscriptionTypeId?: string }
}

function resolveContactEvents(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): ContactEvent[] {
  if (!after) return []
  const events: ContactEvent[] = []
  if (!before) {
    events.push({ triggerType: 'contact_created' })
    return events
  }

  const beforeSubIds = resolveSubIds(before)
  const afterSubIds = resolveSubIds(after)

  const hasSubChange =
    before.subscription_type_id !== after.subscription_type_id ||
    before.subscription_status !== after.subscription_status ||
    JSON.stringify([...beforeSubIds].sort()) !== JSON.stringify([...afterSubIds].sort())

  if (hasSubChange) {
    for (const id of afterSubIds) {
      if (!beforeSubIds.has(id)) {
        events.push({ triggerType: 'subscription_added', delta: { subscriptionTypeId: id } })
      }
    }
    for (const id of beforeSubIds) {
      if (!afterSubIds.has(id)) {
        events.push({ triggerType: 'subscription_removed', delta: { subscriptionTypeId: id } })
      }
    }
    events.push({ triggerType: 'subscription_changed' })
  }

  return events
}

// ---------------------------------------------------------------------------
// 1. evaluateContactConditions — subscription condition with active_subscriptions
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-15T12:00:00Z')

function makeContact(overrides: Partial<ContactData> = {}): ContactData {
  return { id: 'c1', ...overrides }
}

describe('evaluateContactConditions — unknown condition types fail closed', () => {
  it('blocks the rule when a condition type is unrecognized (e.g. legacy contact_type)', () => {
    // Regression: an ignored dead condition once turned a "welcome new trial" rule
    // into "email every new contact" — spamming shop registrations.
    const c = makeContact({ entry: 'shop' } as Partial<ContactData>)
    const conditions = [{ type: 'contact_type', value: 'trial' } as never]
    assert.equal(evaluateContactConditions(conditions, c, NOW), false)
  })
})

describe('evaluateContactConditions — subscription condition', () => {
  it('none: passes when contact has no subscription (empty active_subscriptions, no primary)', () => {
    const c = makeContact({ subscription_type_id: undefined, active_subscriptions: [] })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'none' }], c, NOW), true)
  })

  it('none: passes when active_subscriptions is absent and no primary', () => {
    const c = makeContact({})
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'none' }], c, NOW), true)
  })

  it('none: fails when contact has primary subscription_type_id only', () => {
    const c = makeContact({ subscription_type_id: 'sub-A' })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'none' }], c, NOW), false)
  })

  it('none: fails when contact has an active_subscription entry (no primary)', () => {
    const c = makeContact({ active_subscriptions: [{ subscription_type_id: 'sub-B' }] })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'none' }], c, NOW), false)
  })

  it('any: passes when contact has primary subscription_type_id only', () => {
    const c = makeContact({ subscription_type_id: 'sub-A' })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'any' }], c, NOW), true)
  })

  it('any: passes when contact has an active_subscription entry only', () => {
    const c = makeContact({ active_subscriptions: [{ subscription_type_id: 'sub-B' }] })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'any' }], c, NOW), true)
  })

  it('any: fails when contact has no subscription at all', () => {
    const c = makeContact({})
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'any' }], c, NOW), false)
  })

  it('specific id: passes when id is in active_subscriptions (not primary)', () => {
    const c = makeContact({
      subscription_type_id: 'sub-A',
      active_subscriptions: [
        { subscription_type_id: 'sub-A' },
        { subscription_type_id: 'sub-B' },
      ],
    })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'sub-B' }], c, NOW), true)
  })

  it('specific id: passes when id equals primary (no active_subscriptions)', () => {
    const c = makeContact({ subscription_type_id: 'sub-A' })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'sub-A' }], c, NOW), true)
  })

  it('specific id: fails when id is not in either set', () => {
    const c = makeContact({
      subscription_type_id: 'sub-A',
      active_subscriptions: [{ subscription_type_id: 'sub-A' }],
    })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'sub-X' }], c, NOW), false)
  })

  it('handles multiple concurrent subscriptions correctly for a specific check', () => {
    const c = makeContact({
      active_subscriptions: [
        { subscription_type_id: 'yoga' },
        { subscription_type_id: 'boxing' },
        { subscription_type_id: 'swim' },
      ],
    })
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'boxing' }], c, NOW), true)
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'swim' }], c, NOW), true)
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'tennis' }], c, NOW), false)
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'none' }], c, NOW), false)
    assert.equal(evaluateContactConditions([{ type: 'subscription', value: 'any' }], c, NOW), true)
  })
})

// ---------------------------------------------------------------------------
// 2. Legacy aliases: subscription_missing / subscription_set
// ---------------------------------------------------------------------------

describe('evaluateContactConditions — legacy subscription aliases', () => {
  it('subscription_missing: passes when no subs at all', () => {
    assert.equal(evaluateContactConditions([{ type: 'subscription_missing' }], makeContact({}), NOW), true)
  })

  it('subscription_missing: fails when primary is set', () => {
    assert.equal(
      evaluateContactConditions([{ type: 'subscription_missing' }], makeContact({ subscription_type_id: 'sub-A' }), NOW),
      false
    )
  })

  it('subscription_missing: fails when active_subscriptions has entries', () => {
    assert.equal(
      evaluateContactConditions(
        [{ type: 'subscription_missing' }],
        makeContact({ active_subscriptions: [{ subscription_type_id: 'sub-B' }] }),
        NOW
      ),
      false
    )
  })

  it('subscription_set: passes when primary is set', () => {
    assert.equal(
      evaluateContactConditions([{ type: 'subscription_set' }], makeContact({ subscription_type_id: 'sub-A' }), NOW),
      true
    )
  })

  it('subscription_set: passes when active_subscriptions has entries (no primary)', () => {
    assert.equal(
      evaluateContactConditions(
        [{ type: 'subscription_set' }],
        makeContact({ active_subscriptions: [{ subscription_type_id: 'sub-B' }] }),
        NOW
      ),
      true
    )
  })

  it('subscription_set: fails when no subs at all', () => {
    assert.equal(evaluateContactConditions([{ type: 'subscription_set' }], makeContact({}), NOW), false)
  })
})

// ---------------------------------------------------------------------------
// 3. resolveSubIds — correctly unions primary and active_subscriptions
// ---------------------------------------------------------------------------

describe('resolveSubIds', () => {
  it('returns empty set for undefined doc', () => {
    assert.equal(resolveSubIds(undefined).size, 0)
  })

  it('picks up the primary subscription_type_id alone', () => {
    const ids = resolveSubIds({ subscription_type_id: 'sub-A' })
    assert.deepEqual([...ids].sort(), ['sub-A'])
  })

  it('picks up entries from active_subscriptions only (no primary)', () => {
    const ids = resolveSubIds({
      active_subscriptions: [{ subscription_type_id: 'sub-B' }, { subscription_type_id: 'sub-C' }],
    })
    assert.deepEqual([...ids].sort(), ['sub-B', 'sub-C'])
  })

  it('deduplicates when primary is also in active_subscriptions', () => {
    const ids = resolveSubIds({
      subscription_type_id: 'sub-A',
      active_subscriptions: [{ subscription_type_id: 'sub-A' }, { subscription_type_id: 'sub-B' }],
    })
    assert.deepEqual([...ids].sort(), ['sub-A', 'sub-B'])
  })
})

// ---------------------------------------------------------------------------
// 4. resolveContactEvents — subscription delta diff
// ---------------------------------------------------------------------------

describe('resolveContactEvents — subscription delta', () => {
  it('fires contact_created and nothing else for a new document', () => {
    const events = resolveContactEvents(undefined, { teamId: 't1' })
    assert.equal(events.length, 1)
    assert.equal(events[0].triggerType, 'contact_created')
  })

  it('returns empty array for a delete (after = undefined)', () => {
    const events = resolveContactEvents({ subscription_type_id: 'sub-A' }, undefined)
    assert.equal(events.length, 0)
  })

  it('fires subscription_added + subscription_changed when a type is added to active_subscriptions', () => {
    const before = { subscription_type_id: 'sub-A', active_subscriptions: [] }
    const after = {
      subscription_type_id: 'sub-A',
      active_subscriptions: [{ subscription_type_id: 'sub-A' }, { subscription_type_id: 'sub-B' }],
    }
    const events = resolveContactEvents(before, after)
    const added = events.filter((e) => e.triggerType === 'subscription_added')
    const changed = events.filter((e) => e.triggerType === 'subscription_changed')
    const removed = events.filter((e) => e.triggerType === 'subscription_removed')
    assert.equal(added.length, 1)
    assert.equal(added[0].delta?.subscriptionTypeId, 'sub-B')
    assert.equal(changed.length, 1)
    assert.equal(removed.length, 0)
  })

  it('fires subscription_removed + subscription_changed when a type is dropped', () => {
    const before = {
      subscription_type_id: 'sub-A',
      active_subscriptions: [{ subscription_type_id: 'sub-A' }, { subscription_type_id: 'sub-B' }],
    }
    const after = {
      subscription_type_id: 'sub-A',
      active_subscriptions: [{ subscription_type_id: 'sub-A' }],
    }
    const events = resolveContactEvents(before, after)
    const removed = events.filter((e) => e.triggerType === 'subscription_removed')
    const changed = events.filter((e) => e.triggerType === 'subscription_changed')
    assert.equal(removed.length, 1)
    assert.equal(removed[0].delta?.subscriptionTypeId, 'sub-B')
    assert.equal(changed.length, 1)
  })

  it('fires both added and removed when two different types swap in one write', () => {
    const before = { active_subscriptions: [{ subscription_type_id: 'sub-A' }] }
    const after = { active_subscriptions: [{ subscription_type_id: 'sub-B' }] }
    const events = resolveContactEvents(before, after)
    const added = events.filter((e) => e.triggerType === 'subscription_added')
    const removed = events.filter((e) => e.triggerType === 'subscription_removed')
    assert.equal(added.length, 1)
    assert.equal(added[0].delta?.subscriptionTypeId, 'sub-B')
    assert.equal(removed.length, 1)
    assert.equal(removed[0].delta?.subscriptionTypeId, 'sub-A')
  })

  it('fires no sub events when the subscription set is unchanged', () => {
    const before = { active_subscriptions: [{ subscription_type_id: 'sub-A' }] }
    const after = { active_subscriptions: [{ subscription_type_id: 'sub-A' }] }
    const events = resolveContactEvents(before, after)
    assert.equal(events.length, 0)
  })

  it('correctly handles a contact with only primary subscription_type_id changing', () => {
    const before = { subscription_type_id: 'sub-A' }
    const after = { subscription_type_id: 'sub-B' }
    const events = resolveContactEvents(before, after)
    const added = events.filter((e) => e.triggerType === 'subscription_added')
    const removed = events.filter((e) => e.triggerType === 'subscription_removed')
    assert.equal(added.length, 1)
    assert.equal(added[0].delta?.subscriptionTypeId, 'sub-B')
    assert.equal(removed.length, 1)
    assert.equal(removed[0].delta?.subscriptionTypeId, 'sub-A')
  })

  it('no sub events for an unrelated field change', () => {
    const before = { acquisition_stage: 'trial_booked', subscription_type_id: 'sub-A' }
    const after = { acquisition_stage: 'trial_booked', subscription_type_id: 'sub-A' }
    const events = resolveContactEvents(before, after)
    assert.equal(events.filter((e) => e.triggerType.startsWith('subscription')).length, 0)
  })
})

// ---------------------------------------------------------------------------
// recordRecipient — the run log's "who got it" (decision 14 / UX-48)
// ---------------------------------------------------------------------------

function freshStats(): RuleStats {
  return { processed: 0, sent: 0, skipped: 0, errors: 0, recipients: new Set<string>() }
}

describe('recordRecipient', () => {
  it('records a contact id', () => {
    const stats = freshStats()
    recordRecipient(stats, 'c1')
    assert.deepEqual([...stats.recipients], ['c1'])
  })

  it('ignores an empty id — a booking without a contact document is not a recipient', () => {
    const stats = freshStats()
    recordRecipient(stats, '')
    recordRecipient(stats, undefined)
    assert.equal(stats.recipients.size, 0)
  })

  it('dedupes — one contact reached twice in a run is one recipient', () => {
    const stats = freshStats()
    recordRecipient(stats, 'c1')
    recordRecipient(stats, 'c1')
    assert.equal(stats.recipients.size, 1)
  })

  it('keeps an EXACT total past the cap, so the log can say "50 of 400"', () => {
    const stats = freshStats()
    for (let i = 0; i < 400; i++) recordRecipient(stats, `c${i}`)
    assert.equal(stats.recipients.size, 400)
    // The cap applies where the log row is built, never to the tally.
    assert.equal([...stats.recipients].slice(0, RECIPIENT_ID_CAP).length, 50)
  })
})
