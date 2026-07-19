// The ONE coverage/quote resolver — "for this person, consuming this thing,
// what are the payment options?" — shared by every surface: bookSession,
// bookAppointment, the drop-in/appointment/course checkouts, and the web UIs'
// price displays. Pure function of (snapshot, target): no Firestore, no
// firebase imports (it ships to the client bundle).
//
// It subsumes the previously-divergent implementations:
//  • booking/access.ts resolveBookingCoverage (class gate incl. credit spend)
//  • booking/dropIn.ts isContactCovered       (drop-in eligibility — deliberately
//    ALIGNED to bookSession semantics; see P1/P2 notes on the drop_in arm)
//  • resolveEffectiveAppointmentPrice          (appointment pricing + benefit)
//  • the shop/Space course-access checks       (course tiers)
//
// The IMPURE part of the old server logic — classifying a held subscription
// type as unmetered vs credit-metered (a per-type Firestore read) — lives in
// the snapshot LOADER (functions/booking/access.ts loadContactPaymentSnapshot),
// not here. Web builds an optimistic snapshot from the client mirror; the
// server re-resolves authoritatively on every write path.

import type { ActivityAccessRule, ActivityDuration, ActivityMemberBenefit } from '../types/activity'
import type { CourseAccessRule } from '../types/course'
import { MIN_CHARGE_MAJOR } from './money'

// ─── Snapshot — what the resolver may know about the caller ─────────────────────

export interface ContactPaymentSnapshot {
  /** False for guests (no contact session). */
  authenticated: boolean
  /** acquisition_stage === 'joined'. Always false for guests. */
  joined: boolean
  /** Subscription-type ids held via a NON-credit (unmetered) subscription. */
  heldUnmeteredTypeIds: string[]
  /** Credit-metered types the contact is attached to: usable balances
   *  (remaining > 0, unexpired) AND mirror-held credit types whose balance is
   *  exhausted/expired (remaining 0) — the distinction drives no_credits vs
   *  no_subscription denials. */
  heldCreditTypes: Array<{ subscriptionTypeId: string; remaining: number }>
  /** trial_used_at truthy. Only meaningful for authenticated contacts — guests
   *  are checked by the callable's email-resolved lookup instead. */
  trialUsed?: boolean
  /** The contact owns this course (purchase entitlement). Course targets only. */
  ownsCourse?: boolean
}

/** The anonymous-visitor snapshot. */
export const GUEST_SNAPSHOT: ContactPaymentSnapshot = {
  authenticated: false,
  joined: false,
  heldUnmeteredTypeIds: [],
  heldCreditTypes: [],
}

// ─── Target — the thing being consumed ──────────────────────────────────────────

export interface ClassBookingTarget {
  /** bookSession's FREE-path gate view. The trial door (guest booking a gated
   *  trial-enabled class) is handled by the callable BEFORE this — identity
   *  resolution, not pricing. */
  kind: 'class_booking'
  accessRule: ActivityAccessRule
}

export interface DropInTarget {
  /** createDropInCheckout's eligibility + amount view of the same class. */
  kind: 'drop_in'
  accessRule: ActivityAccessRule
  dropIn?: { enabled?: boolean; priceAmount?: number } | null
  trial?: { enabled?: boolean; priceAmount?: number | null } | null
  /** True when the caller asked for the paid-trial door (trial: true). */
  asTrial?: boolean
}

export interface AppointmentTarget {
  kind: 'appointment'
  duration: ActivityDuration
  benefit?: ActivityMemberBenefit | null
}

export interface CourseTarget {
  kind: 'course'
  accessRule: CourseAccessRule
}

export type PaymentTarget = ClassBookingTarget | DropInTarget | AppointmentTarget | CourseTarget

// ─── Result ─────────────────────────────────────────────────────────────────────

export type CoverageVia =
  | { reason: 'open' }
  | { reason: 'members' }
  | { reason: 'unpriced' }
  | { reason: 'free_tier' }
  | { reason: 'registered' }
  | { reason: 'owned' }
  | { reason: 'subscription'; subscriptionTypeId: string }
  | { reason: 'benefit_included'; subscriptionTypeId: string }

export type PaymentOption =
  | { type: 'covered'; via: CoverageVia }
  | { type: 'spend_credits'; via: { subscriptionTypeId: string }; remaining: number }
  | {
      type: 'pay'
      /** MAJOR units (config currency) — convert at the money core only. */
      amount: number
      source: 'base' | 'drop_in' | 'trial' | 'course_price'
      appliedBenefit?: {
        subscriptionTypeId: string
        kind: 'discount'
        baseAmount: number
      } | null
    }

