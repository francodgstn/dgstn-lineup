/* eslint-disable no-console */
// reversePaymentEffects — the inverse of applyPaymentEffects: give back what a
// payment bought, when the money for it goes back.
//
// THE GOVERNING PRINCIPLE, and every decision below follows from it:
//
//     ERR TOWARD UNDER-REVOKING.
//
// A member who keeps something the studio refunded is visible on the contact
// and fixable in one click. A member stripped of something a DIFFERENT payment
// paid for is invisible, arrives as a support ticket, and the studio has no way
// to tell what happened. So every branch that is unsure does nothing and says
// so.
//
// ── Ownership before deletion, always ────────────────────────────────────────
// Two of the three targets are keyed by the CONTACT, not by the payment:
//   • courses/{courseId}/purchases/{contactId} — doc id is the contact
//   • contacts/{contactId}.subscription_* — fields on the contact
// so their existence proves nothing about which payment produced them. Each
// therefore carries an explicit provenance stamp (`payment_ref` /
// `subscription_source_ref`), and this module compares it before touching
// anything. A mismatch is `skipped_not_owner` and writes NOTHING — the normal
// case being a second, later purchase, a manual grant, or a gift-card-funded
// one that no `/payments` row can reach.
//
// The third target — contacts/{contactId}/credit_grants/{paymentRef} — is keyed
// by the PAYMENT: the doc id IS the provenance, which is why the grant is
// reached by doc id and never by a field query. The field names disagreed by
// rail until Step 0 (`payment_ref` vs `payment_intent_id`), so
// `where('payment_ref','==',ref)` silently missed every Connect credit pack.
// Doc id only. Do not reintroduce a query here.
//
// ── Reduce, never delete ─────────────────────────────────────────────────────
// A revoked pack is written by lowering `credits_total` to a TARGET — ABSOLUTE,
// clamped against numbers taken from the transaction's own read set. Never a
// decrement (`FieldValue.increment` on this field is the same second-writer bug
// CLAUDE.md bans on `usage_count` and `bookings_count`), and never a delete (the
// grant is the audit record). This needs ZERO new filters anywhere: every reader
// already derives remaining as `credits_total - credits_used`, or reads the
// `credit_summary` rollup that `buildCreditSummary` computes the same way, so
// the revoked units drop out of all of them on the trigger's next pass.
//
// A PARTIAL REFUND OF A PACK CURRENTLY REFUSES rather than guessing how much of
// it the money bought back — see `reversalPlanFor`. Taking the whole remainder
// back for a token goodwill refund would be exactly the over-revoke this file
// forbids, reported as a clean success.
//
// NAMED CONSEQUENCE, CHOSEN NOT MISSED: pack of 10 with 3 used is reduced to
// total = 3. If the member then cancels one of those three classes,
// `cancelBooking` sets used = 2 (booking/index.ts) and remaining becomes 1 — a
// revoked credit reappears. That is accepted: the class was not delivered and
// was not refunded, so the credit returning is consistent with "delivered value
// is owed", and it errs toward under-revoking. Flooring `credits_used` against
// `credits_revoked` would reintroduce exactly the one filter this design avoids.
//
// ── No create(), so no gRPC-6 idiom ──────────────────────────────────────────
// "How do I make this transaction idempotent?" is the question that invites
// CLAUDE.md's recorded trap — copying `recordFinanceTransaction`'s
// `.create()` + catch-code-6 idiom into a transaction, where a collision fails
// the WHOLE commit. The answer here is that the question does not arise: this
// reversal contains NO `create()` calls at all. Idempotency is structural,
// keyed by (paymentRef, contactId) — the credit write is an absolute TARGET
// (re-running with the same inputs writes the same number, and the `min` clamp
// stops a re-run raising it), the course delete is ownership-checked (a second
// run finds it absent), and the subscription clear is ownership-checked (a
// second run finds the ref gone and reports skipped_not_owner). Nothing needs a
// lock.

