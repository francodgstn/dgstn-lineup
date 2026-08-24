// Unit tests for the money-seam resolver.
//
// Almost every case here is a WRITE ORDERING case, because that is what this resolver
// is for: one sale writes the payment document several times, from two Stripe handlers
// whose order Stripe does not guarantee, and Stripe redelivers. A resolver keyed on
// "the document changed" would fire two or three times per sale and once more per
// redelivery, and the studio would find that out by sending the same person the same
// email twice.

import assert from 'node:assert/strict'
import {
  PAYMENT_SUBJECT_ARRIVAL_WINDOW_MS,
  resolvePaymentEvents,
  type PaymentEvent,
} from './paymentEvents'

const PI = 'pi_test_1'
const NOW = 1_724_400_000_000 // fixed: the resolver takes nowMs, so nothing here is clock-dependent

/** A member_payments row as `handlePaymentIntent` writes it on a successful charge. */
function succeeded(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: 't1',
    paymentIntentId: PI,
    contactId: 'c1',
    kind: 'course',
    amount: 4500,
    currency: 'chf',
    status: 'succeeded',
    amount_refunded: 0,
    created_at: { seconds: Math.floor(NOW / 1000), nanoseconds: 0 },
    ...over,
  }
}

const types = (events: PaymentEvent[]) => events.map((e) => e.triggerType)

const run = (before: unknown, after: unknown, nowMs = NOW) =>
  resolvePaymentEvents(
    before as FirebaseFirestore.DocumentData | undefined,
    after as FirebaseFirestore.DocumentData | undefined,
    PI,
    nowMs
  )

// ---------------------------------------------------------------------------
// payment_received
// ---------------------------------------------------------------------------

describe('resolvePaymentEvents — payment_received', () => {
  it('fires once when a charge lands already carrying its contact', () => {
    const events = run(undefined, succeeded())
    assert.deepEqual(types(events), ['payment_received'])
    assert.equal(events[0].contactId, 'c1')
    assert.deepEqual(events[0].delta.payment, {
      paymentIntentId: PI,
      kind: 'course',
      amountMinor: 4500,
      currency: 'chf',
    })
  })

  it('does NOT fire while the row is still unassigned — an event with no subject is not an event', () => {
    const events = run(undefined, succeeded({ contactId: null }))
    assert.deepEqual(types(events), [])
  })

  it('fires when the checkout handler stamps contactId onto an already-succeeded row', () => {
    // The real ordering hazard: payment_intent.succeeded and checkout.session.completed
    // are 1–4 s apart and either can win. Keying on the status alone would have fired
    // with nobody to fire for, and then never again.
    const before = succeeded({ contactId: null })
    const events = run(before, succeeded())
    assert.deepEqual(types(events), ['payment_received'])
  })

  it('does NOT fire again on the fee-mirror write that follows the create', () => {
    const before = succeeded()
    const after = succeeded({ stripe_fee_amount: 160, balance_txn_id: 'txn_1' })
    assert.deepEqual(types(run(before, after)), [])
  })

  it('does NOT fire when a manager assigns a long-settled payment by hand', () => {
    // updatePaymentRecord writes contactId months later. Without the age bound this is
    // indistinguishable from the webhook race above, and every reconciled row sends a
    // thank-you for a purchase the buyer has forgotten making.
    const old = { seconds: Math.floor((NOW - 90 * 24 * 3600 * 1000) / 1000), nanoseconds: 0 }
    const before = succeeded({ contactId: null, created_at: old })
    const after = succeeded({ created_at: old })
    assert.deepEqual(types(run(before, after)), [])
  })

  it('the age bound applies to the SUBJECT-arrival branch only, never to a fresh charge', () => {
    // A backfill or a replay writing an old charge as succeeded-with-contact in one go
    // is still a status transition, and is still the payment being recorded.
    const old = { seconds: Math.floor((NOW - 90 * 24 * 3600 * 1000) / 1000), nanoseconds: 0 }
    assert.deepEqual(types(run(undefined, succeeded({ created_at: old }))), ['payment_received'])
  })

  it('an arrival just inside the window fires; just outside does not', () => {
    const at = (ageMs: number) => ({
      seconds: Math.floor((NOW - ageMs) / 1000),
      nanoseconds: 0,
    })
    const inside = at(PAYMENT_SUBJECT_ARRIVAL_WINDOW_MS - 60_000)
    const outside = at(PAYMENT_SUBJECT_ARRIVAL_WINDOW_MS + 60_000)
    assert.deepEqual(
      types(run(succeeded({ contactId: null, created_at: inside }), succeeded({ created_at: inside }))),
      ['payment_received']
    )
    assert.deepEqual(
      types(run(succeeded({ contactId: null, created_at: outside }), succeeded({ created_at: outside }))),
      []
    )
  })

  it('accepts an admin Timestamp as well as a plain {seconds} for created_at', () => {
    const ts = { toMillis: () => NOW }
    const before = succeeded({ contactId: null, created_at: ts })
    assert.deepEqual(types(run(before, succeeded({ created_at: ts }))), ['payment_received'])
  })

  it('a pending charge that has not settled fires nothing', () => {
    assert.deepEqual(types(run(undefined, succeeded({ status: 'pending' }))), [])
  })

  it('a deleted row fires nothing', () => {
    assert.deepEqual(types(run(succeeded(), undefined)), [])
  })
})