/** Why there is NO option — exactly extends BookingAccessDenialReason. */
export type PaymentDenial =
  | 'guest'
  | 'not_joined'
  | 'no_subscription'
  | 'no_credits'
  | 'sign_in_required'
  | 'trial_used'

export interface PaymentOptionsResult {
  /** Preference order: covered > spend_credits > pay. Empty ⇒ denial is set. */
  options: PaymentOption[]
  denial: PaymentDenial | null
}

// ─── Internals ──────────────────────────────────────────────────────────────────

function creditRemaining(snapshot: ContactPaymentSnapshot, id: string): number {
  const entry = snapshot.heldCreditTypes.find((e) => e.subscriptionTypeId === id)
  return entry ? entry.remaining : 0
}

function attachedToCreditType(snapshot: ContactPaymentSnapshot, id: string): boolean {
  return snapshot.heldCreditTypes.some((e) => e.subscriptionTypeId === id)
}

/** The gate resolution shared by class_booking and drop_in — EXACTLY
 *  resolveBookingCoverage's semantics (unmetered first, then usable credits,
 *  then no_credits vs no_subscription). */
function resolveClassCoverage(
  snapshot: ContactPaymentSnapshot,
  accessRule: ActivityAccessRule
): PaymentOptionsResult {
  if (accessRule.type === 'open') {
    return { options: [{ type: 'covered', via: { reason: 'open' } }], denial: null }
  }
  if (!snapshot.authenticated) return { options: [], denial: 'guest' }
  if (!snapshot.joined) return { options: [], denial: 'not_joined' }
  if (accessRule.type === 'members') {
    return { options: [{ type: 'covered', via: { reason: 'members' } }], denial: null }
  }

  const allowed = accessRule.subscriptionTypeIds ?? []
  // 1) Unmetered coverage first — never burns credits.
  const unmetered = allowed.find((id) => snapshot.heldUnmeteredTypeIds.includes(id))
  if (unmetered) {
    return {
      options: [{ type: 'covered', via: { reason: 'subscription', subscriptionTypeId: unmetered } }],
      denial: null,
    }
  }
  // 2) Credit coverage — the caller spends one credit atomically at booking.
  const creditType = allowed.find((id) => creditRemaining(snapshot, id) > 0)
  if (creditType) {
    return {
      options: [
        {
          type: 'spend_credits',
          via: { subscriptionTypeId: creditType },
          remaining: creditRemaining(snapshot, creditType),
        },
      ],
      denial: null,
    }
  }
  // 3) Denied — attached to an allowed credit type with nothing usable left →
  //    no_credits; otherwise no_subscription.
  const attached = allowed.some(
    (id) => attachedToCreditType(snapshot, id) || snapshot.heldUnmeteredTypeIds.includes(id)
  )
  return { options: [], denial: attached ? 'no_credits' : 'no_subscription' }
}

// ─── The resolver ───────────────────────────────────────────────────────────────

