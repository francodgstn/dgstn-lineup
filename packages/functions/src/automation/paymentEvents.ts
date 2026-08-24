// THE money-document → automation-event resolver. Pure: no firebase at runtime, so
// `paymentEvents.test.ts` imports THIS rather than keeping a private copy of it.
//
// ── THE CENSUS: every edge that fires a money trigger ───────────────────────────
// This header is the owner. Add an edge here, never a second list somewhere else.
//
//   payment_received   `status` is 'succeeded' AND `contactId` is set, and one of
//                      those two was missing on the write before.
//   payment_refunded   `amount_refunded` strictly INCREASED, landing in a refunded
//                      status.
//   payment_disputed   `dispute_status` went from absent to present.
//
// Two more money triggers exist and are deliberately NOT here —
// `subscription_payment_failed` and `subscription_cancel_requested`, which
// `automation/onContactWrite.ts` resolves off the CONTACT document. That split is not
// tidiness, it is where the subject is: a failed RECURRING charge writes a
// member_payments row with no `contactId` at all (the invoice-generated PaymentIntent
// carries no metadata, and handleInvoice only resolves the payment link on `paid`), and
// a cancellation writes no payment row whatsoever. A money-seam trigger for either would
// be systematically subject-less for exactly the case it exists to serve. Adding a
// `payment_failed` edge below is therefore a mistake, not a gap.
//
// ── WHAT THIS RESOLVER HAS TO SURVIVE ──────────────────────────────────────────
// One sale writes `teams/{t}/member_payments/{pi}` several times, from two Stripe
// handlers whose order Stripe does not guarantee (connect/webhook.ts documents a 1–4 s
// skew between them), plus a fee mirror, plus per-kind stamps. So NO trigger here may be
// keyed on "the document was written":
//
//   • `contactId` routinely arrives on a LATER write than `status: 'succeeded'` —
//     which is why `payment_received` waits for the subject rather than for the status.
//   • three auto-refund branches stamp `status: 'refunded'` while `amount_refunded` is
//     still 0, and the authoritative charge.refunded write lands afterwards — which is
//     why `payment_refunded` is keyed on the AMOUNT and not on the status transition.
//   • Stripe redelivers events, and every refund write is an ABSOLUTE cumulative figure
//     — so a redelivery re-writes the same number, the amount does not increase, and
//     nothing fires a second time.
//
// ── AND WHAT IT MUST NOT DO ────────────────────────────────────────────────────
// The money facts ride in the `EventDelta`, never in `AutomationContext.payload`.
// `resolveEventDelayMinutes` refuses a delay to ANY run carrying a non-empty payload
// (a blanket rule about persisting caller data in the Cloud Tasks queue), so a payload
// here would silently kill the delay while the rule builder still offered the field.
// `paymentEvents.test.ts` reads onMemberPaymentWrite.ts and pins that.
import type { AutomationTriggerType, EventDelta } from '../utils/automationEngine'

/**
 * How long after a payment is created a LATE-ARRIVING `contactId` still counts as
 * "this payment just happened".
 *
 * The webhook skew this covers is seconds; the window is minutes so a slow redelivery
 * is comfortably inside it. What it keeps OUT is the other way a contactId appears: a
 * manager assigning an unclaimed row by hand through `updatePaymentRecord`, possibly
 * months later. Without the bound, tidying up last quarter's books sends every one of
 * those buyers a thank-you for a purchase they have forgotten making.
 */
export const PAYMENT_SUBJECT_ARRIVAL_WINDOW_MS = 15 * 60 * 1000

/** Statuses in which money has genuinely been given back. */
const REFUNDED_STATUSES = new Set(['refunded', 'partially_refunded'])

export interface PaymentEvent {
  triggerType: AutomationTriggerType
  delta: EventDelta
  /** The contact this event is about. Never empty — an event without one is not emitted. */
  contactId: string
}

type Doc = FirebaseFirestore.DocumentData | undefined

const contactOf = (d: Doc): string | null => (d?.contactId as string | undefined) || null