import { FieldValue } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  COURSES_COLLECTION,
  COURSE_PURCHASES_SUBCOLLECTION,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  proRataMinor,
  type PaymentLineItem,
  type ReversalTargetOutcome,
} from '@linyup/shared'
import type { firestore } from 'firebase-admin'

type Db = firestore.Firestore

// ─── what was bought ─────────────────────────────────────────────────────────

/**
 * The stored `line_item` when the webhook stamped one; otherwise derived from
 * `kind` — legacy Connect rows carry no line item, and treating them as
 * "nothing was bought" would silently skip the reversal on exactly the oldest
 * sales. `kind: 'membership'` maps to line-item kind 'subscription' (the two
 * rails spell it differently; see the unified row builder on the web).
 *
 * Pure, and resolved for EVERY refund — including an unassigned one. Whether a
 * refund may be partial is a property of what was sold, and must not depend on
 * whether a manager has assigned the row yet.
 */
export function lineItemForReversal(
  payment: Record<string, unknown>
): PaymentLineItem | null {
  const stored = payment.line_item as PaymentLineItem | undefined | null
  if (stored?.kind) return stored
  switch (payment.kind as string | undefined) {
    case 'membership':
      // No subscriptionTypeId to recover — and none is needed: the reversal
      // proves ownership from `subscription_source_ref`, not from the type.
      return { kind: 'subscription' }
    case 'course':
      return { kind: 'course', courseId: (payment.courseId as string | undefined) ?? undefined }
    case 'product':
    case 'drop_in':
    case 'appointment':
    case 'gift_card':
      return { kind: payment.kind as PaymentLineItem['kind'] }
    default:
      return null
  }
}

// ─── the plan ────────────────────────────────────────────────────────────────

export type ReversalRefusalReason =
  | 'partial_refund_on_indivisible'
  /** INTERIM — see `reversalPlanFor`. Goes away in one direction or the other
   *  once "is a pack refundable at all" is decided. */
  | 'partial_refund_on_pack'
  | 'full_refund_on_consumed_pack'

/** Everything the dialog needs to offer a defensible alternative, all in the
 *  refusal's `details` — same shape as the two gift-card refusals already
 *  mapped in the payments page, so the UI's reason-switch extends. */
export interface ConsumedPackSuggestion {
  unitsGranted: number
  unitsConsumed: number
  unitsRemaining: number
  /** The suggested refund (Rappen), already clamped to maxRefundableMinor. */
  proRataMinor: number
  /** Ceiling: gross minus what has already been refunded (Rappen). */
  maxRefundableMinor: number
}

export interface ReversalActions {
  subscription: 'clear_if_owned' | 'leave'
  /**
   * `reduce_to.total` is a TARGET `credits_total`, never a delta — which is what
   * keeps a re-run a no-op instead of a second revocation. The executor clamps
   * it against numbers it reads inside its own transaction: never below
   * `credits_used` (a credit spent between the pre-flight read and the commit is
   * a class already booked, and stays), and never above the current
   * `credits_total` (a re-run may not hand revoked credits back).
   */
  credits: { op: 'reduce_to'; total: number } | { op: 'leave' }
  course: 'delete_if_owned' | 'leave'
}

export type ReversalPlan =
  | { refuse: 'partial_refund_on_indivisible' }
  | { refuse: 'partial_refund_on_pack' }
  | { refuse: 'full_refund_on_consumed_pack'; suggestion: ConsumedPackSuggestion }
  | ({ refuse?: undefined } & ReversalActions)

const NOTHING_TO_REVERSE: ReversalPlan = {
  subscription: 'leave',
  credits: { op: 'leave' },
  course: 'leave',
}

/**
 * The consumable a payment granted, when it granted one — today only a
 * lesson-credit pack. Three numbers, all read straight off the grant doc.
 */
export interface DivisibleGrant {
  /** The ORIGINAL pack size (`credits_total + credits_revoked`) — the
   *  denominator the pro-rata suggestion prices against. It must not shrink when
   *  an earlier reversal reduced the grant, or a later refund would price each
   *  survivor above what it was sold for. */
  unitsGranted: number
  /** `credits_used` — units the member has actually taken. Never revoked. */
  unitsConsumed: number
  /** Units still live (`credits_total - credits_used`). */
  unitsRemaining: number
}

