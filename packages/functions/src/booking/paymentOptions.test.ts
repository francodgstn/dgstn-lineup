import assert from 'node:assert/strict'
import {
  GUEST_SNAPSHOT,
  MIN_CHARGE_MAJOR,
  resolvePaymentOptions,
  type ContactPaymentSnapshot,
  type PaymentOptionsResult,
  type PaymentTarget,
} from '@linyup/shared'

// Table-driven tests for the ONE coverage/quote resolver (Phase B of the
// pricing consolidation). Each row is a (snapshot, target) → expected fixture;
// the appointment rows are parity ports of effectivePrice.test.ts, and the
// P1/P2 rows are named after the audit findings they fix.
// Run with: pnpm --filter @linyup/functions test

function contact(overrides: Partial<ContactPaymentSnapshot> = {}): ContactPaymentSnapshot {
  return {
    authenticated: true,
    joined: true,
    heldUnmeteredTypeIds: [],
    heldCreditTypes: [],
    ...overrides,
  }
}

interface Row {
  name: string
  snapshot: ContactPaymentSnapshot
  target: PaymentTarget
  expected: PaymentOptionsResult
}

function runRows(rows: Row[]) {
  for (const row of rows) {
    it(row.name, () => {
      assert.deepEqual(resolvePaymentOptions(row.snapshot, row.target), row.expected)
    })
  }
}

const covered = (via: Record<string, unknown>): PaymentOptionsResult => ({
  options: [{ type: 'covered', via } as never],
  denial: null,
})
const denied = (denial: PaymentOptionsResult['denial']): PaymentOptionsResult => ({
  options: [],
  denial,
})

describe('resolvePaymentOptions — class_booking (bookSession gate parity)', () => {
  const gated: PaymentTarget = {
    kind: 'class_booking',
    accessRule: { type: 'subscription', subscriptionTypeIds: ['gold', 'pack10'] },
  }
  runRows([
    {
      name: 'open class: everyone covered, guests included',
      snapshot: GUEST_SNAPSHOT,
      target: { kind: 'class_booking', accessRule: { type: 'open' } },
      expected: covered({ reason: 'open' }),
    },
    {
      name: 'members class: guest denied guest',
      snapshot: GUEST_SNAPSHOT,
      target: { kind: 'class_booking', accessRule: { type: 'members' } },
      expected: denied('guest'),
    },
    {
      name: 'members class: authenticated but not joined denied not_joined',
      snapshot: contact({ joined: false }),
      target: { kind: 'class_booking', accessRule: { type: 'members' } },
      expected: denied('not_joined'),
    },
    {
      name: 'members class: joined contact covered',
      snapshot: contact(),
      target: { kind: 'class_booking', accessRule: { type: 'members' } },
      expected: covered({ reason: 'members' }),
    },
    {
      name: 'subscription class: unmetered holder covered via that type',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: gated,
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'subscription class: unmetered wins over credits (never burns a credit)',
      snapshot: contact({
        heldUnmeteredTypeIds: ['gold'],
        heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 3 }],
      }),
      target: gated,
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'subscription class: credit holder gets spend_credits with remaining',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 3 }] }),
      target: gated,
      expected: {
        options: [{ type: 'spend_credits', via: { subscriptionTypeId: 'pack10' }, remaining: 3 }],
        denial: null,
      },
    },
    {
      name: 'subscription class: exhausted pack denied no_credits (not no_subscription)',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 0 }] }),
      target: gated,
      expected: denied('no_credits'),
    },
    {
      name: 'subscription class: nothing held denied no_subscription',
      snapshot: contact(),
      target: gated,
      expected: denied('no_subscription'),
    },
    {
      name: 'subscription class with EMPTY allow-list (misconfig): denied no_subscription',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: { kind: 'class_booking', accessRule: { type: 'subscription', subscriptionTypeIds: [] } },
      expected: denied('no_subscription'),
    },
    {
      name: 'subscription class: holder of an UNLISTED type denied no_subscription',
      snapshot: contact({ heldUnmeteredTypeIds: ['other'] }),
      target: gated,
      expected: denied('no_subscription'),
    },
  ])
})