/** Succeeded AND attributable. Both halves are required, and they arrive out of order. */
const settledWithSubject = (d: Doc): boolean => d?.status === 'succeeded' && !!contactOf(d)

const refundedMinor = (d: Doc): number => {
  const n = d?.amount_refunded as number | undefined
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/**
 * Epoch ms for `created_at`, which may be an admin Timestamp, a plain
 * `{seconds, nanoseconds}` (what the emulator and the seed fixtures produce), or absent.
 * Absent reads as "unknown age" and is treated as NOT recent — the conservative
 * direction, since the only thing the age gates is an extra send.
 */
function createdAtMs(d: Doc): number | null {
  const v = d?.created_at as { toMillis?: () => number; seconds?: number } | undefined
  if (!v) return null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  return null
}

/** The identity + money facts every money event carries, for delta scoping and logging. */
function paymentDelta(after: Doc, paymentIntentId: string): NonNullable<EventDelta['payment']> {
  return {
    paymentIntentId,
    kind: (after?.kind as string | undefined) ?? null,
    amountMinor: (after?.amount as number | undefined) ?? 0,
    currency: (after?.currency as string | undefined) ?? null,
  }
}

/**
 * The ordered money events for one write of a member_payments document.
 *
 * `nowMs` is passed in rather than read, so the arrival window is testable and the
 * resolver stays pure.
 */
export function resolvePaymentEvents(
  before: Doc,
  after: Doc,
  paymentIntentId: string,
  nowMs: number
): PaymentEvent[] {
  if (!after) return [] // deleted — a removed row is not a money event

  const events: PaymentEvent[] = []
  const contactId = contactOf(after)
  // An unassigned payment fires NOTHING. Every action but notify_team/webhook operates
  // on a contact, and firing with no subject would still stamp last_run_at and write an
  // automation_logs row saying "0 matched" — a run history that lies about what happened.
  // The event is deferred, not lost: assigning the row is itself a write, and the
  // arrival branch below picks it up while the payment is still recent.
  if (!contactId) return events

  // ── payment_received ─────────────────────────────────────────────────────────
  if (settledWithSubject(after) && !settledWithSubject(before)) {
    // Which half completed the pair? If the status was ALREADY succeeded, then what
    // just arrived is the contact — and that is the branch a manual assignment also
    // comes through, so it is the branch the age bound applies to.
    const subjectArrived = before?.status === 'succeeded'
    const createdMs = createdAtMs(after)
    const recent = createdMs !== null && nowMs - createdMs <= PAYMENT_SUBJECT_ARRIVAL_WINDOW_MS
    if (!subjectArrived || recent) {
      events.push({
        triggerType: 'payment_received',
        contactId,
        delta: { payment: paymentDelta(after, paymentIntentId) },
      })
    }
  }

  // ── payment_refunded ─────────────────────────────────────────────────────────
  const refundedNow = refundedMinor(after)
  const refundedBefore = refundedMinor(before)
  if (refundedNow > refundedBefore && REFUNDED_STATUSES.has(after.status as string)) {
    events.push({
      triggerType: 'payment_refunded',
      contactId,
      delta: {
        payment: {
          ...paymentDelta(after, paymentIntentId),
          // The amount THIS refund gave back, not the running total — a second partial
          // refund is a second event about its own figure.
          refundAmountMinor: refundedNow - refundedBefore,
          refundIsFull: after.status === 'refunded',
        },
      },
    })
  }

  // ── payment_disputed ─────────────────────────────────────────────────────────
  // handleDispute writes the same field for both the opening and the closing event, so
  // the edge is "a chargeback appeared on this payment" — fired once, on the first write
  // that names one, whichever of the two got here first.
  if (!before?.dispute_status && after.dispute_status) {
    events.push({
      triggerType: 'payment_disputed',
      contactId,
      delta: {
        payment: {
          ...paymentDelta(after, paymentIntentId),
          disputeStatus: after.dispute_status as string,
        },
      },
    })
  }

  return events
}
