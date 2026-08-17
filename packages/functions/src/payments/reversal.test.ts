// The reversal matrix: {divisible, indivisible, none} × {full, partial} ×
// {consumed 0, n, all} × {owner, not-owner, absent}.
//
// The tests that matter most are the ones that assert NOTHING was written —
// under-revoking is the design, and a reversal that quietly strips access a
// different payment paid for is the failure this file exists to catch.

import assert from 'node:assert/strict'
import type { firestore } from 'firebase-admin'
import { proRataMinor } from '@linyup/shared'
import {
  reversalPlanFor,
  reversePaymentEffects,
  type ReversalActions,
  type ReversalPlan,
} from './reversal'

// ─── helpers ─────────────────────────────────────────────────────────────────

function actions(plan: ReversalPlan): ReversalActions {
  assert.equal(plan.refuse, undefined, `expected an actionable plan, got refuse=${plan.refuse}`)
  return plan as ReversalActions
}

interface TxOps {
  updates: Array<{ path: string; data: Record<string, unknown> }>
  deletes: string[]
}

/** Firestore double with just enough transaction to run the executor: get() by
 *  doc id off a seed map, update/delete recorded by path. */
function mockDb(seed: Record<string, Record<string, unknown> | undefined>) {
  const ops: TxOps = { updates: [], deletes: [] }
  const reads: string[] = []
  const docRef = (path: string) => ({
    path,
    collection: (name: string) => colRef(`${path}/${name}`),
  })
  const colRef = (path: string) => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  const tx = {
    async get(ref: { path: string }) {
      reads.push(ref.path)
      const data = seed[ref.path]
      return { exists: data !== undefined, data: () => data }
    },
    update(ref: { path: string }, data: Record<string, unknown>) {
      ops.updates.push({ path: ref.path, data })
    },
    delete(ref: { path: string }) {
      ops.deletes.push(ref.path)
    },
  }
  const db = {
    collection: (name: string) => colRef(name),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as firestore.Firestore
  return { db, ops, reads }
}

const PACK = { kind: 'subscription' as const, subscriptionTypeId: 'st1', priceId: 'p1' }
const PLAIN_SUB = { kind: 'subscription' as const, subscriptionTypeId: 'st1' }
const COURSE = { kind: 'course' as const, courseId: 'c1' }

// ─── proRataMinor ────────────────────────────────────────────────────────────

describe('proRataMinor', () => {
  it('splits the payment by unconsumed units', () => {
    assert.equal(proRataMinor(18000, 7, 10), 12600)
    assert.equal(proRataMinor(18000, 10, 10), 18000)
  })

  it('floors — rounding never favours the refund over the studio', () => {
    // 10000 × 1/3 = 3333.33…
    assert.equal(proRataMinor(10000, 1, 3), 3333)
  })

  it('does NOT apply the Stripe charge floor (MIN_CHARGE_MINOR is a CHARGE floor)', () => {
    // 1/100 of CHF 1.00 is 1 Rappen. A charge could not be that small; a refund can.
    assert.equal(proRataMinor(100, 1, 100), 1)
  })

  it('is 0 for degenerate inputs rather than throwing', () => {
    assert.equal(proRataMinor(18000, 0, 10), 0)
    assert.equal(proRataMinor(18000, 5, 0), 0)
    assert.equal(proRataMinor(0, 5, 10), 0)
    assert.equal(proRataMinor(18000, -1, 10), 0)
  })

  it('clamps remaining to granted', () => {
    assert.equal(proRataMinor(18000, 99, 10), 18000)
  })
})

// ─── reversalPlanFor ─────────────────────────────────────────────────────────

describe('reversalPlanFor — divisible (a credit pack)', () => {
  it('full refund of an UNTOUCHED pack clears the plan and revokes everything', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 0 },
      paymentAmountMinor: 18000,
    })
    assert.deepEqual(actions(plan), {
      subscription: 'clear_if_owned',
      credits: { op: 'reduce_to', total: 0 },
      course: 'leave',
    })
  })

  it('full refund of a PARTLY consumed pack is refused, with the pro-rata answer', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 3 },
      paymentAmountMinor: 18000,
    })
    assert.equal(plan.refuse, 'full_refund_on_consumed_pack')
    assert.deepEqual((plan as { suggestion: unknown }).suggestion, {
      unitsGranted: 10,
      unitsConsumed: 3,
      unitsRemaining: 7,
      proRataMinor: 12600,
      maxRefundableMinor: 18000,
    })
  })

  it('full refund of a FULLY consumed pack is refused, suggesting nothing', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 10 },
      paymentAmountMinor: 18000,
    })
    assert.equal(plan.refuse, 'full_refund_on_consumed_pack')
    const s = (plan as { suggestion: { unitsRemaining: number; proRataMinor: number } }).suggestion
    assert.equal(s.unitsRemaining, 0)
    assert.equal(s.proRataMinor, 0)
  })

  it('the suggestion is bounded by what is still refundable', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 1 },
      paymentAmountMinor: 18000,
      alreadyRefundedMinor: 15000,
    })
    const s = (plan as { suggestion: { proRataMinor: number; maxRefundableMinor: number } })
      .suggestion
    assert.equal(s.maxRefundableMinor, 3000)
    // 9/10 of 18000 is 16200, but only 3000 is left to give back.
    assert.equal(s.proRataMinor, 3000)
  })

  it('PARTIAL refund revokes the remainder and LEAVES the plan alone', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 3 },
      refundAmountMinor: 12600,
      paymentAmountMinor: 18000,
    })
    assert.deepEqual(actions(plan), {
      // Holding a plan is indivisible — 3 classes taken means she still holds it.
      subscription: 'leave',
      credits: { op: 'reduce_to', total: 3 },
      course: 'leave',
    })
  })

  it('partial refund of an untouched pack revokes all of it, plan untouched', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 10, unitsConsumed: 0 },
      refundAmountMinor: 9000,
      paymentAmountMinor: 18000,
    })
    assert.deepEqual(actions(plan).credits, { op: 'reduce_to', total: 0 })
    assert.equal(actions(plan).subscription, 'leave')
  })
})

