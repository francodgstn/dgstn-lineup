import assert from 'node:assert/strict'
import {
  ACQUISITION_STAGES,
  resolvePaymentOptions,
  type ContactPaymentSnapshot,
} from '@linyup/shared'
import { resolveSignupJoinPromotion } from './signupJoin'

// The signup door's JOIN promotion: completing the public signup form must leave
// the person actually joined — whether they entered the contact base OFF-FUNNEL
// by buying in the shop (UX-82) or ON it by booking a trial (UX-83, the ordinary
// path). The invariants below are the ones that make that safe — each is named,
// because "advance any stage below joined" and "promote when the stage is falsy"
// differ only in the cases nobody tries by hand.

/** The sentinel `FieldValue.serverTimestamp()` stands in for at the call site. */
const TS = '<serverTimestamp>'
const now = (): unknown => TS

describe('resolveSignupJoinPromotion — completing signup IS joining', () => {
  it('a contact with NO acquisition_stage key is promoted to joined', () => {
    const { patch, reason, from } = resolveSignupJoinPromotion({}, now)
    assert.equal(reason, 'promoted_from_none')
    assert.equal(from, null)
    assert.deepEqual(patch, {
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: TS,
      converted_at: TS,
      entry: 'signup',
    })
  })

  it('an explicitly null stage counts as absent too (Firestore’s other way of saying "no value")', () => {
    const { reason, patch } = resolveSignupJoinPromotion({ acquisition_stage: null }, now)
    assert.equal(reason, 'promoted_from_none')
    assert.equal(patch.acquisition_stage, 'joined')
  })

  it('THE PURCHASE-FIRST CASE: a shop buyer keeps entry="shop" and is dated NOW, not at purchase', () => {
    // Exactly what connect/webhook.ts's resolveOrCreateContact writes: an entry
    // door, no stage. The door they came through is the studio's attribution and
    // must survive; the conversion happened when they completed signup.
    const { patch, reason } = resolveSignupJoinPromotion({ entry: 'shop' }, now)
    assert.equal(reason, 'promoted_from_none')
    assert.deepEqual(patch, {
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: TS,
      converted_at: TS,
    })
    assert.equal('entry' in patch, false, 'entry is a birth fact the contact holds — never rewritten')
  })

  it('THE TRIAL-LEAD CASE: booking a trial then signing up keeps entry="booking" and joins', () => {
    // Exactly what the trial doors write (appointments/booking.ts,
    // booking/dropIn.ts, booking/index.ts): stage 'trial_booked', entry
    // 'booking', no converted_at. Before UX-83 this contact was left on the
    // trial stage and refused by every members-tier class, permanently.
    const lead = { acquisition_stage: 'trial_booked', entry: 'booking' }
    const { patch, reason, from } = resolveSignupJoinPromotion(lead, now)
    assert.equal(reason, 'promoted_from_stage')
    assert.equal(from, 'trial_booked')
    assert.deepEqual(patch, {
      acquisition_stage: 'joined',
      acquisition_stage_updated_at: TS,
      converted_at: TS,
    })
    assert.equal('entry' in patch, false, 'the door they came through stays "booking", never "signup"')
  })

  it('a trial lead who ATTENDED joins too — every stage below joined advances', () => {
    // Enumerated from the union itself, so a stage added below 'joined' is
    // covered here without anyone remembering to add a case.
    const below = ACQUISITION_STAGES.filter((s) => s !== 'joined')
    assert.ok(below.length > 0)
    for (const stage of below) {
      const { patch, reason } = resolveSignupJoinPromotion({ acquisition_stage: stage }, now)
      assert.equal(reason, 'promoted_from_stage', `${stage} must advance`)
      assert.equal(patch.acquisition_stage, 'joined')
    }
  })

  it('a held converted_at is kept, even for a trial lead (a human put it there on purpose)', () => {
    // A trial lead normally holds none — no trial door writes one, and the web
    // clears it on any correction back below 'joined'. One that IS held was
    // typed by a studio (backdating an imported member, or editing the
    // milestone on the contact profile), so it wins.
    const backdated = { toMillis: () => 1 }
    for (const subject of [
      { converted_at: backdated },
      { acquisition_stage: 'trial_attended', converted_at: backdated },
    ]) {
      const { patch } = resolveSignupJoinPromotion(subject, now)
      assert.equal('converted_at' in patch, false)
      assert.equal(patch.acquisition_stage, 'joined')
    }
  })

  it('promotion NEVER writes anything but the stage triple — it joins, it does not rewrite the contact', () => {
    const { patch } = resolveSignupJoinPromotion(
      { acquisition_stage: 'trial_booked', entry: 'waitlist', converted_at: null },
      now,
    )
    assert.deepEqual(Object.keys(patch).sort(), [
      'acquisition_stage',
      'acquisition_stage_updated_at',
      'converted_at',
    ])
  })
})

