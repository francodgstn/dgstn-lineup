import assert from 'node:assert/strict'
import type { firestore } from 'firebase-admin'
import { applyPaymentEffects, normalizePaymentLineItem } from './effects'

// Minimal Firestore double: records set/create/add ops keyed by their full path,
// and answers get() from a seed map. Enough to exercise applyPaymentEffects.
interface Ops {
  sets: Array<{ path: string; data: Record<string, unknown> }>
  creates: Array<{ path: string; data: Record<string, unknown> }>
  adds: Array<{ path: string; data: Record<string, unknown> }>
}

function mockDb(seed: Record<string, Record<string, unknown>>) {
  const ops: Ops = { sets: [], creates: [], adds: [] }
  const docRef = (path: string) => ({
    async get() {
      return { exists: seed[path] !== undefined, data: () => seed[path] }
    },
    async set(data: Record<string, unknown>) {
      ops.sets.push({ path, data })
    },
    async create(data: Record<string, unknown>) {
      if (seed[path] !== undefined) {
        const e = new Error('already exists') as Error & { code?: number }
        e.code = 6
        throw e
      }
      seed[path] = data
      ops.creates.push({ path, data })
    },
    collection(name: string) {
      return colRef(`${path}/${name}`)
    },
  })
  const colRef = (path: string) => ({
    doc(id?: string) {
      return docRef(id ? `${path}/${id}` : `${path}/_auto${ops.adds.length}`)
    },
    async add(data: Record<string, unknown>) {
      ops.adds.push({ path, data })
    },
  })
  const db = { collection: (name: string) => colRef(name) } as unknown as firestore.Firestore
  return { db, ops }
}

describe('normalizePaymentLineItem', () => {
  it('rejects junk / unknown kinds', () => {
    assert.equal(normalizePaymentLineItem(null), null)
    assert.equal(normalizePaymentLineItem({ kind: 'bogus' }), null)
    assert.equal(normalizePaymentLineItem('nope'), null)
  })

  it('passes a valid subscription line-item through', () => {
    const li = normalizePaymentLineItem({ kind: 'subscription', subscriptionTypeId: 'st1', priceId: 'p1' })
    assert.deepEqual(li, { kind: 'subscription', subscriptionTypeId: 'st1', priceId: 'p1' })
  })

  it('downgrades an effect-less subscription/course link to "other"', () => {
    assert.deepEqual(normalizePaymentLineItem({ kind: 'subscription', label: 'x' }), {
      kind: 'other',
      label: 'x',
    })
    assert.deepEqual(normalizePaymentLineItem({ kind: 'course' }), { kind: 'other' })
  })

  it('keeps product + variant', () => {
    const li = normalizePaymentLineItem({ kind: 'product', productId: 'pr1', variantId: 'v1', label: 'Tee · L' })
    assert.deepEqual(li, { kind: 'product', productId: 'pr1', variantId: 'v1', label: 'Tee · L' })
  })
})

describe('applyPaymentEffects', () => {
  it('subscription → sets contact fields + grants credits + logs activity', async () => {
    const { db, ops } = mockDb({
      'teams/t1/subscription_types/st1': {
        name: 'Monthly',
        prices: [{ id: 'p1', amount: 50, recurrence: 'monthly', credits: 8, included_months: 1 }],
      },
    })
    await applyPaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      lineItem: { kind: 'subscription', subscriptionTypeId: 'st1', priceId: 'p1' },
      amountRappen: 5000,
      currency: 'CHF',
      source: 'manual',
      paymentRef: 'manual:x',
    })

    const contactSet = ops.sets.find((s) => s.path === 'contacts/ct1')
    assert.ok(contactSet, 'contact fields written')
    assert.equal(contactSet!.data.subscription_type_id, 'st1')
    assert.equal(contactSet!.data.subscription_type_name, 'Monthly')
    assert.equal(contactSet!.data.subscription_price_id, 'p1')
    assert.equal(contactSet!.data.subscription_amount, 50)

    const grant = ops.creates.find((c) => c.path === 'contacts/ct1/credit_grants/manual:x')
    assert.ok(grant, 'credit grant created')
    assert.equal(grant!.data.credits_total, 8)
    assert.equal(grant!.data.source, 'manual')

    const activity = ops.adds.find((a) => a.path === 'contacts/ct1/activity_log')
    assert.ok(activity, 'activity logged')
    assert.equal(activity!.data.type, 'payment_received')
    assert.equal(activity!.data.payment_id, 'manual:x')
  })

  it('subscription without credits → no credit grant', async () => {
    const { db, ops } = mockDb({
      'teams/t1/subscription_types/st1': {
        name: 'Monthly',
        prices: [{ id: 'p1', amount: 50, recurrence: 'monthly' }],
      },
    })
    await applyPaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      lineItem: { kind: 'subscription', subscriptionTypeId: 'st1', priceId: 'p1' },
      amountRappen: 5000,
      currency: 'CHF',
      source: 'manual',
      paymentRef: 'manual:x',
    })
    assert.equal(ops.creates.length, 0)
  })

  it('course → grants the entitlement + logs activity', async () => {
    const { db, ops } = mockDb({ 'courses/c1': { teamId: 't1', title: 'Yoga 101' } })
    await applyPaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      lineItem: { kind: 'course', courseId: 'c1' },
      amountRappen: 9900,
      currency: 'CHF',
      source: 'manual',
      paymentRef: 'manual:y',
    })
    const purchase = ops.sets.find((s) => s.path === 'courses/c1/purchases/ct1')
    assert.ok(purchase, 'entitlement granted')
    assert.equal(purchase!.data.courseId, 'c1')
    assert.equal(purchase!.data.contactId, 'ct1')
    const activity = ops.adds.find((a) => a.path === 'contacts/ct1/activity_log')
    assert.equal(activity?.data.type, 'course_purchased')
  })

  it('course from another team → no entitlement (guarded)', async () => {
    const { db, ops } = mockDb({ 'courses/c2': { teamId: 'other', title: 'X' } })
    await applyPaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      lineItem: { kind: 'course', courseId: 'c2' },
      amountRappen: 9900,
      currency: 'CHF',
      source: 'manual',
      paymentRef: 'manual:z',
    })
    assert.equal(ops.sets.length, 0)
    assert.equal(ops.adds.length, 0)
  })

  it('product → activity only (no entitlement)', async () => {
    const { db, ops } = mockDb({})
    await applyPaymentEffects(db, {
      teamId: 't1',
      contactId: 'ct1',
      lineItem: { kind: 'product', productId: 'pr1', label: 'Tee' },
      amountRappen: 2500,
      currency: 'CHF',
      source: 'manual',
      paymentRef: 'manual:p',
    })
    assert.ok(ops.sets.find((s) => s.path === 'contacts/ct1'), 'last_payment_at stamped')
    const activity = ops.adds.find((a) => a.path === 'contacts/ct1/activity_log')
    assert.equal(activity?.data.type, 'product_purchased')
    // No course/subscription writes.
    assert.equal(ops.creates.length, 0)
    assert.ok(!ops.sets.find((s) => s.path.includes('purchases')))
  })
})