describe('reversalPlanFor — indivisible', () => {
  it('full refund of a plain membership clears it if owned', () => {
    const plan = reversalPlanFor({
      lineItem: PLAIN_SUB,
      divisible: null,
      paymentAmountMinor: 5000,
    })
    assert.deepEqual(actions(plan), {
      subscription: 'clear_if_owned',
      credits: { op: 'leave' },
      course: 'leave',
    })
  })

  it('PARTIAL refund of a plain membership is refused', () => {
    const plan = reversalPlanFor({
      lineItem: PLAIN_SUB,
      divisible: null,
      refundAmountMinor: 2500,
      paymentAmountMinor: 5000,
    })
    assert.equal(plan.refuse, 'partial_refund_on_indivisible')
  })

  it('a pack whose grant reports zero units is treated as a plain membership', () => {
    const plan = reversalPlanFor({
      lineItem: PACK,
      divisible: { unitsGranted: 0, unitsConsumed: 0 },
      refundAmountMinor: 2500,
      paymentAmountMinor: 5000,
    })
    assert.equal(plan.refuse, 'partial_refund_on_indivisible')
  })

  it('full refund of a course deletes it if owned; partial is refused', () => {
    assert.deepEqual(
      actions(reversalPlanFor({ lineItem: COURSE, divisible: null, paymentAmountMinor: 9900 })),
      { subscription: 'leave', credits: { op: 'leave' }, course: 'delete_if_owned' }
    )
    assert.equal(
      reversalPlanFor({
        lineItem: COURSE,
        divisible: null,
        refundAmountMinor: 5000,
        paymentAmountMinor: 9900,
      }).refuse,
      'partial_refund_on_indivisible'
    )
  })
})

describe('reversalPlanFor — nothing to reverse', () => {
  for (const kind of ['product', 'drop_in', 'appointment', 'gift_card', 'other'] as const) {
    it(`${kind}: full AND partial are allowed and touch nothing`, () => {
      const nothing = {
        subscription: 'leave',
        credits: { op: 'leave' },
        course: 'leave',
      }
      assert.deepEqual(
        actions(reversalPlanFor({ lineItem: { kind }, divisible: null, paymentAmountMinor: 2500 })),
        nothing
      )
      assert.deepEqual(
        actions(
          reversalPlanFor({
            lineItem: { kind },
            divisible: null,
            refundAmountMinor: 1000,
            paymentAmountMinor: 2500,
          })
        ),
        nothing
      )
    })
  }

  it('an unlinked payment (no line item) touches nothing', () => {
    assert.equal(
      actions(reversalPlanFor({ lineItem: null, divisible: null, paymentAmountMinor: 2500 }))
        .subscription,
      'leave'
    )
  })
})

