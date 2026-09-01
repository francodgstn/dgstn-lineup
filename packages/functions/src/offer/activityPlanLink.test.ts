import assert from 'node:assert/strict'
import {
  activityPlanEdge,
  activityPlanEdgeUpdate,
  activityRateChoiceOf,
  gatedPlanIds,
  plansSharingRate,
  ratedPlanIds,
  coursePlanEdge,
  coursePlanEdgeUpdate,
  coursePlanFacets,
  courseGatedPlanIds,
  offeringRateEffects,
  rateHasAPriceToApplyTo,
  plansSharingCourseRate,
  type ActivityEdgeFields,
  type CourseEdgeFields,
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

describe('the course ↔ plan edge', () => {
  // The per-tier rules are not a choice made in the editor; they are what
  // `resolvePaymentOptions`' course arm honours. A control offered on a tier
  // that ignores the field writes successfully, shows no error, and changes
  // nothing a member sees — which is the failure these tests exist to stop.
  const course = (accessRule: Record<string, unknown>, benefit?: unknown) =>
    ({ accessRule, benefit } as unknown as CourseEdgeFields)

  describe('which facets each tier honours', () => {
    it('free and registered honour neither', () => {
      assert.deepEqual(coursePlanFacets(course({ type: 'free' })), { access: false, rate: false })
      assert.deepEqual(coursePlanFacets(course({ type: 'registered' })), {
        access: false,
        rate: false,
      })
    })

    it('both plan-bearing tiers honour BOTH — the same pair a class carries', () => {
      // Until 2026-09-01 these were exclusive per tier, which is what made
      // "Premium free, Elite 20% off" inexpressible on a course while being
      // ordinary on a class.
      for (const doc of [
        course({ type: 'subscription' }),
        course({ type: 'purchase', priceAmount: 49 }),
      ]) {
        assert.deepEqual(coursePlanFacets(doc), { access: true, rate: true })
      }
    })

    it('a subscription-tier rate is honoured but INERT until there is a price', () => {
      // Offered, so a studio can set it up before pricing the course — and
      // dimmed, because the resolver's subscription branch returns before it
      // reads `benefit`. Exactly a class that sells no drop-in yet.
      assert.equal(coursePlanFacets(course({ type: 'subscription' })).rate, true)
      assert.equal(
        rateHasAPriceToApplyTo({ kind: 'course', doc: course({ type: 'subscription' }) as never }),
        false
      )
    })
  })

  describe('writes', () => {
    it('writes BOTH facets when both are asked for', () => {
      const update = coursePlanEdgeUpdate(
        course({ type: 'purchase', priceAmount: 49 }),
        'premium',
        { access: true, rate: true },
        { effect: 'percent_off', percent: 30 }
      )
      assert.deepEqual(update, {
        benefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 30 },
        accessRule: { type: 'purchase', priceAmount: 49, subscriptionTypeIds: ['premium'] },
      })
    })

    it('gates without rating when only access is asked for', () => {
      const update = coursePlanEdgeUpdate(course({ type: 'subscription' }), 'premium', {
        access: true,
        rate: false,
      })
      assert.deepEqual(update, {
        accessRule: { type: 'subscription', subscriptionTypeIds: ['premium'] },
      })
      assert.ok(update && !('benefit' in update), 'no rate was asked for')
    })

    it('keeps the tier when the last plan comes off the gate', () => {
      // Demoting to 'registered' would hand a paid course to every signed-in
      // contact. An empty gate is reported by the pricing health check instead.
      const fresh = course({ type: 'subscription', subscriptionTypeIds: ['premium'] })
      assert.deepEqual(coursePlanEdgeUpdate(fresh, 'premium', OFF), {
        accessRule: { type: 'subscription', subscriptionTypeIds: [] },
      })
    })

    it('rates a purchase-tier course without gating it', () => {
      const update = coursePlanEdgeUpdate(
        course({ type: 'purchase', priceAmount: 49 }),
        'premium',
        { access: false, rate: true },
        { effect: 'percent_off', percent: 30 }
      )
      assert.deepEqual(update, {
        benefit: { subscriptionTypeIds: ['premium'], effect: 'percent_off', percent: 30 },
      })
      assert.ok(update && !('accessRule' in update), 'no gate was asked for')
    })

    it('ABSORBS a legacy `included` benefit into the gate on first touch', () => {
      // The old spelling of "these plans get it free". Read as part of the gate,
      // then moved there and cleared — the whole migration, done lazily, with no
      // backfill to deploy.
      const fresh = course({ type: 'purchase', priceAmount: 49 }, {
        subscriptionTypeIds: ['premium', 'elite'],
        effect: 'included',
      })
      const update = coursePlanEdgeUpdate(
        fresh,
        'sportpass',
        { access: false, rate: true },
        { effect: 'percent_off', percent: 20 }
      )
      assert.deepEqual(update, {
        benefit: { subscriptionTypeIds: ['sportpass'], effect: 'percent_off', percent: 20 },
        accessRule: {
          type: 'purchase',
          priceAmount: 49,
          subscriptionTypeIds: ['premium', 'elite'],
        },
      })
    })

    it('writes nothing at all on a free or registered course', () => {
      // Both facets asked for, neither honoured.
      const asked = { access: true, rate: true }
      assert.equal(coursePlanEdgeUpdate(course({ type: 'free' }), 'premium', asked), null)
      assert.equal(coursePlanEdgeUpdate(course({ type: 'registered' }), 'premium', asked), null)
    })

    it('clears a purchase course RATE when its last plan comes off', () => {
      const fresh = course({ type: 'purchase', priceAmount: 49 }, {
        subscriptionTypeIds: ['premium'],
        effect: 'percent_off',
        percent: 20,
      })
      assert.deepEqual(coursePlanEdgeUpdate(fresh, 'premium', OFF), { benefit: null })
    })

    it('takes the last plan off a legacy `included` list as a GATE removal', () => {
      const fresh = course({ type: 'purchase', priceAmount: 49 }, {
        subscriptionTypeIds: ['premium'],
        effect: 'included',
      })
      // Only the benefit is written: the plan leaves the gate the legacy list
      // was standing in for, and the STORED gate — which was empty — ends up
      // empty either way, so there is nothing to write there.
      assert.deepEqual(coursePlanEdgeUpdate(fresh, 'premium', OFF), { benefit: null })
    })

    it('returns null when the edge is already as asked', () => {
      const fresh = course({ type: 'subscription', subscriptionTypeIds: ['premium'] })
      assert.equal(coursePlanEdgeUpdate(fresh, 'premium', { access: true, rate: false }), null)
    })
  })

  describe('reading', () => {
    it('reports no gate on a tier that has none', () => {
      assert.deepEqual(courseGatedPlanIds(course({ type: 'purchase', priceAmount: 9 })), [])
      assert.deepEqual(coursePlanEdge(course({ type: 'free' }), 'premium'), {
        access: false,
        rate: false,
      })
    })

    it('names the other plans on a shared course rate', () => {
      const fresh = course({ type: 'purchase', priceAmount: 49 }, {
        subscriptionTypeIds: ['basic', 'premium'],
        effect: 'percent_off',
        percent: 10,
      })
      assert.deepEqual(plansSharingCourseRate(fresh, 'premium'), ['basic'])
    })
  })
})

