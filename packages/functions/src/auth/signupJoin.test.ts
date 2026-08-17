import assert from 'node:assert/strict'
import {
  ACQUISITION_STAGES,
  resolvePaymentOptions,
  type ContactPaymentSnapshot,
} from '@linyup/shared'
import { resolveSignupJoinPromotion } from './signupJoin'

// The signup door's JOIN promotion (UX-82): completing the public signup form
// must leave the person actually joined, including when they entered the
// contact base OFF-FUNNEL by buying in the shop. The invariants below are the
// ones that make that safe — each is named, because "promote when there is no
// stage" and "promote when the stage is falsy" differ only in the cases nobody
// tries by hand.

/** The sentinel `FieldValue.serverTimestamp()` stands in for at the call site. */
const TS = '<serverTimestamp>'
const now = (): unknown => TS

describe('resolveSignupJoinPromotion — when it promotes', () => {
  it('a contact with NO acquisition_stage key is promoted to joined', () => {
    const { patch, reason } = resolveSignupJoinPromotion({}, now)
    assert.equal(reason, 'promoted')
    assert.deepEqual(patch, {
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: TS,
      converted_at: TS,
      entry: 'signup',
    })
  })

  it('an explicitly null stage counts as absent too (Firestore’s other way of saying "no value")', () => {
    const { reason, patch } = resolveSignupJoinPromotion({ acquisition_stage: null }, now)
    assert.equal(reason, 'promoted')
    assert.equal(patch.acquisition_stage, 'joined')
  })

  it('THE PURCHASE-FIRST CASE: a shop buyer keeps entry="shop" and is dated NOW, not at purchase', () => {
    // Exactly what connect/webhook.ts's resolveOrCreateContact writes: an entry
    // door, no stage. The door they came through is the studio's attribution and
    // must survive; the conversion happened when they completed signup.
    const { patch, reason } = resolveSignupJoinPromotion({ entry: 'shop' }, now)
    assert.equal(reason, 'promoted')
    assert.deepEqual(patch, {
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: TS,
      converted_at: TS,
    })
    assert.equal('entry' in patch, false, 'entry is a birth fact the contact holds — never rewritten')
  })

  it('a held converted_at is kept (a studio backdating an imported member is not overwritten)', () => {
    const backdated = { toMillis: () => 1 }
    const { patch } = resolveSignupJoinPromotion({ converted_at: backdated }, now)
    assert.equal('converted_at' in patch, false)
    assert.equal(patch.acquisition_stage, 'joined')
  })

  it('promotion NEVER writes anything but the stage triple — it fills gaps, it does not rewrite the contact', () => {
    const { patch } = resolveSignupJoinPromotion(
      { entry: 'waitlist', converted_at: null },
      now,
    )
    assert.deepEqual(Object.keys(patch).sort(), [
      'acquisition_stage',
      'acquisition_stage_updated_at',
      'converted_at',
    ])
  })
})

describe('resolveSignupJoinPromotion — the birth-fact rule it must not weaken', () => {
  // Enumerated from the union itself, so a stage added to ACQUISITION_STAGES is
  // covered here without anyone remembering to add a case.
  for (const stage of ACQUISITION_STAGES) {
    it(`a contact holding '${stage}' is left completely untouched`, () => {
      assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: stage }, now), {
        patch: {},
        reason: 'holds_stage',
      })
    })
  }

  it('an EMPTY STRING does not promote — falsy is not absent', () => {
    assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: '' }, now), {
      patch: {},
      reason: 'holds_unrecognised_stage',
    })
  })

  it('a value outside the union does not promote either — it is reported, not overwritten', () => {
    assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: 'lead' }, now), {
      patch: {},
      reason: 'holds_unrecognised_stage',
    })
  })

  it('a stage-holding contact keeps its stage even when entry/converted_at are missing', () => {
    // The gap-filling is a consequence of promotion, never a separate repair —
    // a stage the contact holds means this function writes nothing at all.
    assert.deepEqual(
      resolveSignupJoinPromotion({ acquisition_stage: 'trial_booked', entry: undefined }, now).patch,
      {},
    )
  })
})

describe('the promoted contact actually passes the paid-access gate', () => {
  // The walk that matters: booking/access.ts builds the snapshot with
  // `joined: contact.acquisition_stage === 'joined'`, and resolveClassCoverage
  // (inside resolvePaymentOptions) denies `not_joined` BEFORE it looks at any
  // held subscription. So the promotion is only worth anything if the value it
  // writes is exactly the one that predicate tests.
  const snapshotFor = (contact: { acquisition_stage?: unknown }, heldTypeIds: string[] = []): ContactPaymentSnapshot => ({
    authenticated: true,
    joined: contact.acquisition_stage === 'joined',
    heldUnmeteredTypeIds: heldTypeIds,
    heldCreditTypes: [],
    trialUsed: false,
  })

  /** The stage-less shop buyer, before and after completing signup. */
  const buyer: Record<string, unknown> = { entry: 'shop' }
  const promoted = {
    ...buyer,
    ...resolveSignupJoinPromotion(buyer, now).patch,
  }

  it('before signup: a members-tier class refuses the buyer with not_joined', () => {
    const { options, denial } = resolvePaymentOptions(snapshotFor(buyer), {
      kind: 'class_booking',
      accessRule: { type: 'members' },
    })
    assert.equal(denial, 'not_joined')
    assert.deepEqual(options, [])
  })

  it('before signup: even holding the exact subscription, a subscription-tier class refuses them', () => {
    const { denial } = resolvePaymentOptions(snapshotFor(buyer, ['sub_gold']), {
      kind: 'class_booking',
      accessRule: { type: 'subscription', subscriptionTypeIds: ['sub_gold'] },
    })
    assert.equal(denial, 'not_joined', 'the joined gate is asked FIRST — coverage never gets a look')
  })

  it('after signup: the members-tier class is covered', () => {
    const { options, denial } = resolvePaymentOptions(snapshotFor(promoted), {
      kind: 'class_booking',
      accessRule: { type: 'members' },
    })
    assert.equal(denial, null)
    assert.deepEqual(options, [{ type: 'covered', via: { reason: 'members' } }])
  })

  it('after signup: the subscription they bought now covers the subscription-tier class', () => {
    const { options, denial } = resolvePaymentOptions(snapshotFor(promoted, ['sub_gold']), {
      kind: 'class_booking',
      accessRule: { type: 'subscription', subscriptionTypeIds: ['sub_gold'] },
    })
    assert.equal(denial, null)
    assert.deepEqual(options, [
      { type: 'covered', via: { reason: 'subscription', subscriptionTypeId: 'sub_gold' } },
    ])
  })

  it('after signup: a subscription-tier class they hold nothing for still refuses — but for the RIGHT reason', () => {
    // Promotion grants membership of the studio, never coverage of a plan.
    const { denial } = resolvePaymentOptions(snapshotFor(promoted), {
      kind: 'class_booking',
      accessRule: { type: 'subscription', subscriptionTypeIds: ['sub_gold'] },
    })
    assert.equal(denial, 'no_subscription')
  })
})