// ─── reversePaymentEffects ───────────────────────────────────────────────────

const CLEAR: ReversalActions = {
  subscription: 'clear_if_owned',
  credits: { op: 'leave' },
  course: 'leave',
}
const REDUCE: ReversalActions = {
  subscription: 'leave',
  credits: { op: 'reduce_to', total: 0 },
  course: 'leave',
}
const DELETE_COURSE: ReversalActions = {
  subscription: 'leave',
  credits: { op: 'leave' },
  course: 'delete_if_owned',
}

describe('reversePaymentEffects — subscription ownership', () => {
  it('clears the five fields when this payment owns them', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1': { subscription_type_id: 'st1', subscription_source_ref: 'pi_1' },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'cleared')
    const u = ops.updates.find((x) => x.path === 'contacts/ct1')!
    for (const f of [
      'subscription_type_id',
      'subscription_type_name',
      'subscription_price_id',
      'subscription_recurrence',
      'subscription_amount',
      'subscription_source_ref',
    ]) {
      assert.ok(f in u.data, `${f} cleared`)
    }
  })

  it('SKIPS when a LATER payment owns the fields — the over-revoke bug', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1': { subscription_type_id: 'st1', subscription_source_ref: 'pi_2' },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'skipped_not_owner')
    assert.equal(ops.updates.length, 0, 'nothing written')
  })

  it('SKIPS a recurring renewal, which stores a null source ref', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1': { subscription_type_id: 'st1', subscription_source_ref: null },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'skipped_not_owner')
    assert.equal(ops.updates.length, 0)
  })

  it('reports absent when the contact holds no subscription at all', async () => {
    const { db, ops } = mockDb({ 'contacts/ct1': { subscription_source_ref: 'pi_1' } })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'absent')
    assert.equal(ops.updates.length, 0)
  })

  it('reports absent when the contact is gone', async () => {
    const { db, ops } = mockDb({})
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'absent')
    assert.equal(ops.updates.length, 0)
  })

  it('a second run is a no-op — the ref it owned is gone', async () => {
    const { db } = mockDb({ 'contacts/ct1': { subscription_type_id: 'st1' } })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PLAIN_SUB,
      plan: CLEAR,
    })
    assert.equal(out.subscription, 'skipped_not_owner')
  })
})

describe('reversePaymentEffects — credits', () => {
  it('reduces credits_total to the IN-TRANSACTION credits_used, absolutely', async () => {
    const { db, ops } = mockDb({
      // The plan said reduce_to 0 (nothing consumed at pre-flight); by the time
      // the transaction runs she has spent 2. Those two stay hers.
      'contacts/ct1/credit_grants/pi_1': { credits_total: 10, credits_used: 2 },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(out.credits, 'reduced')
    assert.equal(out.creditsRevoked, 8)
    const u = ops.updates.find((x) => x.path === 'contacts/ct1/credit_grants/pi_1')!
    assert.equal(u.data.credits_total, 2, 'absolute, from the transaction read set')
    assert.equal(u.data.credits_used, undefined, 'credits_used is never touched')
    assert.equal(u.data.credits_revoked, 8)
    assert.equal(u.data.reversed_by_payment_ref, 'pi_1')
  })

  it('reduces an untouched pack to zero', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1/credit_grants/pi_1': { credits_total: 10, credits_used: 0 },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(out.creditsRevoked, 10)
    assert.equal(ops.updates[0].data.credits_total, 0)
  })

  it('a second run writes nothing — total already equals used', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1/credit_grants/pi_1': {
        credits_total: 3,
        credits_used: 3,
        credits_revoked: 7,
      },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(out.credits, 'reduced')
    assert.equal(out.creditsRevoked, 0)
    assert.equal(ops.updates.length, 0)
  })

  it('accumulates credits_revoked across two reversals without an increment', async () => {
    const { db, ops } = mockDb({
      'contacts/ct1/credit_grants/pi_1': {
        credits_total: 8,
        credits_used: 2,
        credits_revoked: 2,
      },
    })
    await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(ops.updates[0].data.credits_revoked, 8)
  })

  it('reports absent when no grant exists at that doc id', async () => {
    const { db, ops } = mockDb({})
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(out.credits, 'absent')
    assert.equal(ops.updates.length, 0)
  })

  it('reaches the grant BY DOC ID — never by a field query', async () => {
    const { db, reads } = mockDb({
      // A Connect grant stamps payment_intent_id, not payment_ref. Keying off a
      // field would have missed this one entirely.
      'contacts/ct1/credit_grants/pi_1': {
        credits_total: 5,
        credits_used: 0,
        payment_intent_id: 'pi_1',
      },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: PACK,
      plan: REDUCE,
    })
    assert.equal(out.creditsRevoked, 5)
    assert.deepEqual(reads, ['contacts/ct1/credit_grants/pi_1'])
  })
})

