import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import payloads from './dahlia-payloads.json'
import {
  INVOICE_PAYMENTS_EXPAND,
  SUBSCRIPTION_LATEST_INVOICE_PAYMENTS_EXPAND,
  readInvoicePaymentIntentId,
} from './objectShape'

// The EXPAND CALL SITES, pinned.
//
// objectShape.test.ts pins the readers. This file pins the thing that has to
// happen BEFORE a reader can succeed — the fetch that asks Stripe for the list
// the reader reads.
//
// It exists because this failure mode is silent in both directions. Stripe
// IGNORES an unrecognised expand path rather than rejecting it, so a call site
// that asks for the old `latest_invoice.payment_intent` gets a 200, a normal
// looking object, and `undefined` where the PaymentIntent should be. That is the
// original defect exactly: a member paid, the charge was never linked to them,
// and no log line anywhere said so. Reverting either call site would reproduce it
// without failing a single existing test.
//
// So: pin the constants against the REAL captured payloads (a wrong constant
// stops resolving a PaymentIntent), and pin that both call sites still reference
// them (a hand-typed string cannot creep back in).

const p = payloads as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const WEBHOOK_SRC = path.join(__dirname, '..', '..', 'connect', 'webhook.ts')

describe('invoice payments expand paths', () => {
  it('the DELIVERED invoice cannot answer at all — which is why an expand is needed', () => {
    // The premise. If this ever starts passing, `payments` arrived in the webhook
    // payload and the two retrieves below became unnecessary.
    const delivered = p.invoice_delivered_event_object
    assert.equal('payments' in delivered, false, 'payments is expand-only')
    const read = readInvoicePaymentIntentId(delivered)
    assert.equal(read.source, 'absent')
    assert.equal(read.value, null)
  })

  it('expand:["payments"] on an invoice DOES answer — the constant names that path', () => {
    const expanded = p.invoice_retrieved_expanded
    assert.equal(INVOICE_PAYMENTS_EXPAND, 'payments')
    // The captured object is what the API returned for exactly this expand, so
    // the constant and the payload are two halves of one verified fact.
    const read = readInvoicePaymentIntentId(expanded)
    assert.equal(read.source, 'modern')
    assert.ok(read.value?.startsWith('pi_'), `expected a PaymentIntent id, got ${read.value}`)
    assert.equal(read.value, expanded.payments.data[0].payment.payment_intent)
  })

  it('expand:["latest_invoice.payments"] on a subscription DOES answer too', () => {
    const sub = p.subscription_retrieved_expanded_latest_invoice_payments
    assert.equal(SUBSCRIPTION_LATEST_INVOICE_PAYMENTS_EXPAND, 'latest_invoice.payments')
    const read = readInvoicePaymentIntentId(sub.latest_invoice)
    assert.equal(read.source, 'modern')
    assert.ok(read.value?.startsWith('pi_'), `expected a PaymentIntent id, got ${read.value}`)
  })

  it('the REMOVED expand path resolves nothing, so asking for it is a silent no-op', () => {
    // Hand-written on purpose: what a pre-Dahlia call site got back. The point is
    // that it is indistinguishable from success without this assertion.
    const asIfOldExpand = { id: 'in_x', parent: { type: 'subscription_details' } }
    assert.equal(readInvoicePaymentIntentId(asIfOldExpand).value, null)
  })
})

describe('connect/webhook.ts uses the named expand paths', () => {
  const src = fs.readFileSync(WEBHOOK_SRC, 'utf8')

  it('both invoice retrieves expand through INVOICE_PAYMENTS_EXPAND', () => {
    // handleInvoice's renewal retrieve, and handleCheckoutCompleted's
    // first-charge fallback retrieve.
    const uses = src.match(/expand: \[INVOICE_PAYMENTS_EXPAND\]/g) ?? []
    assert.equal(uses.length, 2, 'expected both invoices.retrieve call sites to use the constant')
  })

  it('the subscription retrieve expands through SUBSCRIPTION_LATEST_INVOICE_PAYMENTS_EXPAND', () => {
    const uses = src.match(/expand: \[SUBSCRIPTION_LATEST_INVOICE_PAYMENTS_EXPAND\]/g) ?? []
    assert.equal(uses.length, 1)
  })

  it('no call site hand-types an expand path for these lists', () => {
    // The regression guard with teeth: a literal string here is either the old
    // removed path or a copy that will not move when objectShape.ts does.
    const literals = src.match(/expand: \[\s*'[^']*'/g) ?? []
    assert.deepEqual(
      literals,
      [],
      `expand paths must come from objectShape.ts constants; found ${literals.join(', ')}`
    )
  })

  it('the removed pre-Dahlia expand path is never passed as a string', () => {
    // Quoted literals only — the file names the dead path in prose on purpose,
    // to explain what moved. Prose is fine; an argument is the bug.
    for (const dead of ["'latest_invoice.payment_intent'", '"latest_invoice.payment_intent"']) {
      assert.ok(
        !src.includes(dead),
        `${dead} is not an expand path on Dahlia — Stripe ignores it silently and returns undefined`
      )
    }
  })
})