describe('resolvePaymentOptions — drop_in (P1/P2 audit fixes live here)', () => {
  const target = (over: Partial<Extract<PaymentTarget, { kind: 'drop_in' }>> = {}): PaymentTarget => ({
    kind: 'drop_in',
    accessRule: { type: 'subscription', subscriptionTypeIds: ['gold', 'pack10'] },
    dropIn: { enabled: true, priceAmount: 25 },
    ...over,
  })
  runRows([
    {
      name: 'covered member (unmetered) is refused a drop-in: coverage option returned',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: target(),
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'P1: usable credit-pack holder is ALSO refused (bookSession semantics win)',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 2 }] }),
      target: target(),
      expected: {
        options: [{ type: 'spend_credits', via: { subscriptionTypeId: 'pack10' }, remaining: 2 }],
        denial: null,
      },
    },
    {
      name: 'P2: EXHAUSTED pack holder gets the pay option (old deadlock: refused both paths)',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 0 }] }),
      target: target(),
      expected: {
        options: [{ type: 'pay', amount: 25, source: 'drop_in' }],
        denial: null,
      },
    },
    {
      name: 'guest pays the drop-in price on a gated class',
      snapshot: GUEST_SNAPSHOT,
      target: target(),
      expected: { options: [{ type: 'pay', amount: 25, source: 'drop_in' }], denial: null },
    },
    {
      name: 'joined-but-uncovered member pays the drop-in price',
      snapshot: contact(),
      target: target(),
      expected: { options: [{ type: 'pay', amount: 25, source: 'drop_in' }], denial: null },
    },
    {
      name: 'open class: covered(open) — the callable maps this to "free to book"',
      snapshot: GUEST_SNAPSHOT,
      target: target({ accessRule: { type: 'open' } }),
      expected: covered({ reason: 'open' }),
    },
    {
      name: 'no drop-in configured and not covered: underlying denial surfaces',
      snapshot: contact(),
      target: target({ dropIn: null }),
      expected: denied('no_subscription'),
    },
    {
      name: 'paid trial (asTrial): guest pays the trial price',
      snapshot: GUEST_SNAPSHOT,
      target: target({ asTrial: true, trial: { enabled: true, priceAmount: 15 }, dropIn: null }),
      expected: { options: [{ type: 'pay', amount: 15, source: 'trial' }], denial: null },
    },
    {
      name: 'paid trial: contact who already used their trial denied trial_used',
      snapshot: contact({ trialUsed: true, joined: false }),
      target: target({ asTrial: true, trial: { enabled: true, priceAmount: 15 } }),
      expected: denied('trial_used'),
    },
  ])
})

