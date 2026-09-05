import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import {
  heldSubscriptionTypeIds,
  matchesFilter,
  planGrantIsCurrent,
  type ContactFilter,
} from '@linyup/shared'
import { resolvePlanPurchaseCap } from './planPurchases'

// "CHF 100, 2 months included" — a plan grant that ENDS, and the two things that
// make it work:
//
//  1. It ends by COMPARISON, in every reader, with no job to run and no event to
//     miss. The tests below therefore never simulate a sweep; they move the
//     clock, which is the only thing that ever happens.
//  2. The readers AGREE. A gate that expires while a filter does not is the
//     failure nobody reports: the studio keeps mailing "your plan" to someone
//     the door already turns away.

const ms = (d: string) => new Date(d).getTime()
const at = (d: string) => Timestamp.fromDate(new Date(d))

const NOW = ms('2026-07-20T12:00:00Z')

describe('planGrantIsCurrent — an end date, compared not trusted', () => {
  it('no stamp means no end — every pre-existing contact keeps working', () => {
    assert.equal(planGrantIsCurrent({}, NOW), true)
    assert.equal(planGrantIsCurrent({ subscription_expires_at: null }, NOW), true)
  })

  it('is current up to the instant, and not after it', () => {
    assert.equal(planGrantIsCurrent({ subscription_expires_at: at('2026-07-20T12:00:01Z') }, NOW), true)
    assert.equal(planGrantIsCurrent({ subscription_expires_at: at('2026-07-20T11:59:59Z') }, NOW), false)
  })

  it('needs no write to lapse — the SAME document answers differently later', () => {
    const contact = { subscription_expires_at: at('2026-08-01T00:00:00Z') }
    assert.equal(planGrantIsCurrent(contact, ms('2026-07-31T23:00:00Z')), true)
    assert.equal(planGrantIsCurrent(contact, ms('2026-08-01T01:00:00Z')), false)
  })
})

describe('the expiry reaches the coverage union', () => {
  const contact = {
    subscription_type_id: 'intro',
    subscription_expires_at: at('2026-08-01T00:00:00Z'),
  }

  it('holds the plan while the grant runs', () => {
    assert.deepEqual(heldSubscriptionTypeIds(contact, ms('2026-07-20T00:00:00Z')), ['intro'])
  })

  it('holds NOTHING once it has run out', () => {
    assert.deepEqual(heldSubscriptionTypeIds(contact, ms('2026-09-01T00:00:00Z')), [])
  })

  it('never touches a live Stripe subscription, which expires itself', () => {
    // `active_subscriptions` is a mirror of live subscriptions and drops its own
    // entries on lapse. Applying a one-off grant's end date to it would cut off
    // a member who is still being charged.
    const both = {
      ...contact,
      active_subscriptions: [{ subscription_type_id: 'monthly' }],
    }
    assert.deepEqual(heldSubscriptionTypeIds(both, ms('2026-09-01T00:00:00Z')), ['monthly'])
  })

  it('keeps a credit pack that outlives the grant', () => {
    const withPack = {
      ...contact,
      credit_summary: [
        { subscription_type_id: 'pack10', remaining: 4, next_expires_at: at('2026-12-01T00:00:00Z') },
      ],
    }
    assert.deepEqual(heldSubscriptionTypeIds(withPack, ms('2026-09-01T00:00:00Z')), ['pack10'])
  })
})

describe('the contacts list agrees with the gate', () => {
  // The ONE predicate rule, made executable: if these two ever disagree, a
  // dynamic group keeps a lapsed member in "on the intro plan" while the door
  // turns her away — and nothing in the product would report it.
  const filter = (subscriptions: string[]): ContactFilter =>
    ({ subscriptions }) as unknown as ContactFilter

  const subject = {
    id: 'c1',
    subscription_type_id: 'intro',
    subscription_expires_at: at('2026-08-01T00:00:00Z'),
  }

  it('is on the plan while covered, in the list AND in the union', () => {
    const nowMs = ms('2026-07-20T00:00:00Z')
    assert.equal(matchesFilter(subject, filter(['intro']), { nowMs }), true)
    assert.ok(heldSubscriptionTypeIds(subject, nowMs).includes('intro'))
  })

  it('drops off the plan when it lapses, in the list AND in the union', () => {
    const nowMs = ms('2026-09-01T00:00:00Z')
    assert.equal(matchesFilter(subject, filter(['intro']), { nowMs }), false)
    assert.ok(!heldSubscriptionTypeIds(subject, nowMs).includes('intro'))
  })

  it('counts as "no subscription" once lapsed — so win-back lists can find her', () => {
    assert.equal(
      matchesFilter(subject, filter(['none']), { nowMs: ms('2026-09-01T00:00:00Z') }),
      true
    )
  })
})

describe('resolvePlanPurchaseCap — which prices a cap can govern', () => {
  it('honours a cap on a one-time price', () => {
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time', maxPurchasesPerContact: 1 }), 1)
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time', maxPurchasesPerContact: 3 }), 3)
  })

  it('IGNORES one on a recurring price', () => {
    // Not the editor's job alone: seeded or hand-edited data must not be able to
    // lock a member out of renewing a subscription she is entitled to keep. That
    // case already has its own refusal (you-already-hold-this-type), and two
    // enforcement points for one fact is how they come to disagree.
    for (const recurrence of ['monthly', 'annual', 'weekly', 'quarterly', 'per_class'] as const) {
      assert.equal(resolvePlanPurchaseCap({ recurrence, maxPurchasesPerContact: 1 }), null)
    }
  })

  it('treats absent, zero and nonsense as unlimited', () => {
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time' }), null)
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time', maxPurchasesPerContact: 0 }), null)
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time', maxPurchasesPerContact: -2 }), null)
    assert.equal(resolvePlanPurchaseCap({ recurrence: 'one_time', maxPurchasesPerContact: 1.5 }), null)
  })
})