export function resolvePaymentOptions(
  snapshot: ContactPaymentSnapshot,
  target: PaymentTarget
): PaymentOptionsResult {
  switch (target.kind) {
    case 'class_booking':
      return resolveClassCoverage(snapshot, target.accessRule)

    case 'drop_in': {
      // Coverage refusal FIRST — someone who can already book free (including
      // via a usable credit: P1) must not be sold a drop-in. An exhausted
      // credit-pack holder is NOT covered (P2) and falls through to pay —
      // fixing the historical deadlock where bookSession denied no_credits
      // while the old isContactCovered ALSO refused the drop-in.
      const coverage = resolveClassCoverage(snapshot, target.accessRule)
      if (coverage.options.length > 0) return coverage

      if (target.asTrial) {
        if (snapshot.trialUsed) return { options: [], denial: 'trial_used' }
        const trialPrice = target.trial?.priceAmount
        if (target.trial?.enabled && typeof trialPrice === 'number') {
          return {
            options: [{ type: 'pay', amount: trialPrice, source: 'trial' }],
            denial: null,
          }
        }
        return { options: [], denial: coverage.denial ?? 'no_subscription' }
      }

      if (target.dropIn?.enabled && typeof target.dropIn.priceAmount === 'number') {
        return {
          options: [{ type: 'pay', amount: target.dropIn.priceAmount, source: 'drop_in' }],
          denial: null,
        }
      }
      // No pay path configured — surface the underlying coverage denial.
      return { options: [], denial: coverage.denial ?? 'no_subscription' }
    }

    case 'appointment': {
      // THE PRICE IS THE GATE — guests always get an answer, never a denial.
      // Exact port of resolveEffectiveAppointmentPrice + the held-benefit
      // combination (see effectivePrice parity fixtures).
      const base = target.duration.priceAmount
      if (typeof base !== 'number') {
        return { options: [{ type: 'covered', via: { reason: 'unpriced' } }], denial: null }
      }

      const benefit = target.benefit
      const benefitIds = benefit?.subscriptionTypeIds ?? []
      // Held (in benefit-config order): unmetered subscription OR usable credits.
      const via =
        benefitIds.find(
          (id) =>
            snapshot.heldUnmeteredTypeIds.includes(id) || creditRemaining(snapshot, id) > 0
        ) ?? null

      if (!benefit || !via) {
        return { options: [{ type: 'pay', amount: base, source: 'base' }], denial: null }
      }

      if (benefit.kind === 'included') {
        if (snapshot.heldUnmeteredTypeIds.includes(via)) {
          return {
            options: [
              { type: 'covered', via: { reason: 'benefit_included', subscriptionTypeId: via } },
            ],
            denial: null,
          }
        }
        // Held only via a credit pack — included means "spend one credit".
        return {
          options: [
            {
              type: 'spend_credits',
              via: { subscriptionTypeId: via },
              remaining: creditRemaining(snapshot, via),
            },
          ],
          denial: null,
        }
      }

      // kind === 'discount'
      const pct = benefit.discountPercent
      if (typeof pct !== 'number' || pct <= 0) {
        // Malformed → base price, benefit NOT applied (parity: via reported null).
        return { options: [{ type: 'pay', amount: base, source: 'base' }], denial: null }
      }
      const amount =
        pct >= 100
          ? MIN_CHARGE_MAJOR
          : Math.max(MIN_CHARGE_MAJOR, Math.round(((base * (100 - pct)) / 100) * 100) / 100)
      return {
        options: [
          {
            type: 'pay',
            amount,
            source: 'base',
            appliedBenefit: { subscriptionTypeId: via, kind: 'discount', baseAmount: base },
          },
        ],
        denial: null,
      }
    }

    case 'course': {
      const rule = target.accessRule
      if (rule.type === 'free') {
        return { options: [{ type: 'covered', via: { reason: 'free_tier' } }], denial: null }
      }
      if (rule.type === 'registered') {
        return snapshot.authenticated
          ? { options: [{ type: 'covered', via: { reason: 'registered' } }], denial: null }
          : { options: [], denial: 'sign_in_required' }
      }
      // Course coverage uses the HELD UNION (unmetered ∪ credit-attached) — a
      // credit type counts as held but never spends for course access. This
      // deliberately widens the old primary-subscription-only check to
      // multi-subscription holders (P6 — pricing/UI only; Firestore rules keep
      // their own read gate).
      const heldUnion = (id: string) =>
        snapshot.heldUnmeteredTypeIds.includes(id) || attachedToCreditType(snapshot, id)
      const included = (rule.subscriptionTypeIds ?? []).find(heldUnion)

      if (rule.type === 'subscription') {
        if (included) {
          return {
            options: [
              { type: 'covered', via: { reason: 'subscription', subscriptionTypeId: included } },
            ],
            denial: null,
          }
        }
        return {
          options: [],
          denial: snapshot.authenticated ? 'no_subscription' : 'sign_in_required',
        }
      }

      // rule.type === 'purchase'
      if (snapshot.ownsCourse) {
        return { options: [{ type: 'covered', via: { reason: 'owned' } }], denial: null }
      }
      if (included) {
        return {
          options: [
            { type: 'covered', via: { reason: 'subscription', subscriptionTypeId: included } },
          ],
          denial: null,
        }
      }
      if (typeof rule.priceAmount === 'number') {
        return {
          options: [{ type: 'pay', amount: rule.priceAmount, source: 'course_price' }],
          denial: null,
        }
      }
      // Purchase tier without a price — misconfig; nothing to offer.
      return {
        options: [],
        denial: snapshot.authenticated ? 'no_subscription' : 'sign_in_required',
      }
    }
  }
}
