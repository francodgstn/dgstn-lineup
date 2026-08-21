import assert from 'node:assert/strict'
import {
  activityPlanEdge,
  activityPlanEdgeUpdate,
  activityRateChoiceOf,
  gatedPlanIds,
  plansSharingRate,
  ratedPlanIds,
  type ActivityEdgeFields,
} from '@linyup/shared'

// The activity ↔ plan edge, which the catalogue page edits from BOTH directions.
// The headline test is `same edge, either direction`; every other case here
// exists because getting it wrong shipped once already.
// Run with: pnpm --filter @linyup/functions test

function cls(overrides: Partial<ActivityEdgeFields> = {}): ActivityEdgeFields {
  return { type: 'class', ...overrides } as ActivityEdgeFields
}

function appt(overrides: Partial<ActivityEdgeFields> = {}): ActivityEdgeFields {
  return { type: 'appointment', ...overrides } as ActivityEdgeFields
}

const OFF = { access: false, rate: false }

describe('the activity ↔ plan edge', () => {
  describe('same edge, either direction', () => {
    // THE PROPERTY THE CATALOGUE EXISTS TO GUARANTEE. Both directions call this
    // one function with the same arguments, so what this really pins is that no
    // second write path has grown back beside it.
    it('gating a class produces one document regardless of which side asked', () => {
      const fresh = cls()
      const fromActivity = activityPlanEdgeUpdate(fresh, 'premium', { access: true, rate: false })
      const fromPlan = activityPlanEdgeUpdate(fresh, 'premium', { access: true, rate: false })
      assert.deepEqual(fromActivity, fromPlan)
      assert.deepEqual(fromActivity, {
        accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] },
        isFreeTrial: false,
      })
    })

    it('setting a rate on an appointment produces one document either way', () => {
      const fresh = appt({ memberBenefit: { subscriptionTypeIds: ['basic'], effect: 'included' } })
      const rate = { effect: 'percent_off' as const, percent: 20 }
      const fromActivity = activityPlanEdgeUpdate(fresh, 'premium', { access: false, rate: true }, rate)
      const fromPlan = activityPlanEdgeUpdate(fresh, 'premium', { access: false, rate: true }, rate)
      assert.deepEqual(fromActivity, fromPlan)
      assert.deepEqual(fromActivity, {
        memberBenefit: {
          subscriptionTypeIds: ['basic', 'premium'],
          effect: 'percent_off',
          percent: 20,
        },
      })
    })
  })

  describe('the two facets are independent', () => {
    // A single "linked" boolean could not express this, and quietly picked one
    // of the two fields to write.
    it('a class can be gated to a plan AND give it a rate, in one write', () => {
      const update = activityPlanEdgeUpdate(cls(), 'premium', { access: true, rate: true }, {
        effect: 'percent_off',
        percent: 25,
      })
      assert.deepEqual(update, {
        memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 25 },
        accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] },
        isFreeTrial: false,
      })
    })

    it('dropping the gate leaves the rate standing', () => {
      const fresh = cls({
        accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] },
        memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 25 },
      })
      const update = activityPlanEdgeUpdate(fresh, 'premium', { access: false, rate: true })
      assert.deepEqual(update, { accessRule: { type: 'members' }, isFreeTrial: false })
      assert.ok(!(update && 'memberBenefit' in update), 'the rate was not asked to change')
    })

    it('dropping the rate leaves the gate standing', () => {
      const fresh = cls({
        accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] },
        memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 25 },
      })
      const update = activityPlanEdgeUpdate(fresh, 'premium', { access: true, rate: false })
      assert.deepEqual(update, { memberBenefit: null })
    })
  })

  describe('an appointment has no access gate', () => {
    // The UX-69 regression guard. The price is the gate, so a tick from the plan
    // side that landed on `accessRule` would invent a gate no booking path reads.
    it('never grows an accessRule, even when access is asked for', () => {
      const update = activityPlanEdgeUpdate(appt(), 'premium', { access: true, rate: true })
      assert.ok(update)
      assert.ok(!('accessRule' in update), 'appointment must not grow an accessRule')
      assert.ok(!('isFreeTrial' in update), 'and must not be stamped as a non-trial')
      assert.equal(
        (update.memberBenefit as { subscriptionTypeIds: string[] }).subscriptionTypeIds[0],
        'premium'
      )
    })

    it('reports access as false however the document is shaped', () => {
      assert.deepEqual(activityPlanEdge(appt(), 'premium'), { access: false, rate: false })
      assert.deepEqual(gatedPlanIds(appt()), [])
    })

    it('clears the rule outright when the last plan comes off it', () => {
      // null, not an empty rule: an empty id list means NO benefit, and a rule
      // with no holders is still a rule the resolver has to consider.
      const fresh = appt({ memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'included' } })
      assert.deepEqual(activityPlanEdgeUpdate(fresh, 'premium', OFF), { memberBenefit: null })
    })

    it('keeps the stored effect when a plan comes off, ignoring any draft', () => {
      // A row whose controls were hidden can still be carrying a draft. Writing
      // it would reprice whoever STAYS on the rule, which is not what removing a
      // different plan asked for.
      const fresh = appt({
        memberBenefit: {
          subscriptionTypeIds: ['basic', 'premium'],
          effect: 'percent_off',
          percent: 15,
        },
      })
      const update = activityPlanEdgeUpdate(fresh, 'premium', OFF, {
        effect: 'fixed_price',
        amount: 99,
      })
      assert.deepEqual(update, {
        memberBenefit: { subscriptionTypeIds: ['basic'], effect: 'percent_off', percent: 15 },
      })
    })
  })

  describe('a class gate', () => {
    it('falls back to members when the last plan is removed, never to open', () => {
      // The studio said this is not for the public. Dropping the last plan is
      // not them changing their mind about that.
      const fresh = cls({ accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] } })
      assert.deepEqual(activityPlanEdgeUpdate(fresh, 'premium', OFF), {
        accessRule: { type: 'members' },
        isFreeTrial: false,
      })
    })

    it('keeps the remaining plans when one of several is removed', () => {
      const fresh = cls({
        accessRule: { type: 'subscription', subscriptionTypeIds: ['basic', 'premium', 'gold'] },
      })
      assert.deepEqual(activityPlanEdgeUpdate(fresh, 'premium', OFF), {
        accessRule: { type: 'subscription', subscriptionTypeIds: ['basic', 'gold'] },
        isFreeTrial: false,
      })
    })
  })

  describe('no-op writes are refused', () => {
    it('returns null when both facets are already as asked', () => {
      const fresh = cls({ accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] } })
      assert.equal(activityPlanEdgeUpdate(fresh, 'premium', { access: true, rate: false }), null)
    })

    it('returns null when there is nothing to remove', () => {
      assert.equal(activityPlanEdgeUpdate(cls(), 'premium', OFF), null)
    })

    it('returns null for an appointment already carrying that exact rule', () => {
      const fresh = appt({
        memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 20 },
      })
      assert.equal(
        activityPlanEdgeUpdate(fresh, 'premium', { access: false, rate: true }, {
          effect: 'percent_off',
          percent: 20,
        }),
        null
      )
    })

    it('still writes when only the RATE VALUE changed on an already-rated plan', () => {
      const fresh = appt({
        memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 20 },
      })
      assert.deepEqual(
        activityPlanEdgeUpdate(fresh, 'premium', { access: false, rate: true }, {
          effect: 'percent_off',
          percent: 30,
        }),
        {
          memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 30 },
        }
      )
    })
  })

  describe('reading the edge', () => {
    it('reads the gate for a class and the rule for an appointment', () => {
      assert.deepEqual(
        gatedPlanIds(cls({ accessRule: { type: 'subscription', subscriptionTypeIds: ['a'] } })),
        ['a']
      )
      assert.deepEqual(
        ratedPlanIds(appt({ memberBenefit: { subscriptionTypeIds: ['b'], effect: 'included' } })),
        ['b']
      )
    })

    it('reports no gate for a class that is open or members-only', () => {
      assert.deepEqual(gatedPlanIds(cls({ accessRule: { type: 'open' } })), [])
      assert.deepEqual(gatedPlanIds(cls({ accessRule: { type: 'members' } })), [])
    })

    it('reads a rule stored in the legacy appointment shape', () => {
      // Reading past `normalizeBenefit` would make an old rule look unlinked,
      // and an unlinked-looking tick gets wiped on the next save.
      const legacy = appt({
        memberBenefit: { subscriptionTypeIds: ['old'], kind: 'discount', discountPercent: 10 },
      } as Partial<ActivityEdgeFields>)
      assert.deepEqual(ratedPlanIds(legacy), ['old'])
      assert.deepEqual(activityRateChoiceOf(legacy), {
        effect: 'percent_off',
        percent: 10,
        amount: null,
      })
    })
  })

  describe('plansSharingRate names who else a rate change hits', () => {
    it('lists the other plans on the rule', () => {
      const fresh = appt({
        memberBenefit: { subscriptionTypeIds: ['basic', 'premium', 'gold'], effect: 'included' },
      })
      assert.deepEqual(plansSharingRate(fresh, 'premium'), ['basic', 'gold'])
    })

    it('is empty when the plan is alone on the rule — nothing to warn about', () => {
      const fresh = appt({ memberBenefit: { subscriptionTypeIds: ['premium'], effect: 'included' } })
      assert.deepEqual(plansSharingRate(fresh, 'premium'), [])
    })
  })
})
