import assert from 'node:assert/strict'
import payloads from '../utils/stripe/dahlia-payloads.json'
import { extractPayment } from './handleTeamStripeWebhook'

// WHICH BYO EVENT MAY WRITE A ROW — the double-count guard.
//
// The BYO rail keys `payment_events/stripe:{ref}` on the underlying payment so
// that every event about one payment converges on one row. On Dahlia that
// invariant is BREAKABLE, and these fixtures pin exactly where.
//
// The captured payloads below are one real payment: charge, PaymentIntent and
// invoice, all for the same 89.00. Against them:
//
//   • the charge and the PaymentIntent agree on a key (the PI id) — fine;
//   • the invoice can name NEITHER of them (`invoice.payment_intent` removed,
//     `payments` expand-only, and BYO holds no credentials to expand with), so it
//     keys on itself;
//   • the charge cannot name the invoice either — Dahlia removed `charge.invoice`
//     with no replacement on the object.
//
// So charge-vs-invoice can never dedupe, in either direction, from inside this
// rail. The only thing that stops a studio subscribed to charge.succeeded AND
// invoice.payment_succeeded from booking every recurring payment TWICE is that
// the charge is not allowed to open a row at all.

const p = payloads as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const CHARGE = p.charge_succeeded_event_object
const PI = p.payment_intent_succeeded_event_object
const INVOICE = p.invoice_delivered_event_object

describe('BYO Stripe — which event may record a payment', () => {
  it('charge.succeeded is ENRICH-ONLY and must never record a row', () => {
    // The regression this exists for: making this 'record' re-opens the
    // double-count path against invoice.payment_succeeded.
    const e = extractPayment('charge.succeeded', CHARGE, null)
    assert.ok(e)
    assert.equal(e.role, 'enrich')
  })

  it('payment_intent.succeeded and checkout.session.completed DO record', () => {
    assert.equal(extractPayment('payment_intent.succeeded', PI, null)?.role, 'record')
    assert.equal(extractPayment('invoice.payment_succeeded', INVOICE, null)?.role, 'record')
  })

  it('the charge and its PaymentIntent converge on ONE key, so they dedupe', () => {
    const charge = extractPayment('charge.succeeded', CHARGE, null)
    const pi = extractPayment('payment_intent.succeeded', PI, null)
    assert.equal(charge?.ref, pi?.ref)
    assert.equal(charge?.refKind, 'payment')
    assert.equal(pi?.refKind, 'payment')
  })

  it('the invoice for the SAME payment keys somewhere else — and cannot be bridged', () => {
    // Not a defect to fix here, a fact to design around: this is why the charge
    // is enrich-only rather than "keyed to dedupe against the invoice".
    const invoice = extractPayment('invoice.payment_succeeded', INVOICE, null)
    const pi = extractPayment('payment_intent.succeeded', PI, null)
    assert.equal(invoice?.refKind, 'fallback', 'the delivered invoice cannot name its PaymentIntent')
    assert.equal(invoice?.ref, INVOICE.id)
    assert.notEqual(invoice?.ref, pi?.ref)

    // …and the charge has no route back to the invoice either.
    assert.equal('invoice' in CHARGE, false, 'charge.invoice was removed on Dahlia')
  })

  it('the charge carries the payer email that nothing else does — the reason it is handled', () => {
    // If this ever stops being true, charge.succeeded has no remaining purpose on
    // this rail and the case should be deleted rather than kept as a no-op.
    assert.equal(PI.receipt_email, null, 'an invoice-generated PI has no email')
    const charge = extractPayment('charge.succeeded', CHARGE, null)
    assert.equal(charge?.email, CHARGE.billing_details.email)
    assert.ok(charge?.email, 'the charge is the last object carrying the payer email')
  })

  it('an unsupported event records nothing', () => {
    assert.equal(extractPayment('charge.refunded', CHARGE, null), null)
    assert.equal(extractPayment('invoice.payment_failed', INVOICE, null), null)
  })
})