describe('resolveSignupJoinPromotion — the rules it must not break', () => {
  it('JOINED IS TERMINAL: a member who fills the form again is left completely untouched', () => {
    // Not even a re-stamped acquisition_stage_updated_at: an unchanged stage is
    // not a stage change, and pretending otherwise would move their timeline.
    assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: 'joined' }, now), {
      patch: {},
      reason: 'already_joined',
      from: 'joined',
    })
  })

  it('nothing is ever moved BACKWARDS — the test is by rank, not equality with "joined"', () => {
    // The reserved downstream stages ('left' | 'won_back', see Contact) are not
    // in the union yet. This pins the mechanism rather than the membership: any
    // stage at or past 'joined' is left alone, so the day they ship, a returning
    // member filling the form is not dragged back to 'joined'.
    const joinedRank = ACQUISITION_STAGES.indexOf('joined')
    for (const [i, stage] of ACQUISITION_STAGES.entries()) {
      const { reason } = resolveSignupJoinPromotion({ acquisition_stage: stage }, now)
      assert.equal(
        reason,
        i >= joinedRank ? 'already_joined' : 'promoted_from_stage',
        `${stage} (rank ${i}) decided wrongly`,
      )
    }
  })

  it('an EMPTY STRING does not promote — falsy is not absent', () => {
    assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: '' }, now), {
      patch: {},
      reason: 'holds_unrecognised_stage',
      from: '',
    })
  })

  it('a value outside the union does not promote either — it is reported, not repaired', () => {
    // Unrankable, so it cannot be advanced without guessing. The caller warns;
    // paid access keeps refusing until a human looks.
    assert.deepEqual(resolveSignupJoinPromotion({ acquisition_stage: 'lead' }, now), {
      patch: {},
      reason: 'holds_unrecognised_stage',
      from: 'lead',
    })
  })

  it('a contact holding an unrecognised stage has its entry/converted_at gaps left alone too', () => {
    // The gap-filling is a consequence of promotion, never a separate repair —
    // no promotion means this function writes nothing at all.
    assert.deepEqual(
      resolveSignupJoinPromotion({ acquisition_stage: 'enquired', entry: undefined }, now).patch,
      {},
    )
  })
})

