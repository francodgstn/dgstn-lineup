// Tests for `buildContactLedger` (packages/shared/src/utils/contactLedger.ts).
//
// The module under test lives in `packages/shared` and its only production
// caller is in `apps/web`. Neither package has a test runner — so the test for
// it lives HERE, in `packages/functions`, which does. That is the whole reason
// for the odd address; there is no functions-side code in this file.
//
// What these pin, in one line each: the ledger never invents a plan link, the
// grant→payment join happens exactly once per payment, a window that contains no
// plan events still tells the reader which plan was held, and money in two
// currencies is never added up.

import assert from 'node:assert/strict'
import {
  buildContactLedger,
  type LedgerCreditGrantInput,
  type LedgerPaymentInput,
  type LedgerPlanSpanInput,
  type LedgerRow,
} from '@linyup/shared'

/** Jan 2026, so the fixtures read as dates rather than as epoch arithmetic. */
const D = (day: number) => Date.UTC(2026, 0, day)

function pay(
  over: Partial<LedgerPaymentInput> & { paymentId: string; atMs: number }
): LedgerPaymentInput {
  return {
    amountMinor: 5000,
    refundedMinor: 0,
    currency: 'CHF',
    label: 'Monthly membership',
    status: 'succeeded',
    voided: false,
    planTypeId: null,
    planName: null,
    attribution: 'none',
    gateway: 'connect',
    ...over,
  }
}

function span(
  over: Partial<LedgerPlanSpanInput> & { id: string; startMs: number }
): LedgerPlanSpanInput {
  return { typeId: 'st_unlimited', planName: 'Unlimited', endMs: null, ...over }
}

function grant(
  over: Partial<LedgerCreditGrantInput> & { id: string; createdAtMs: number }
): LedgerCreditGrantInput {
  return {
    planName: '10-class pack',
    typeId: 'st_pack10',
    expiresAtMs: null,
    creditsTotal: 10,
    creditsUsed: 0,
    source: 'stripe',
    paymentRef: null,
    ...over,
  }
}

const EMPTY = { payments: [], planSpans: [], creditGrants: [] }

function kinds(rows: LedgerRow[]): string[] {
  return rows.map((r) => r.kind)
}