describe('reversePaymentEffects — course entitlement', () => {
  it('deletes when payment_ref matches', async () => {
    const { db, ops } = mockDb({ 'courses/c1/purchases/ct1': { payment_ref: 'pi_1' } })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'deleted')
    assert.deepEqual(ops.deletes, ['courses/c1/purchases/ct1'])
  })

  it('deletes when only the legacy paymentIntentId matches', async () => {
    const { db, ops } = mockDb({ 'courses/c1/purchases/ct1': { paymentIntentId: 'pi_1' } })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'deleted')
    assert.deepEqual(ops.deletes, ['courses/c1/purchases/ct1'])
  })

  it('SKIPS a gift-card-funded entitlement — no /payments refund owns it', async () => {
    const { db, ops } = mockDb({
      'courses/c1/purchases/ct1': { payment_ref: 'gift:GC-ABC:hold1', source: 'gift_card' },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'skipped_not_owner')
    assert.deepEqual(ops.deletes, [], 'nothing deleted')
  })

  it('SKIPS an entitlement with no provenance at all', async () => {
    const { db, ops } = mockDb({ 'courses/c1/purchases/ct1': { contactId: 'ct1' } })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'skipped_not_owner')
    assert.deepEqual(ops.deletes, [])
  })

  it('a second run finds it absent', async () => {
    const { db } = mockDb({})
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'absent')
  })

  it('reports absent — and reads nothing — when the line item names no course', async () => {
    const { db, reads } = mockDb({})
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: { kind: 'course' },
      plan: DELETE_COURSE,
    })
    assert.equal(out.course, 'absent')
    assert.deepEqual(reads, [])
  })
})

describe('reversePaymentEffects — the read set', () => {
  it('reads only the documents the plan names, all by doc id', async () => {
    const { db, reads } = mockDb({
      'contacts/ct1': { subscription_type_id: 'st1', subscription_source_ref: 'pi_1' },
      'contacts/ct1/credit_grants/pi_1': { credits_total: 10, credits_used: 0 },
      'courses/c1/purchases/ct1': { payment_ref: 'pi_1' },
    })
    await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: COURSE,
      plan: {
        subscription: 'clear_if_owned',
        credits: { op: 'reduce_to', total: 0 },
        course: 'delete_if_owned',
      },
    })
    assert.deepEqual(reads, [
      'contacts/ct1',
      'contacts/ct1/credit_grants/pi_1',
      'courses/c1/purchases/ct1',
    ])
  })

  it('reads NOTHING when the plan touches nothing', async () => {
    const { db, reads, ops } = mockDb({
      'contacts/ct1': { subscription_type_id: 'st1', subscription_source_ref: 'pi_1' },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'pi_1',
      lineItem: { kind: 'product' },
      plan: { subscription: 'leave', credits: { op: 'leave' }, course: 'leave' },
    })
    assert.deepEqual(reads, [])
    assert.deepEqual(ops.updates, [])
    assert.deepEqual(ops.deletes, [])
    assert.deepEqual(out, {
      subscription: 'left',
      credits: 'left',
      creditsRevoked: 0,
      course: 'left',
    })
  })
})