// ---------------------------------------------------------------------------
// payment_refunded
// ---------------------------------------------------------------------------

describe('resolvePaymentEvents — payment_refunded', () => {
  it('fires on the reconciliation, with the amount and the full/partial answer', () => {
    const events = run(succeeded(), succeeded({ status: 'refunded', amount_refunded: 4500 }))
    assert.deepEqual(types(events), ['payment_refunded'])
    assert.equal(events[0].delta.payment?.refundAmountMinor, 4500)
    assert.equal(events[0].delta.payment?.refundIsFull, true)
  })

  it('does NOT fire on the auto-refund pre-stamp that carries no amount yet', () => {
    // handleDropInCheckout / handleAppointmentCheckout stamp status: 'refunded' on a
    // duplicate or oversold booking while amount_refunded is still 0. The money figure
    // arrives later, on charge.refunded. Keying on the status would fire here — with
    // "refunded CHF 0.00" as the only thing known about it.
    const pre = succeeded({ status: 'refunded', amount_refunded: 0 })
    assert.deepEqual(types(run(succeeded(), pre)), [])
    // …and then the authoritative write fires it exactly once.
    const events = run(pre, succeeded({ status: 'refunded', amount_refunded: 4500 }))
    assert.deepEqual(types(events), ['payment_refunded'])
    assert.equal(events[0].delta.payment?.refundAmountMinor, 4500)
  })

  it('does NOT fire again when Stripe redelivers charge.refunded', () => {
    // Every refund write is an ABSOLUTE cumulative figure, so a redelivery re-writes the
    // same number and the amount does not increase.
    const refunded = succeeded({ status: 'refunded', amount_refunded: 4500 })
    assert.deepEqual(types(run(refunded, { ...refunded, last_event_id: 'evt_2' })), [])
  })

  it('fires a second time for a second partial refund, with only that refund’s amount', () => {
    // partially_refunded → partially_refunded is not a status transition, but it is a
    // second real event about a second real refund.
    const first = succeeded({ status: 'partially_refunded', amount_refunded: 1000 })
    const events = run(first, succeeded({ status: 'partially_refunded', amount_refunded: 2500 }))
    assert.deepEqual(types(events), ['payment_refunded'])
    assert.equal(events[0].delta.payment?.refundAmountMinor, 1500)
    assert.equal(events[0].delta.payment?.refundIsFull, false)
  })

  it('a partial followed by the remainder gives two events, the second marked full', () => {
    const partial = succeeded({ status: 'partially_refunded', amount_refunded: 1000 })
    assert.equal(run(succeeded(), partial)[0].delta.payment?.refundIsFull, false)
    const rest = run(partial, succeeded({ status: 'refunded', amount_refunded: 4500 }))
    assert.equal(rest[0].delta.payment?.refundIsFull, true)
    assert.equal(rest[0].delta.payment?.refundAmountMinor, 3500)
  })

  it('does NOT fire while the row is unassigned', () => {
    const before = succeeded({ contactId: null })
    const after = succeeded({ contactId: null, status: 'refunded', amount_refunded: 4500 })
    assert.deepEqual(types(run(before, after)), [])
  })
})

// ---------------------------------------------------------------------------
// payment_disputed
// ---------------------------------------------------------------------------

describe('resolvePaymentEvents — payment_disputed', () => {
  it('fires when a dispute first appears, carrying its status', () => {
    const events = run(succeeded(), succeeded({ dispute_status: 'needs_response' }))
    assert.deepEqual(types(events), ['payment_disputed'])
    assert.equal(events[0].delta.payment?.disputeStatus, 'needs_response')
  })

  it('does NOT fire again when the dispute is later closed', () => {
    // handleDispute writes the same field for both phases, so the edge has to be the
    // FIRST appearance rather than any change.
    const open = succeeded({ dispute_status: 'needs_response' })
    assert.deepEqual(types(run(open, succeeded({ dispute_status: 'lost' }))), [])
  })

  it('fires on a closing event that arrives with no opening one recorded', () => {
    assert.deepEqual(types(run(succeeded(), succeeded({ dispute_status: 'won' }))), [
      'payment_disputed',
    ])
  })
})

// ---------------------------------------------------------------------------
// The invariant the trigger module has to keep, pinned by reading its source.
// ---------------------------------------------------------------------------

describe('onMemberPaymentWrite — the money facts never ride in a payload', () => {
  it('passes no `payload` to fireEventRules', () => {
    // resolveEventDelayMinutes refuses a delay to ANY run carrying a non-empty payload.
    // Putting the amount there would leave the rule builder offering a delay field that
    // silently does nothing — the exact defect UX-85 was raised to remove. The facts go
    // in the EventDelta instead; this is what stops somebody "helpfully" moving them.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'onMemberPaymentWrite.ts'),
      'utf8'
    )
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l: string) => !l.trim().startsWith('//'))
      .join('\n')
    assert.equal(/\bpayload\b/.test(code), false)
  })
})