// ── Which rate effects an editor may OFFER ───────────────────────────────────
// The editor kept its own list and offered `included` on every rate row. On a
// CLASS the resolver ignores that effect — coverage there is the access rule's
// job — so a studio could tick "members get it included", save it, and watch
// members pay the full drop-in price anyway. Two controls that read as two ways
// to say "free", one of them inert.
//
// These assertions are the guard: `offeringRateEffects` derives from the very
// sets `resolvePaymentOptions` honours, so an effect can never again be offered
// where it would be dropped.
describe('offeringRateEffects — the editor offers only what the resolver honours', () => {
  const activityTarget = (type: 'class' | 'appointment') =>
    ({ kind: 'activity' as const, doc: { type } as never })
  const courseTarget = (type: 'free' | 'purchase' | 'subscription') =>
    ({ kind: 'course' as const, doc: { accessRule: { type } } as never })

  it('a CLASS gets price effects only — never `included`', () => {
    assert.deepEqual(offeringRateEffects(activityTarget('class')), [
      'percent_off',
      'fixed_price',
    ])
  })

  it('an APPOINTMENT keeps `included` — it is the only way to say "books free"', () => {
    // The mirror image of the class: an appointment has no access facet at all
    // (the price is the gate), so removing `included` there would take away the
    // only control that expresses a covered appointment.
    assert.deepEqual(offeringRateEffects(activityTarget('appointment')), [
      'included',
      'percent_off',
      'fixed_price',
    ])
  })

  it('a PURCHASE course keeps `included` — its tier has no gate to say it with', () => {
    assert.deepEqual(offeringRateEffects(courseTarget('purchase')), [
      'included',
      'percent_off',
      'fixed_price',
    ])
  })

  it('never offers `spend_credits` — the resolver honours it, no editor writes it', () => {
    for (const t of [
      activityTarget('class'),
      activityTarget('appointment'),
      courseTarget('purchase'),
    ]) {
      assert.ok(!offeringRateEffects(t).includes('spend_credits' as never))
    }
  })
})