describe('resolvePaymentOptions — appointment (effectivePrice parity rows)', () => {
  const duration = { minutes: 60, priceAmount: 95 }
  const included = { subscriptionTypeIds: ['gold'], kind: 'included' as const }
  const discount20 = { subscriptionTypeIds: ['gold'], kind: 'discount' as const, discountPercent: 20 }
  const t = (over: Partial<Extract<PaymentTarget, { kind: 'appointment' }>> = {}): PaymentTarget => ({
    kind: 'appointment',
    duration,
    benefit: null,
    ...over,
  })
  runRows([
    {
      name: 'unpriced duration: covered(unpriced) for everyone, benefit or not',
      snapshot: GUEST_SNAPSHOT,
      target: t({ duration: { minutes: 60 }, benefit: included }),
      expected: covered({ reason: 'unpriced' }),
    },
    {
      name: 'priced + guest: pay base',
      snapshot: GUEST_SNAPSHOT,
      target: t(),
      expected: { options: [{ type: 'pay', amount: 95, source: 'base' }], denial: null },
    },
    {
      name: 'priced + holder of an unlisted type: pay base',
      snapshot: contact({ heldUnmeteredTypeIds: ['other'] }),
      target: t({ benefit: included }),
      expected: { options: [{ type: 'pay', amount: 95, source: 'base' }], denial: null },
    },
    {
      name: 'included + unmetered holder: covered(benefit_included)',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({ benefit: included }),
      expected: covered({ reason: 'benefit_included', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'included + credit-only holder: spend_credits (pack pays the visit)',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'gold', remaining: 4 }] }),
      target: t({ benefit: included }),
      expected: {
        options: [{ type: 'spend_credits', via: { subscriptionTypeId: 'gold' }, remaining: 4 }],
        denial: null,
      },
    },
    {
      name: 'discount 20%: pays 76 with appliedBenefit carrying the base',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({ benefit: discount20 }),
      expected: {
        options: [
          {
            type: 'pay',
            amount: 76,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 95 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'discount clamps to the 0.50 floor, never lower',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({
        duration: { minutes: 30, priceAmount: 1 },
        benefit: { subscriptionTypeIds: ['gold'], kind: 'discount', discountPercent: 90 },
      }),
      expected: {
        options: [
          {
            type: 'pay',
            amount: MIN_CHARGE_MAJOR,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 1 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'discountPercent >= 100 clamps to the floor rather than going free',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({
        benefit: { subscriptionTypeIds: ['gold'], kind: 'discount', discountPercent: 150 },
      }),
      expected: {
        options: [
          {
            type: 'pay',
            amount: MIN_CHARGE_MAJOR,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 95 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'malformed discountPercent (missing/zero): base price, benefit NOT applied',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({ benefit: { subscriptionTypeIds: ['gold'], kind: 'discount' } }),
      expected: { options: [{ type: 'pay', amount: 95, source: 'base' }], denial: null },
    },
    {
      name: 'several held benefit types: FIRST in config order wins deterministically',
      snapshot: contact({ heldUnmeteredTypeIds: ['elite', 'basic'] }),
      target: t({
        benefit: { subscriptionTypeIds: ['basic', 'elite'], kind: 'included' },
      }),
      expected: covered({ reason: 'benefit_included', subscriptionTypeId: 'basic' }),
    },
  ])
})

describe('resolvePaymentOptions — course (shop/Space tiers incl. P6 widening)', () => {
  const t = (accessRule: Extract<PaymentTarget, { kind: 'course' }>['accessRule']): PaymentTarget => ({
    kind: 'course',
    accessRule,
  })
  runRows([
    {
      name: 'free tier: covered for anyone',
      snapshot: GUEST_SNAPSHOT,
      target: t({ type: 'free' }),
      expected: covered({ reason: 'free_tier' }),
    },
    {
      name: 'registered tier: guest denied sign_in_required',
      snapshot: GUEST_SNAPSHOT,
      target: t({ type: 'registered' }),
      expected: denied('sign_in_required'),
    },
    {
      name: 'registered tier: any signed-in contact covered',
      snapshot: contact({ joined: false }),
      target: t({ type: 'registered' }),
      expected: covered({ reason: 'registered' }),
    },
    {
      name: 'subscription tier: holder covered via type',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({ type: 'subscription', subscriptionTypeIds: ['gold'] }),
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'P6: coverage honours active_subscriptions beyond the primary (held union)',
      snapshot: contact({ heldUnmeteredTypeIds: ['second-sub'] }),
      target: t({ type: 'subscription', subscriptionTypeIds: ['second-sub'] }),
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'second-sub' }),
    },
    {
      name: 'subscription tier: credit-pack attachment counts as held (never spends)',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 0 }] }),
      target: t({ type: 'subscription', subscriptionTypeIds: ['pack10'] }),
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'pack10' }),
    },
    {
      name: 'subscription tier: signed-in non-holder denied no_subscription',
      snapshot: contact(),
      target: t({ type: 'subscription', subscriptionTypeIds: ['gold'] }),
      expected: denied('no_subscription'),
    },
    {
      name: 'purchase tier: not owned → pay the course price',
      snapshot: contact(),
      target: t({ type: 'purchase', priceAmount: 120 }),
      expected: {
        options: [{ type: 'pay', amount: 120, source: 'course_price' }],
        denial: null,
      },
    },
    {
      name: 'purchase tier: owner covered(owned) — lifetime entitlement',
      snapshot: contact({ ownsCourse: true }),
      target: t({ type: 'purchase', priceAmount: 120 }),
      expected: covered({ reason: 'owned' }),
    },
    {
      name: 'purchase tier: included-free for listed subscription holders',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: t({ type: 'purchase', priceAmount: 120, subscriptionTypeIds: ['gold'] }),
      expected: covered({ reason: 'subscription', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'purchase tier: guests still see the price (login enforced at checkout)',
      snapshot: GUEST_SNAPSHOT,
      target: t({ type: 'purchase', priceAmount: 120 }),
      expected: {
        options: [{ type: 'pay', amount: 120, source: 'course_price' }],
        denial: null,
      },
    },
  ])
})

describe('resolvePaymentOptions — generalized Benefit (Phase C)', () => {
  const dropInTarget = (benefit: unknown): PaymentTarget => ({
    kind: 'drop_in',
    accessRule: { type: 'subscription', subscriptionTypeIds: ['gold'] },
    dropIn: { enabled: true, priceAmount: 25 },
    benefit: benefit as never,
  })
  runRows([
    {
      name: 'drop-in member rate: percent_off holder pays the reduced drop-in price',
      snapshot: contact({ heldUnmeteredTypeIds: ['silver'] }),
      target: dropInTarget({ subscriptionTypeIds: ['silver'], effect: 'percent_off', percent: 40 }),
      expected: {
        options: [
          {
            type: 'pay',
            amount: 15,
            source: 'drop_in',
            appliedBenefit: { subscriptionTypeId: 'silver', effect: 'percent_off', baseAmount: 25 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'drop-in member rate: fixed_price holder pays the flat member price',
      snapshot: contact({ heldUnmeteredTypeIds: ['silver'] }),
      target: dropInTarget({ subscriptionTypeIds: ['silver'], effect: 'fixed_price', amount: 10 }),
      expected: {
        options: [
          {
            type: 'pay',
            amount: 10,
            source: 'drop_in',
            appliedBenefit: { subscriptionTypeId: 'silver', effect: 'fixed_price', baseAmount: 25 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'drop-in: included/spend_credits effects are IGNORED on classes (accessRule owns coverage)',
      snapshot: contact({ heldUnmeteredTypeIds: ['silver'] }),
      target: dropInTarget({ subscriptionTypeIds: ['silver'], effect: 'included' }),
      expected: { options: [{ type: 'pay', amount: 25, source: 'drop_in' }], denial: null },
    },
    {
      name: 'appointment fixed_price: holder pays the flat rate, clamped to the floor',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'appointment',
        duration: { minutes: 60, priceAmount: 95 },
        benefit: { subscriptionTypeIds: ['gold'], effect: 'fixed_price', amount: 0.1 },
      },
      expected: {
        options: [
          {
            type: 'pay',
            amount: MIN_CHARGE_MAJOR,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'fixed_price', baseAmount: 95 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'appointment explicit spend_credits effect: only a pack WITH balance applies',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 5 }] }),
      target: {
        kind: 'appointment',
        duration: { minutes: 60, priceAmount: 95 },
        benefit: { subscriptionTypeIds: ['pack10'], effect: 'spend_credits' },
      },
      expected: {
        options: [{ type: 'spend_credits', via: { subscriptionTypeId: 'pack10' }, remaining: 5 }],
        denial: null,
      },
    },
    {
      name: 'appointment spend_credits effect without balance: falls back to base',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 0 }] }),
      target: {
        kind: 'appointment',
        duration: { minutes: 60, priceAmount: 95 },
        benefit: { subscriptionTypeIds: ['pack10'], effect: 'spend_credits' },
      },
      expected: { options: [{ type: 'pay', amount: 95, source: 'base' }], denial: null },
    },
    {
      name: 'course percent_off: subscriber pays half price (the tier free-or-full could not express)',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'course',
        accessRule: { type: 'purchase', priceAmount: 120 },
        benefit: { subscriptionTypeIds: ['gold'], effect: 'percent_off', percent: 50 },
      },
      expected: {
        options: [
          {
            type: 'pay',
            amount: 60,
            source: 'course_price',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 120 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'course included benefit: holder covered(benefit_included)',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'course',
        accessRule: { type: 'purchase', priceAmount: 120 },
        benefit: { subscriptionTypeIds: ['gold'], effect: 'included' },
      },
      expected: covered({ reason: 'benefit_included', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'course: an explicit benefit WINS over the legacy free-inclusion list',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'course',
        accessRule: { type: 'purchase', priceAmount: 120, subscriptionTypeIds: ['gold'] },
        benefit: { subscriptionTypeIds: ['gold'], effect: 'percent_off', percent: 50 },
      },
      expected: {
        options: [
          {
            type: 'pay',
            amount: 60,
            source: 'course_price',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 120 },
          },
        ],
        denial: null,
      },
    },
    {
      name: 'course: spend_credits effect is ignored (no grant+spend story) → pay base',
      snapshot: contact({ heldCreditTypes: [{ subscriptionTypeId: 'pack10', remaining: 5 }] }),
      target: {
        kind: 'course',
        accessRule: { type: 'purchase', priceAmount: 120 },
        benefit: { subscriptionTypeIds: ['pack10'], effect: 'spend_credits' },
      },
      expected: {
        options: [{ type: 'pay', amount: 120, source: 'course_price' }],
        denial: null,
      },
    },
    {
      name: 'legacy appointment shape {kind: included} still resolves via normalizeBenefit',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'appointment',
        duration: { minutes: 60, priceAmount: 95 },
        benefit: { subscriptionTypeIds: ['gold'], kind: 'included' },
      },
      expected: covered({ reason: 'benefit_included', subscriptionTypeId: 'gold' }),
    },
    {
      name: 'legacy {kind: discount, discountPercent} ≡ new {effect: percent_off, percent}',
      snapshot: contact({ heldUnmeteredTypeIds: ['gold'] }),
      target: {
        kind: 'appointment',
        duration: { minutes: 60, priceAmount: 100 },
        benefit: { subscriptionTypeIds: ['gold'], kind: 'discount', discountPercent: 25 },
      },
      expected: {
        options: [
          {
            type: 'pay',
            amount: 75,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: 'gold', effect: 'percent_off', baseAmount: 100 },
          },
        ],
        denial: null,
      },
    },
  ])
})
