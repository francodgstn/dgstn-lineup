import assert from 'node:assert/strict'
import {
  byoStripeEventFamily,
  detectByoStripeDoubleRecording,
  type ByoStripeEventRow,
} from '@linyup/shared'
import { extractPayment } from './handleTeamStripeWebhook'
import payloads from '../utils/stripe/dahlia-payloads.json'

// DETECTING the double-count, without ever GUESSING at it.
//
// The rail cannot stop a studio subscribing to both Stripe event families
// (docs/open-defects.md → "A BYO studio can double-count its own recurring
// revenue"), but it can READ what the endpoint delivered: `raw_status` on a
// recorded row is the literal event type that wrote it. These pin the two
// halves that matter — the reading is a fact, and the reading never claims two
// specific rows are the same money.

const p = payloads as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 18)

function row(raw_status: string, daysAgo: number, gateway = 'stripe'): ByoStripeEventRow {
  return { gateway, raw_status, processedAtMs: NOW - daysAgo * DAY }
}

describe('BYO Stripe — detecting both event families', () => {
  it('classifies exactly the event types that RECORD a row', () => {
    assert.equal(byoStripeEventFamily('payment_intent.succeeded'), 'payment')
    assert.equal(byoStripeEventFamily('checkout.session.completed'), 'payment')
    assert.equal(byoStripeEventFamily('invoice.payment_succeeded'), 'invoice')
    // Enrich-only: it never writes a row, so it never appears as a raw_status.
    assert.equal(byoStripeEventFamily('charge.succeeded'), null)
    // Payrexx statuses and manual rows must not be read as Stripe events.
    assert.equal(byoStripeEventFamily('confirmed'), null)
    assert.equal(byoStripeEventFamily(null), null)
  })

  it('the classification agrees with what extractPayment actually stores', () => {
    // The tell only works while `raw_status` is the event type and the two
    // recording branches key on different things. Re-derived from the source
    // rather than restated, so a change to either side fails here.
    const pi = extractPayment('payment_intent.succeeded', p.payment_intent_succeeded_event_object, null)
    const inv = extractPayment('invoice.payment_succeeded', p.invoice_delivered_event_object, null)
    assert.equal(pi?.role, 'record')
    assert.equal(inv?.role, 'record')
    assert.equal(pi?.refKind, 'payment')
    assert.equal(inv?.refKind, 'fallback')
    assert.equal(byoStripeEventFamily('payment_intent.succeeded'), 'payment')
    assert.equal(byoStripeEventFamily('invoice.payment_succeeded'), 'invoice')
  })

  it('warns only when BOTH families arrived', () => {
    const healthy = detectByoStripeDoubleRecording(
      [row('payment_intent.succeeded', 1), row('checkout.session.completed', 3)],
      { nowMs: NOW }
    )
    assert.equal(healthy.bothFamilies, false)
    assert.equal(healthy.paymentRows, 2)
    assert.equal(healthy.invoiceRows, 0)

    // An invoice-only endpoint is misconfigured in a different way (rows key on
    // the invoice, and the payer email never arrives) but it does not DOUBLE
    // count, so this signal must stay quiet about it.
    const invoiceOnly = detectByoStripeDoubleRecording(
      [row('invoice.payment_succeeded', 1), row('invoice.payment_succeeded', 30)],
      { nowMs: NOW }
    )
    assert.equal(invoiceOnly.bothFamilies, false)

    const both = detectByoStripeDoubleRecording(
      [row('payment_intent.succeeded', 1), row('invoice.payment_succeeded', 1)],
      { nowMs: NOW }
    )
    assert.equal(both.bothFamilies, true)
    assert.deepEqual(both.invoiceEventTypes, ['invoice.payment_succeeded'])
    assert.equal(both.lastInvoiceAtMs, NOW - DAY)
  })

  it('reads only Stripe rows — Payrexx and manual rows are a different rail', () => {
    const signal = detectByoStripeDoubleRecording(
      [
        row('payment_intent.succeeded', 1),
        row('invoice.payment_succeeded', 1, 'payrexx'),
        { gateway: 'manual', raw_status: 'invoice.payment_succeeded', processedAtMs: NOW },
      ],
      { nowMs: NOW }
    )
    assert.equal(signal.bothFamilies, false)
    assert.equal(signal.invoiceRows, 0)
  })

  it('is SELF-CLEARING: a fixed endpoint ages out of the window', () => {
    const rows = [row('payment_intent.succeeded', 2), row('invoice.payment_succeeded', 200)]
    assert.equal(detectByoStripeDoubleRecording(rows, { nowMs: NOW }).bothFamilies, false)
    // …and the same data inside a wide enough window still shows the history,
    // so nothing is being hidden — only the accusation is bounded.
    assert.equal(
      detectByoStripeDoubleRecording(rows, { nowMs: NOW, windowDays: 365 }).bothFamilies,
      true
    )
  })

  it('ignores an undated row rather than counting it', () => {
    const signal = detectByoStripeDoubleRecording(
      [row('payment_intent.succeeded', 1), { gateway: 'stripe', raw_status: 'invoice.payment_succeeded' }],
      { nowMs: NOW }
    )
    assert.equal(signal.bothFamilies, false, 'a row that cannot be placed in the window proves nothing')
  })

  it('never pairs rows — it counts families, it does not match money', () => {
    // The guard against the rejected fix. One payment event and fifty invoice
    // events is the SAME claim as one and one: both families arrived. Nothing
    // in the result identifies a pair, and nothing here may grow into doing so.
    const signal = detectByoStripeDoubleRecording(
      [row('payment_intent.succeeded', 1), ...Array.from({ length: 50 }, () => row('invoice.payment_succeeded', 2))],
      { nowMs: NOW }
    )
    assert.equal(signal.bothFamilies, true)
    assert.equal(signal.paymentRows, 1)
    assert.equal(signal.invoiceRows, 50)
    assert.deepEqual(Object.keys(signal).sort(), [
      'bothFamilies',
      'invoiceEventTypes',
      'invoiceRows',
      'lastInvoiceAtMs',
      'lastPaymentAtMs',
      'paymentRows',
      'windowDays',
    ])
  })
})