describe('buildContactLedger', () => {
  it('handles empty input without inventing anything', () => {
    const r = buildContactLedger({ ...EMPTY, fromMs: D(1), toMs: D(31) })
    assert.deepEqual(r.rows, [])
    assert.deepEqual(r.openingState.plans, [])
    assert.deepEqual(r.totals, [])
    assert.equal(r.flags.hasUnattributed, false)
    assert.deepEqual(r.flags.attributedTypesWithoutSpan, [])
  })

  // ── the prohibition ───────────────────────────────────────────────────────

  it('leaves an unattributed payment unattributed, even under a covering span', () => {
    // The temptation this guards: there IS one plan, it WAS running on the day,
    // so "obviously" the payment was for it. The link is to a plan TYPE and
    // never to a subscription instance, so the overlap is not evidence — and a
    // guess would render identically to a real attribution.
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_1', atMs: D(10), attribution: 'none' })],
      planSpans: [span({ id: 's1', startMs: D(2), endMs: D(28) })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    const row = r.rows.find((x) => x.kind === 'payment')
    assert.ok(row && row.kind === 'payment')
    assert.equal(row.payment.attribution, 'none')
    assert.equal(row.payment.planTypeId, null)
    assert.equal(row.payment.planName, null)
    assert.equal(r.flags.hasUnattributed, true)
    // …and the unattributed row must not leak into the incompleteness signal
    // either: it names no type, so it can say nothing about missing spans.
    assert.deepEqual(r.flags.attributedTypesWithoutSpan, [])
  })

  it('a voided payment neither raises hasUnattributed nor totals', () => {
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_v', atMs: D(10), voided: true, attribution: 'none' })],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.equal(
      kinds(r.rows).length,
      1,
      'the row is still SHOWN — it is struck through, not hidden'
    )
    assert.equal(r.flags.hasUnattributed, false)
    assert.deepEqual(r.totals, [])
  })

  // ── the join ──────────────────────────────────────────────────────────────

  it('joins a grant to its payment by paymentRef, and does not double-render it', () => {
    const g = grant({ id: 'grant_abc', createdAtMs: D(10), paymentRef: 'pi_pack' })
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_pack', atMs: D(10), label: '10-class pack' })],
      planSpans: [],
      creditGrants: [g],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment'])
    const row = r.rows[0]
    assert.ok(row.kind === 'payment')
    assert.equal(row.grant?.id, 'grant_abc')
  })

  it('joins a grant to its payment by the grant DOC ID when there is no ref', () => {
    const g = grant({ id: 'pi_pack', createdAtMs: D(10), paymentRef: null })
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_pack', atMs: D(10) })],
      planSpans: [],
      creditGrants: [g],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment'])
    const row = r.rows[0]
    assert.ok(row.kind === 'payment')
    assert.equal(row.grant?.id, 'pi_pack')
  })

  it('a grant with no matching payment speaks for itself', () => {
    const r = buildContactLedger({
      payments: [],
      planSpans: [],
      creditGrants: [
        grant({ id: 'g_manual', createdAtMs: D(5), source: 'manual', paymentRef: null }),
        // Bought outside the window: there is no payment row to ride on, so the
        // grant must still appear — otherwise a pack the member is actively
        // spending would vanish from the period it was spent in.
        grant({ id: 'g_old', createdAtMs: D(7), paymentRef: 'pi_december' }),
      ],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['credit_granted', 'credit_granted'])
  })

  it('a joined grant still expires on its own row', () => {
    const g = grant({
      id: 'g1',
      createdAtMs: D(3),
      paymentRef: 'pi_pack',
      expiresAtMs: D(20),
      creditsUsed: 4,
    })
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_pack', atMs: D(3) })],
      planSpans: [],
      creditGrants: [g],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['credit_expired', 'payment'])
  })

  it('does not expire a grant whose expiry is still in the future', () => {
    const r = buildContactLedger({
      payments: [],
      planSpans: [],
      creditGrants: [grant({ id: 'g1', createdAtMs: D(3), expiresAtMs: D(90) })],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['credit_granted'])
  })

  // ── opening state ─────────────────────────────────────────────────────────

  it('reports a plan that started before the window as opening state, not as a row', () => {
    // The defect this exists to prevent: a 30-day window over a two-year
    // membership has zero plan events, so without openingState the page shows
    // payments against an apparently plan-less contact.
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_1', atMs: D(10) })],
      planSpans: [span({ id: 's1', startMs: Date.UTC(2024, 5, 1), endMs: null })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment'])
    assert.deepEqual(r.openingState.plans, [
      { planName: 'Unlimited', typeId: 'st_unlimited', sinceMs: Date.UTC(2024, 5, 1) },
    ])
  })

  it('a span that started before the window and ends inside it does both', () => {
    const r = buildContactLedger({
      payments: [],
      planSpans: [
        span({
          id: 's1',
          startMs: D(-40),
          endMs: D(12),
          terminationReason: 'cancellation_requested',
        }),
      ],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['plan_ended'])
    const row = r.rows[0]
    assert.ok(row.kind === 'plan_ended')
    assert.equal(row.reason, 'cancellation_requested')
    assert.equal(r.openingState.plans.length, 1, 'they held it when the window opened')
  })

  it('a span that ended BEFORE the window appears nowhere', () => {
    const r = buildContactLedger({
      payments: [],
      planSpans: [span({ id: 's1', startMs: D(-90), endMs: D(-30) })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(r.rows, [])
    assert.deepEqual(r.openingState.plans, [])
  })

  it('an OPEN span never emits plan_ended', () => {
    const r = buildContactLedger({
      payments: [],
      planSpans: [span({ id: 's1', startMs: D(5), endMs: null })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['plan_started'])
    assert.deepEqual(r.openingState.plans, [])
  })

  it('fromMs: null puts everything in rows and nothing in openingState', () => {
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_1', atMs: D(-400) })],
      planSpans: [span({ id: 's1', startMs: D(-500), endMs: D(-450) })],
      creditGrants: [grant({ id: 'g1', createdAtMs: D(-480) })],
      fromMs: null,
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment', 'plan_ended', 'credit_granted', 'plan_started'])
    assert.deepEqual(r.openingState.plans, [], 'all time = every event is already a row')
  })

  // ── totals ────────────────────────────────────────────────────────────────

  it('totals PER CURRENCY — two currencies are never summed', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'a', atMs: D(3), currency: 'CHF', amountMinor: 5000 }),
        pay({ paymentId: 'b', atMs: D(4), currency: 'CHF', amountMinor: 2500 }),
        pay({ paymentId: 'c', atMs: D(5), currency: 'EUR', amountMinor: 9900 }),
      ],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(r.totals, [
      { currency: 'CHF', grossMinor: 7500, refundedMinor: 0, netMinor: 7500, count: 2 },
      { currency: 'EUR', grossMinor: 9900, refundedMinor: 0, netMinor: 9900, count: 1 },
    ])
  })

  it('buckets a currency case-insensitively rather than splitting it in two', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'a', atMs: D(3), currency: 'chf' }),
        pay({ paymentId: 'b', atMs: D(4), currency: 'CHF' }),
      ],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.equal(r.totals.length, 1)
    assert.equal(r.totals[0].currency, 'CHF')
    assert.equal(r.totals[0].count, 2)
  })

  it('excludes voided rows and subtracts refunds', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'a', atMs: D(3), amountMinor: 5000, refundedMinor: 1500 }),
        pay({ paymentId: 'b', atMs: D(4), amountMinor: 9999, voided: true }),
      ],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(r.totals, [
      { currency: 'CHF', grossMinor: 5000, refundedMinor: 1500, netMinor: 3500, count: 1 },
    ])
  })

  it('counts only payments inside the window', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'before', atMs: D(-1) }),
        pay({ paymentId: 'edge_from', atMs: D(1) }),
        pay({ paymentId: 'edge_to', atMs: D(31) }),
        pay({ paymentId: 'after', atMs: D(32) }),
      ],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.equal(r.totals[0].count, 2, 'both ends of the window are inclusive')
    assert.deepEqual(
      r.rows.map((x) => (x.kind === 'payment' ? x.payment.paymentId : x.kind)),
      ['edge_to', 'edge_from']
    )
  })

  // ── the incompleteness signal ─────────────────────────────────────────────

  it('attributedTypesWithoutSpan fires when no span covers the payment date', () => {
    const r = buildContactLedger({
      payments: [
        pay({
          paymentId: 'pi_1',
          atMs: D(10),
          attribution: 'line_item',
          planTypeId: 'st_kids',
          planName: 'Kids',
        }),
      ],
      planSpans: [span({ id: 's1', startMs: D(2), endMs: D(28), typeId: 'st_unlimited' })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(r.flags.attributedTypesWithoutSpan, ['st_kids'])
    assert.equal(r.flags.hasUnattributed, false)
  })

  it('…and stays empty when a span of that type covers the date', () => {
    const covering = span({ id: 's1', startMs: D(2), endMs: D(28), typeId: 'st_kids' })
    const base = {
      payments: [
        pay({ paymentId: 'pi_1', atMs: D(10), attribution: 'legacy_field', planTypeId: 'st_kids' }),
      ],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    }
    assert.deepEqual(
      buildContactLedger({ ...base, planSpans: [covering] }).flags.attributedTypesWithoutSpan,
      []
    )
    // An OPEN span of the right type covers everything after its start.
    assert.deepEqual(
      buildContactLedger({
        ...base,
        planSpans: [span({ id: 's1', startMs: D(2), endMs: null, typeId: 'st_kids' })],
      }).flags.attributedTypesWithoutSpan,
      []
    )
    // A span of the right type that had already ended does NOT cover it.
    assert.deepEqual(
      buildContactLedger({
        ...base,
        planSpans: [span({ id: 's1', startMs: D(2), endMs: D(6), typeId: 'st_kids' })],
      }).flags.attributedTypesWithoutSpan,
      ['st_kids']
    )
  })

  it('reports each missing type once, sorted', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'a', atMs: D(3), attribution: 'line_item', planTypeId: 'st_z' }),
        pay({ paymentId: 'b', atMs: D(4), attribution: 'line_item', planTypeId: 'st_a' }),
        pay({ paymentId: 'c', atMs: D(5), attribution: 'line_item', planTypeId: 'st_z' }),
      ],
      planSpans: [],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(r.flags.attributedTypesWithoutSpan, ['st_a', 'st_z'])
  })

  // ── ordering + defensiveness ──────────────────────────────────────────────

  it('returns rows newest-first from unsorted input', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'mid', atMs: D(10) }),
        pay({ paymentId: 'new', atMs: D(20) }),
        pay({ paymentId: 'old', atMs: D(2) }),
      ],
      planSpans: [span({ id: 's1', startMs: D(15) })],
      creditGrants: [grant({ id: 'g1', createdAtMs: D(5) })],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(
      r.rows.map((x) => x.atMs),
      [D(20), D(15), D(10), D(5), D(2)]
    )
  })

  it('breaks a tie deterministically, payment first', () => {
    const r = buildContactLedger({
      payments: [pay({ paymentId: 'pi_1', atMs: D(10) })],
      planSpans: [span({ id: 's1', startMs: D(10) })],
      creditGrants: [grant({ id: 'g1', createdAtMs: D(10) })],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment', 'plan_started', 'credit_granted'])
    // Same inputs in a different order must give the same list.
    const shuffled = buildContactLedger({
      payments: [pay({ paymentId: 'pi_1', atMs: D(10) })],
      creditGrants: [grant({ id: 'g1', createdAtMs: D(10) })],
      planSpans: [span({ id: 's1', startMs: D(10) })],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(shuffled.rows), kinds(r.rows))
  })

  it('drops a row that cannot be dated rather than sorting it to epoch 0', () => {
    const r = buildContactLedger({
      payments: [
        pay({ paymentId: 'ok', atMs: D(10) }),
        pay({ paymentId: 'undated', atMs: Number.NaN }),
      ],
      planSpans: [span({ id: 's1', startMs: Number.NaN })],
      creditGrants: [],
      fromMs: D(1),
      toMs: D(31),
    })
    assert.deepEqual(kinds(r.rows), ['payment'])
    assert.equal(r.totals[0].count, 1)
  })

  it('never touches credit BALANCE — it passes the pack counters through unchanged', () => {
    // Spends are a bare counter with no timeline, so "how many did they have on
    // the 10th" is not reconstructible and is not attempted. The grant rides on
    // the row exactly as supplied.
    const g = grant({ id: 'g1', createdAtMs: D(4), creditsTotal: 10, creditsUsed: 7 })
    const r = buildContactLedger({
      payments: [],
      planSpans: [],
      creditGrants: [g],
      fromMs: D(1),
      toMs: D(31),
    })
    const row = r.rows[0]
    assert.ok(row.kind === 'credit_granted')
    assert.equal(row.grant, g)
  })
})