export interface ReversalPlanInput {
  /** What was bought. Null (or an unrecognised kind) ⇒ nothing to reverse. */
  lineItem: PaymentLineItem | null
  /**
   * Null means "indivisible or nothing", which is the difference between a
   * refund that may be partial and one that may not.
   */
  divisible: DivisibleGrant | null
  /** Rappen. `undefined` = a FULL refund (everything still refundable). */
  refundAmountMinor?: number
  /** Gross payment amount in Rappen — the base for all pro-rata arithmetic. */
  paymentAmountMinor: number
  /** Already refunded on this charge (Rappen), BEFORE this refund. */
  alreadyRefundedMinor?: number
}

/**
 * Pure. No Firestore, no clock, no money movement — decide what a refund of
 * this payment should take back, or refuse it.
 *
 * DIVISIBILITY, NOT FULLNESS, decides what reverses:
 *
 *   line item                              | full refund          | partial
 *   ---------------------------------------|----------------------|-------------------
 *   subscription, credits (a pack)         | only if 0 consumed   | allowed, reverses
 *   subscription, no credits               | clears if owned      | REFUSED
 *   course                                 | deletes if owned     | REFUSED
 *   product/drop_in/appointment/gift_card  | nothing to reverse   | nothing to reverse
 *
 * A partial refund NEVER clears the subscription fields — only a full one does.
 * Holding a plan is indivisible; a member with 3 consumed credits still holds
 * the pack, and taking the plan away because seven classes were refunded is the
 * over-revoke this whole module exists to avoid.
 *
 * A CREDIT PACK IS REFUNDABLE IN FULL, AND ONLY WHILE UNTOUCHED. Both other
 * cases refuse:
 *
 *   • PARTIAL, any pack (`partial_refund_on_pack`) — INTERIM. How much of a pack
 *     a partial refund takes back has to be a function of the MONEY RETURNED,
 *     and that rule is not built: whether packs stay refundable at all is a live
 *     product question ("a pack is a commitment"). Refusing is correct under
 *     both answers — it is the end state if pack refunds go away, and a safe
 *     placeholder if they stay. What it replaced was not: the branch ignored
 *     `refundAmountMinor` entirely, so a CHF 10 goodwill gesture on a CHF 180
 *     ten-class pack revoked all ten credits and reported a clean success —
 *     exactly the over-revoke this module's header forbids.
 *   • FULL, partly consumed (`full_refund_on_consumed_pack`) — a full refund
 *     would take back classes already delivered.
 *
 * Deleting the partial arm is a small edit; un-shipping a wrong revocation is
 * not. When the product question is answered, ONE of these two refusals goes.
 */
export function reversalPlanFor(input: ReversalPlanInput): ReversalPlan {
  const kind = input.lineItem?.kind ?? null
  const isFullRefund = input.refundAmountMinor === undefined
  const alreadyRefundedMinor = input.alreadyRefundedMinor ?? 0
  const maxRefundableMinor = Math.max(0, input.paymentAmountMinor - alreadyRefundedMinor)

  if (kind === 'subscription') {
    const d = input.divisible
    if (!d || d.unitsGranted <= 0) {
      // A plain membership: indivisible. Half a membership is not a thing.
      if (!isFullRefund) return { refuse: 'partial_refund_on_indivisible' }
      return { subscription: 'clear_if_owned', credits: { op: 'leave' }, course: 'leave' }
    }
    if (!isFullRefund) return { refuse: 'partial_refund_on_pack' }
    if (d.unitsConsumed > 0) {
      return {
        refuse: 'full_refund_on_consumed_pack',
        suggestion: {
          unitsGranted: d.unitsGranted,
          unitsConsumed: d.unitsConsumed,
          unitsRemaining: d.unitsRemaining,
          proRataMinor: Math.min(
            proRataMinor(input.paymentAmountMinor, d.unitsRemaining, d.unitsGranted),
            maxRefundableMinor
          ),
          maxRefundableMinor,
        },
      }
    }
    // Untouched pack, refunded in full: give the money back, take the whole pack
    // back, and the plan snapshot it wrote with it. Target 0 — the executor
    // clamps it up to whatever `credits_used` has become in the meantime.
    return {
      subscription: 'clear_if_owned',
      credits: { op: 'reduce_to', total: 0 },
      course: 'leave',
    }
  }

  if (kind === 'course') {
    if (!isFullRefund) return { refuse: 'partial_refund_on_indivisible' }
    return { subscription: 'leave', credits: { op: 'leave' }, course: 'delete_if_owned' }
  }

  // product | drop_in | appointment | gift_card | other | unlinked.
  //
  // Nothing to reverse — which is NOT the same as "nothing happened". A drop-in
  // or appointment refund leaves the booking standing on purpose: cancelling
  // somebody's class is a scheduling decision with its own notification, not a
  // side effect of a money movement. A gift-card purchase is handled by the
  // refund callable itself (voidUntouchedGiftCard), which is money, not access.
  return NOTHING_TO_REVERSE
}