describe('the analytics consequence — asymmetric ON PURPOSE', () => {
  // trackContacts (analytics/index.ts) logs `acquisition_stage_change` and
  // increments trial_conversions_count only when BOTH sides of the change are
  // present. That single predicate, read through the two doors this function
  // opens, produces a difference that looks like a bug read cold — so it is
  // pinned here, next to the code that decides it.
  const countsAsStageChange = (before: unknown, after: unknown): boolean =>
    !!before && !!after && before !== after

  it('trial_booked → joined IS counted: it is exactly what a trial conversion is', () => {
    const lead = { acquisition_stage: 'trial_booked', entry: 'booking' }
    const { patch, reason } = resolveSignupJoinPromotion(lead, now)
    assert.equal(reason, 'promoted_from_stage')
    assert.equal(
      countsAsStageChange(lead.acquisition_stage, patch.acquisition_stage),
      true,
      'the weekly trial_conversions_count moves, and the activity feed gets a row',
    )
  })

  it('absent → joined is NOT counted: a shop buyer was never on the trial funnel', () => {
    const buyer = { entry: 'shop' }
    const { patch, reason } = resolveSignupJoinPromotion(buyer, now)
    assert.equal(reason, 'promoted_from_none')
    assert.equal(
      countsAsStageChange(undefined, patch.acquisition_stage),
      false,
      'counting this would inflate the number the studio judges its trial offer by',
    )
  })

  it('the reason names which of the two happened, so the log line can say so', () => {
    assert.notEqual(
      resolveSignupJoinPromotion({ acquisition_stage: 'trial_attended' }, now).reason,
      resolveSignupJoinPromotion({}, now).reason,
    )
  })

  it('AUTOMATION is not symmetric with analytics — both doors fire a forward move', () => {
    // onContactWrite ranks a missing stage at -1 (indexOf), so both promotions
    // are forward moves and both fire `acquisition_stage_changed`. That is what
    // a "when someone joins" rule should do: it is about the person joining,
    // not about the funnel arithmetic.
    const rank = (s: unknown): number => (ACQUISITION_STAGES as readonly unknown[]).indexOf(s)
    for (const before of [undefined, 'trial_booked', 'trial_attended']) {
      const { patch } = resolveSignupJoinPromotion({ acquisition_stage: before }, now)
      assert.ok(rank(patch.acquisition_stage) > rank(before), `${String(before)} → joined must be forward`)
    }
    // …and an already-joined contact writes no stage at all, so no rule re-fires.
    assert.equal('acquisition_stage' in resolveSignupJoinPromotion({ acquisition_stage: 'joined' }, now).patch, false)
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
  /** The trial lead (UX-83), before and after completing signup. */
  const lead: Record<string, unknown> = { acquisition_stage: 'trial_booked', entry: 'booking' }
  const joinedLead = { ...lead, ...resolveSignupJoinPromotion(lead, now).patch }

  it('before signup: a members-tier class refuses the buyer with not_joined', () => {
    const { options, denial } = resolvePaymentOptions(snapshotFor(buyer), {
      kind: 'class_booking',
      accessRule: { type: 'members' },
    })
    assert.equal(denial, 'not_joined')
    assert.deepEqual(options, [])
  })

  it('before signup: the trial lead is refused the same way — "signing up is free" was a false promise', () => {
    const { denial } = resolvePaymentOptions(snapshotFor(lead), {
      kind: 'class_booking',
      accessRule: { type: 'members' },
    })
    assert.equal(denial, 'not_joined')
  })

  it('before signup: even holding the exact subscription, a subscription-tier class refuses them', () => {
    const { denial } = resolvePaymentOptions(snapshotFor(buyer, ['sub_gold']), {
      kind: 'class_booking',
      accessRule: { type: 'subscription', subscriptionTypeIds: ['sub_gold'] },
    })
    assert.equal(denial, 'not_joined', 'the joined gate is asked FIRST — coverage never gets a look')
  })

  it('after signup: the members-tier class is covered — for the buyer AND the trial lead', () => {
    for (const contact of [promoted, joinedLead]) {
      const { options, denial } = resolvePaymentOptions(snapshotFor(contact), {
        kind: 'class_booking',
        accessRule: { type: 'members' },
      })
      assert.equal(denial, null)
      assert.deepEqual(options, [{ type: 'covered', via: { reason: 'members' } }])
    }
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
    const { denial } = resolvePaymentOptions(snapshotFor(joinedLead), {
      kind: 'class_booking',
      accessRule: { type: 'subscription', subscriptionTypeIds: ['sub_gold'] },
    })
    assert.equal(denial, 'no_subscription')
  })
})