// ── Whether a member RATE has a price to reduce ──────────────────────────────
// A rate is a discount ON something, and that something can be absent: a
// members-only class that sells no drop-in has no second price, so "20% off"
// there reduces nothing. The editor mutes the price effects when this is false
// rather than letting a studio configure a rule that silently never applies.
describe('rateHasAPriceToApplyTo', () => {
  const activity = (doc: Record<string, unknown>) =>
    ({ kind: 'activity' as const, doc: doc as never })

  it('a class needs an ENABLED drop-in carrying a real price', () => {
    assert.equal(rateHasAPriceToApplyTo(activity({ type: 'class' })), false)
    assert.equal(
      rateHasAPriceToApplyTo(activity({ type: 'class', dropIn: { enabled: false, priceAmount: 25 } })),
      false
    )
    assert.equal(
      rateHasAPriceToApplyTo(activity({ type: 'class', dropIn: { enabled: true } })),
      false
    )
    assert.equal(
      rateHasAPriceToApplyTo(activity({ type: 'class', dropIn: { enabled: true, priceAmount: 0 } })),
      false
    )
    assert.equal(
      rateHasAPriceToApplyTo(activity({ type: 'class', dropIn: { enabled: true, priceAmount: 25 } })),
      true
    )
  })

  it('an appointment needs at least one PRICED duration', () => {
    assert.equal(rateHasAPriceToApplyTo(activity({ type: 'appointment' })), false)
    assert.equal(
      rateHasAPriceToApplyTo(
        activity({ type: 'appointment', durations: [{ minutes: 60, priceAmount: null }] })
      ),
      false
    )
    assert.equal(
      rateHasAPriceToApplyTo(
        activity({
          type: 'appointment',
          durations: [{ minutes: 30 }, { minutes: 60, priceAmount: 90 }],
        })
      ),
      true
    )
  })

  it("a course's price IS its sale, so an unsold one has nothing to reduce", () => {
    const has = (accessRule: unknown) =>
      rateHasAPriceToApplyTo({ kind: 'course', doc: { accessRule } as never })
    assert.equal(has({ type: 'purchase', priceAmount: 49 }), true)
    assert.equal(has({ type: 'purchase' }), false, 'on sale but unpriced')
    assert.equal(has({ type: 'purchase', priceAmount: 0 }), false)
    assert.equal(has({ type: 'subscription', subscriptionTypeIds: ['premium'] }), false)
  })
})
