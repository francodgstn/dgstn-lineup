// The ONE rule a void does not share with a refund: a used pack is not
// refundable, but it IS voidable.
//
// A refund of a used pack is refused because refunding money for delivered
// classes is a policy question. A void moves no money — it says the record was
// wrong — so there is no such question to decline, and the honest outcome is the
// one the executor already implements: the classes actually taken stand, the
// remainder is withdrawn.

import assert from 'node:assert/strict'
import type { firestore } from 'firebase-admin'
import { reversePaymentEffects } from './reversal'
import { voidActionsFor } from './voidManualPayment'

const PACK = { kind: 'subscription' as const, subscriptionTypeId: 'st1', priceId: 'p1' }

/** Firestore double: get() by doc id off a seed map; writes recorded by path. */
function mockDb(seed: Record<string, Record<string, unknown> | undefined>) {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = []
  const docRef = (path: string) => ({
    path,
    collection: (name: string) => colRef(`${path}/${name}`),
  })
  const colRef = (path: string) => ({ doc: (id: string) => docRef(`${path}/${id}`) })
  const tx = {
    async get(ref: { path: string }) {
      const data = seed[ref.path]
      return { exists: data !== undefined, data: () => data }
    },
    update(ref: { path: string }, data: Record<string, unknown>) {
      updates.push({ path: ref.path, data })
    },
    delete() {},
  }
  const db = {
    collection: (name: string) => colRef(name),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as firestore.Firestore
  return { db, updates }
}

describe('voidActionsFor', () => {
  it('an untouched pack: the same plan a full refund gets', () => {
    const plan = voidActionsFor(PACK, { unitsGranted: 10, unitsConsumed: 0 })
    assert.deepEqual(plan.credits, { op: 'reduce_to', total: 0 })
    assert.equal(plan.subscription, 'clear_if_owned')
  })

  it('a CONSUMED pack is not refused — the refusal is a refund rule, not a void rule', () => {
    const plan = voidActionsFor(PACK, { unitsGranted: 10, unitsConsumed: 3 })
    assert.deepEqual(plan.credits, { op: 'reduce_to', total: 0 })
    assert.equal(plan.subscription, 'clear_if_owned')
  })

  it('a plain membership clears; a course deletes; a product touches nothing', () => {
    assert.equal(voidActionsFor({ kind: 'subscription' }, null).subscription, 'clear_if_owned')
    assert.equal(voidActionsFor({ kind: 'course', courseId: 'c1' }, null).course, 'delete_if_owned')
    const product = voidActionsFor({ kind: 'product' }, null)
    assert.equal(product.subscription, 'leave')
    assert.equal(product.course, 'leave')
    assert.deepEqual(product.credits, { op: 'leave' })
  })

  it('an unlinked row touches nothing', () => {
    const plan = voidActionsFor(null, null)
    assert.equal(plan.subscription, 'leave')
    assert.deepEqual(plan.credits, { op: 'leave' })
    assert.equal(plan.course, 'leave')
  })
})

describe('voiding a partly consumed pack', () => {
  it('withdraws the remainder and leaves the delivered classes standing', async () => {
    const { db, updates } = mockDb({
      'contacts/ct1/credit_grants/manual:ref1': { credits_total: 10, credits_used: 3 },
    })
    const out = await reversePaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      paymentRef: 'manual:ref1',
      lineItem: PACK,
      plan: voidActionsFor(PACK, { unitsGranted: 10, unitsConsumed: 3 }),
    })
    assert.equal(out.creditsRevoked, 7)
    const u = updates.find((x) => x.path === 'contacts/ct1/credit_grants/manual:ref1')!
    // The target was 0; the executor clamped it UP to credits_used. Three classes
    // were delivered, so three credits remain spent and none of them is clawed
    // back — "delivered value is owed", reached from the void side.
    assert.equal(u.data.credits_total, 3)
    assert.equal(u.data.credits_used, undefined, 'credits_used is never touched')
  })
})