// ─── the executor ────────────────────────────────────────────────────────────

export interface ReversePaymentEffectsInput {
  teamId: string
  contactId: string
  /** The payment doc id — the ownership token every check compares against. */
  paymentRef: string
  /** Only `courseId` is read; the plan already encodes the decisions. */
  lineItem: PaymentLineItem | null
  plan: ReversalActions
}

export interface ReversalOutcome {
  subscription: ReversalTargetOutcome
  credits: ReversalTargetOutcome
  /** Credits actually taken back (0 when none were). */
  creditsRevoked: number
  course: ReversalTargetOutcome
}

/**
 * Execute a plan in ONE transaction.
 *
 * The read set is BOUNDED AND KNOWABLE BEFORE THE TRANSACTION OPENS: the plan
 * names at most three documents, each addressed by an id computed from
 * (contactId, paymentRef, lineItem.courseId) — never a query, so no read can
 * fan out and the transaction cannot grow with the size of the contact's data.
 * At most 3 reads, at most 3 writes, all reads first.
 *
 * A batch was right here until `credits_used` had to be read in the same atomic
 * unit that writes `credits_total`: a spend landing between that read and that
 * write is exactly how a member loses a class they already booked.
 */
export async function reversePaymentEffects(
  db: Db,
  input: ReversePaymentEffectsInput
): Promise<ReversalOutcome> {
  const { teamId, contactId, paymentRef, plan } = input

  const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
  const grantRef = contactRef
    .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
    .doc(paymentRef)
  /** The plan's target `credits_total`, or null when the plan leaves credits alone. */
  const creditsTarget = plan.credits.op === 'reduce_to' ? plan.credits.total : null
  const courseId = input.lineItem?.kind === 'course' ? (input.lineItem.courseId ?? null) : null
  const purchaseRef =
    plan.course === 'delete_if_owned' && courseId
      ? db
          .collection(COURSES_COLLECTION)
          .doc(courseId)
          .collection(COURSE_PURCHASES_SUBCOLLECTION)
          .doc(contactId)
      : null

  return db.runTransaction(async (tx) => {
    const outcome: ReversalOutcome = {
      subscription: 'left',
      credits: 'left',
      creditsRevoked: 0,
      course: 'left',
    }

    // ── read phase (≤3, all by doc id) ───────────────────────────────────────
    const contactSnap = plan.subscription === 'clear_if_owned' ? await tx.get(contactRef) : null
    const grantSnap = creditsTarget !== null ? await tx.get(grantRef) : null
    const purchaseSnap = purchaseRef ? await tx.get(purchaseRef) : null

    // ── write phase (≤3) ─────────────────────────────────────────────────────
    if (contactSnap) {
      const contact = contactSnap.data()
      if (!contactSnap.exists || !contact) {
        outcome.subscription = 'absent'
      } else if (!contact.subscription_type_id) {
        // Already no subscription on the axis — nothing to clear.
        outcome.subscription = 'absent'
      } else if ((contact.subscription_source_ref ?? null) !== paymentRef) {
        // A LATER payment (or a recurring renewal, which stores null) owns these
        // fields. Clearing them would strip a membership somebody is paying for.
        outcome.subscription = 'skipped_not_owner'
      } else {
        // Deleting rather than nulling: the Contact type declares these optional,
        // and "absent" is how every reader already spells "no subscription".
        // Clearing subscription_type_id also fires onContactSubscriptionChange,
        // which closes the open history row and writes the transition — the
        // audit trail for this comes free, with no code here.
        tx.update(contactRef, {
          subscription_type_id: FieldValue.delete(),
          subscription_type_name: FieldValue.delete(),
          subscription_price_id: FieldValue.delete(),
          subscription_recurrence: FieldValue.delete(),
          subscription_amount: FieldValue.delete(),
          subscription_source_ref: FieldValue.delete(),
          subscription_type_updated_at: FieldValue.serverTimestamp(),
        })
        outcome.subscription = 'cleared'
      }
    }

    if (grantSnap && creditsTarget !== null) {
      const grant = grantSnap.data()
      if (!grantSnap.exists || !grant) {
        outcome.credits = 'absent'
      } else {
        // THE AUTHORITATIVE NUMBERS, and the only reason this is a transaction:
        // read HERE, inside it — not from the plan, which was computed before
        // the money moved.
        const total = (grant.credits_total as number | undefined) ?? 0
        const used = (grant.credits_used as number | undefined) ?? 0
        // The plan's TARGET, clamped by both of them:
        //   • never below `used` — a credit spent between the pre-flight read
        //     and this commit is a class already booked, and it stays hers;
        //   • never above the current `total` — a re-run computing a larger
        //     target may not hand revoked credits back.
        // Both clamps err the same way as everything else here: under-revoking.
        const target = Math.max(used, Math.min(total, creditsTarget))
        const revoked = Math.max(0, total - target)
        if (revoked === 0) {
          // Already at (or past) the target: the pack is exhausted, this refund
          // did not pay for a whole unit, or this reversal already ran.
          // Idempotent no-op — no write at all.
          outcome.credits = 'reduced'
          outcome.creditsRevoked = 0
        } else {
          tx.update(grantRef, {
            // ABSOLUTE, from this transaction's read set. Never an increment.
            credits_total: target,
            // Audit only — nothing reads these for a decision.
            reversed_at: FieldValue.serverTimestamp(),
            reversed_by_payment_ref: paymentRef,
            credits_revoked: ((grant.credits_revoked as number | undefined) ?? 0) + revoked,
          })
          outcome.credits = 'reduced'
          outcome.creditsRevoked = revoked
        }
      }
    }

    if (purchaseRef && purchaseSnap) {
      const purchase = purchaseSnap.data()
      if (!purchaseSnap.exists || !purchase) {
        outcome.course = 'absent'
      } else {
        // Both names, because both are the SAME fact on the Connect rail (Step 0
        // makes grantCourseEntitlement stamp them together) and a match on
        // either is genuine provenance, not a guess. A gift-card-funded grant
        // carries `gift:{code}:{holdKey}` and so matches neither — correctly, no
        // `/payments` refund can reach it.
        const storedRef = (purchase.payment_ref as string | null | undefined) ?? null
        const storedPi = (purchase.paymentIntentId as string | null | undefined) ?? null
        if (storedRef === paymentRef || storedPi === paymentRef) {
          tx.delete(purchaseRef)
          outcome.course = 'deleted'
        } else {
          outcome.course = 'skipped_not_owner'
        }
      }
    } else if (plan.course === 'delete_if_owned') {
      // The plan wanted a deletion but the line item names no course.
      outcome.course = 'absent'
    }

    console.log(
      `[reversal] team=${teamId} contact=${contactId} ref=${paymentRef} ` +
        `subscription=${outcome.subscription} credits=${outcome.credits}` +
        `(${outcome.creditsRevoked}) course=${outcome.course}`
    )
    return outcome
  })
}
