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
import { normalizeBenefit, type Benefit, type BenefitEffect } from '../types/benefit'
// The promo's own vocabulary is declared beside the promo type, exactly as
// `Benefit` is declared in types/benefit.ts. Type-only: nothing from
// types/promoCode.ts runs here, so this file stays a pure function of its
// arguments.
import type { PromoEffect, PromoModifier } from '../types/promoCode'
import { MIN_CHARGE_MAJOR, round2Major } from './money'

/** Either benefit shape — every read normalizes via `normalizeBenefit`. */
export type AnyBenefit = ActivityMemberBenefit | Benefit

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
  /** Usage-limited types: remaining bookings in the CURRENT window per
   *  subscription-type id (see SubscriptionType.limits + usageWindowKey).
   *  Absent key = unlimited. 0 = allowance spent — the type stops covering
   *  class bookings until the window resets (credits, drop-in and member rates
   *  still apply; appointments/courses are NOT window-limited in v1). */
  usageRemaining?: Record<string, number>
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
  /** Member rate on the drop-in price — price-modifying effects only
   *  (percent_off / fixed_price); included/spend_credits are the accessRule's
   *  job on classes and are ignored here. */
  benefit?: AnyBenefit | null
}

export interface AppointmentTarget {
  kind: 'appointment'
  duration: ActivityDuration
  benefit?: AnyBenefit | null
}

export interface CourseTarget {
  kind: 'course'
  accessRule: CourseAccessRule
  /** Subscriber benefit on the purchase price. When present it WINS over the
   *  legacy accessRule.subscriptionTypeIds free-inclusion list. spend_credits
   *  is not supported for courses (no grant+spend story) and is ignored. */
  benefit?: AnyBenefit | null
}

export interface ProductTarget {
  /** createProductCheckout's view of one merchandise line. Until Wave 3 Phase 3
   *  this rail priced itself (resolveProductPrice → requireChargeableAmountFromMajor)
   *  and never entered the resolver at all — the one genuine one-resolver gap,
   *  and the reason a promo on merchandise could not exist. */
  kind: 'product'
  /** The effective price for the chosen product + variant — resolveProductPrice's
   *  output (types/product.ts). Major units, team currency. */
  priceAmount: number
  /** Threaded for uniformity; ALWAYS null today — `Product` carries no benefit
   *  field. Kept so the arm needs no reshaping if one is ever added, and so the
   *  product rail goes through the SAME comparator as every other rail. */
  benefit?: AnyBenefit | null
}

export type PaymentTarget =
  | ClassBookingTarget
  | DropInTarget
  | AppointmentTarget
  | CourseTarget
  | ProductTarget

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
  | {
      type: 'covered'
      via: CoverageVia
      /** For usage-limited subscription coverage: bookings left in the current
       *  window AFTER this one (e.g. 3/week, none used → remaining: 2). */
      remaining?: number
    }
  | { type: 'spend_credits'; via: { subscriptionTypeId: string }; remaining: number }
  | {
      type: 'pay'
      /** MAJOR units (config currency) — convert at the money core only. */
      amount: number
      source: 'base' | 'drop_in' | 'trial' | 'course_price' | 'product'
      /** WHICH MEMBERSHIP priced this. Read downstream — createAppointmentCheckout
       *  stamps `subscription_type_id` from it and /offer/pricing renders the
       *  member badge from it — which is why a benefit set exactly AT base still
       *  stamps this (it did price the booking). Never present together with
       *  `appliedPromo`: at most one modifier ever prices the option. */
      appliedBenefit?: {
        subscriptionTypeId: string
        effect: Extract<BenefitEffect, 'percent_off' | 'fixed_price'>
        baseAmount: number
      } | null
      /** DID A CODE CHANGE THE PRICE — an event, not provenance, which is why a
       *  promo only stamps this when it is STRICTLY lower than the incumbent.
       *  Omitted when absent (the same convention `appliedBenefit` follows). */
      appliedPromo?: {
        code: string
        effect: PromoEffect
        /** The list price the discount was taken from. */
        baseAmount: number
        /** The benefit that WOULD have priced this had the code not beaten it.
         *  Without it, every running campaign would blank the studio's own
         *  subscription attribution for exactly the members who used the code:
         *  `subscription_type_id` falls back to
         *  `appliedBenefit?.subscriptionTypeId ?? appliedPromo?.supersededBenefit?.subscriptionTypeId ?? null`. */
        supersededBenefit?: { subscriptionTypeId: string; effect: BenefitEffect } | null
      } | null
    }

/** Why there is NO option — exactly extends BookingAccessDenialReason. */
export type PaymentDenial =
  | 'guest'
  | 'not_joined'
  | 'no_subscription'
  | 'no_credits'
  | 'limit_reached'
  | 'sign_in_required'
  | 'trial_used'

/**
 * What happened to the code the visitor typed. This is the ONLY channel that can
 * say *why a valid code did nothing*, which is why it exists alongside
 * `pay.appliedPromo`: that field rides the option to the checkout and the price
 * display, this one carries the explanation.
 *
 * `status === 'applied'` ⟺ exactly one option carries `appliedPromo` — the two
 * are written from ONE decision inside the resolver, never re-derived.
 */
export type PromoOutcome =
  | { code: string; status: 'applied' }
  /** A member benefit — or the plain list price — was as good or better. `by`
   *  says WHICH, because "your member price is already lower than this code"
   *  and "this code does not lower this price" are different sentences and the
   *  client must not have to guess from two numbers. */
  | { code: string; status: 'superseded'; by: 'benefit' | 'base' }
  /** The caller pays nothing anyway (covered / spend_credits). PREVIEW-ONLY in
   *  practice: every checkout callable refuses a covered caller before the pay
   *  option is read, so a checkout never sees this. */
  | { code: string; status: 'not_needed' }
  /** This arm takes no promo (class_booking, the trial door), or there is no pay
   *  option at all (a denial), or the modifier is malformed. The purchase is
   *  never blocked by this — a code that does not apply is REPORTED, and the
   *  purchase completes at list price. */
  | { code: string; status: 'not_applicable' }

/**
 * Runtime inputs that are neither a property of the CALLER (the snapshot) nor
 * configuration authored on the TARGET — today just the promo code the visitor
 * typed.
 *
 * Deliberately a third parameter rather than a snapshot or target field: a
 * snapshot is built once and reused across many targets (resolveAppointmentCells
 * calls the resolver once per duration with one snapshot), so a promo there
 * would silently apply to every cell; and `benefit` lives on the target because
 * it is authored on that entity, which a typed code is not.
 */
export interface PaymentContext {
  /** ALREADY QUALIFIED by the impure loader: it exists, is active, is inside its
   *  window, is in scope for this target, is this caller's, and (fixed_price)
   *  matches the charge currency. The resolver decides exactly one thing about
   *  it — whether it beats the member benefit and the list price. */
  promo?: PromoModifier | null
}

export interface PaymentOptionsResult {
  /** Preference order: covered > spend_credits > pay. Empty ⇒ denial is set. */
  options: PaymentOption[]
  denial: PaymentDenial | null
  /** Present IFF `context.promo` was supplied — which is what keeps every
   *  promo-free fixture byte-identical under `assert.deepEqual`. */
  promo?: PromoOutcome
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
  const windowRemaining = (id: string): number | null => {
    const r = snapshot.usageRemaining?.[id]
    return typeof r === 'number' ? r : null // null = unlimited
  }
  // 1) Unmetered coverage first — never burns credits. A usage-limited type
  //    only covers while its window allowance isn't spent.
  const unmetered = allowed.find((id) => {
    if (!snapshot.heldUnmeteredTypeIds.includes(id)) return false
    const r = windowRemaining(id)
    return r === null || r > 0
  })
  if (unmetered) {
    const r = windowRemaining(unmetered)
    return {
      options: [
        {
          type: 'covered',
          via: { reason: 'subscription', subscriptionTypeId: unmetered },
          // Remaining AFTER this booking, for "2 of 3 left" displays.
          ...(r !== null ? { remaining: r - 1 } : {}),
        },
      ],
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
  // 3) Denied — a held limited type with a spent window → limit_reached;
  //    attached to an allowed credit type with nothing usable left →
  //    no_credits; otherwise no_subscription.
  const limitSpent = allowed.some(
    (id) => snapshot.heldUnmeteredTypeIds.includes(id) && windowRemaining(id) === 0
  )
  if (limitSpent) return { options: [], denial: 'limit_reached' }
  const attached = allowed.some(
    (id) => attachedToCreditType(snapshot, id) || snapshot.heldUnmeteredTypeIds.includes(id)
  )
  return { options: [], denial: attached ? 'no_credits' : 'no_subscription' }
}

/** The price sources a MODIFIER can reach. 'trial' is absent on purpose: the
 *  trial door is already an acquisition price and takes neither a benefit nor a
 *  promo (one predicate, one place). */
type PriceSource = 'base' | 'drop_in' | 'course_price' | 'product'

/** The `BenefitEffect` members that MODIFY a price, which is the subset a promo
 *  and a member benefit have in common. Narrowed from `BenefitEffect` rather
 *  than typed out, so widening that union (an `amount_off`, say) surfaces here
 *  as a compile error in `priceAfterModifier`'s exhaustive handling instead of
 *  silently going unpriced. The coverage members (`included`, `spend_credits`)
 *  are excluded because they answer a different question than "what does it
 *  cost". The effect's PARAMETERS are not part of this type — `percent` and
 *  `amount` are separate arguments to `priceAfterModifier`, because the two
 *  callers hold them on differently-shaped documents. */
type PriceEffect = Extract<BenefitEffect, 'percent_off' | 'fixed_price'>

/**
 * Apply ONE price-modifying effect to a base price. THE clamp-and-round site:
 * every modifier in the system goes through here, so the 0.50 floor and the
 * two-decimal rounding policy exist exactly once (utils/money.ts states the
 * rule — authored prices THROW, arithmetic-derived prices CLAMP UP).
 *
 * Returns `null` for a MALFORMED effect — a missing / non-positive / non-finite
 * percent, or a non-finite amount. Malformed means NOT APPLIED, never "applied
 * as zero": a typo must cost the studio nothing.
 */
function priceAfterModifier(
  base: number,
  effect: PriceEffect,
  percent?: number,
  amount?: number
): number | null {
  if (effect === 'percent_off') {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) return null
    // >= 100 clamps to the floor rather than going free. A promo can never
    // author this (percent is capped at 99 at creation); it survives as the
    // backstop for legacy and hand-written benefit data.
    if (percent >= 100) return MIN_CHARGE_MAJOR
    return Math.max(MIN_CHARGE_MAJOR, round2Major((base * (100 - percent)) / 100))
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  return Math.max(MIN_CHARGE_MAJOR, amount)
}

/** What a benefit resolves to BEFORE any price comparison: a coverage answer
 *  (which short-circuits — there is no price to compare), a price candidate
 *  already known not to raise the price, or nothing at all. */
type BenefitResolution =
  | { kind: 'coverage'; result: PaymentOptionsResult }
  | { kind: 'price'; via: string; effect: PriceEffect; price: number }
  | null

/**
 * Resolve the (normalized) benefit against the caller. `allowed` scopes which
 * effects the context supports — unsupported effects, unheld types and
 * malformed values all resolve to "no candidate", and the base price stands.
 */
function resolveBenefitCandidate(
  snapshot: ContactPaymentSnapshot,
  rawBenefit: AnyBenefit | null | undefined,
  base: number,
  allowed: ReadonlySet<BenefitEffect>
): BenefitResolution {
  const benefit = normalizeBenefit(rawBenefit)
  if (!benefit || !allowed.has(benefit.effect)) return null

  // Held (in benefit-config order): unmetered subscription OR usable credits.
  const via =
    benefit.subscriptionTypeIds.find(
      (id) => snapshot.heldUnmeteredTypeIds.includes(id) || creditRemaining(snapshot, id) > 0
    ) ?? null
  if (!via) return null

  switch (benefit.effect) {
    case 'included': {
      if (snapshot.heldUnmeteredTypeIds.includes(via)) {
        return {
          kind: 'coverage',
          result: {
            options: [
              { type: 'covered', via: { reason: 'benefit_included', subscriptionTypeId: via } },
            ],
            denial: null,
          },
        }
      }
      // Held only via a credit pack — included means "spend one credit"…
      // but ONLY in contexts that can actually spend one (appointments).
      // Courses have no credit-spend story, so a pack-held 'included' benefit
      // falls back to the base price there instead of emitting an
      // unfulfillable spend_credits option.
      if (!allowed.has('spend_credits')) return null
      return {
        kind: 'coverage',
        result: {
          options: [
            {
              type: 'spend_credits',
              via: { subscriptionTypeId: via },
              remaining: creditRemaining(snapshot, via),
            },
          ],
          denial: null,
        },
      }
    }
    case 'spend_credits': {
      // Explicit credit spend: only a listed pack WITH balance applies.
      const creditVia = benefit.subscriptionTypeIds.find((id) => creditRemaining(snapshot, id) > 0)
      if (!creditVia) return null
      return {
        kind: 'coverage',
        result: {
          options: [
            {
              type: 'spend_credits',
              via: { subscriptionTypeId: creditVia },
              remaining: creditRemaining(snapshot, creditVia),
            },
          ],
          denial: null,
        },
      }
    }
    case 'percent_off':
    case 'fixed_price': {
      const price = priceAfterModifier(base, benefit.effect, benefit.percent, benefit.amount)
      if (price === null) return null // malformed → not applied
      // A MODIFIER NEVER RAISES A PRICE. A `fixed_price` benefit above base used
      // to charge the MEMBER more than the guest pays and stamp appliedBenefit
      // on it, rendering the list price struck through above a HIGHER figure —
      // authorable today, since the benefit editor validates only `>= 0.50` and
      // never cross-checks the target's price.
      //
      // The comparison is `<=`, not `<`, and that is deliberate: a benefit set
      // exactly AT base (a live, ordinary placeholder configuration) still
      // priced the booking, and dropping its stamp would silently blank the
      // member badge and `subscription_type_id` on existing data.
      if (price > base) return null
      return { kind: 'price', via, effect: benefit.effect, price }
    }
  }
}

/**
 * BEST-ONE-WINS — the ONE comparator, evaluated base → benefit → promo against
 * a single base price. Never stacked: at most one of `appliedBenefit` /
 * `appliedPromo` ever prices the option.
 *
 * THE COMPARISON IS DELIBERATELY ASYMMETRIC, and the reason is what each field
 * answers:
 *  • a BENEFIT applies (and stamps `appliedBenefit`) whenever it does not RAISE
 *    the price — `benefitPrice <= base` — because `appliedBenefit` answers
 *    "which membership priced this booking", and one set at base did price it;
 *  • a PROMO applies (and stamps `appliedPromo`) only when STRICTLY LOWER than
 *    the incumbent — because `appliedPromo` answers "did a code change the
 *    price", and a code that changed nothing did not.
 *
 * Consequences, so nobody has to rediscover them: a promo exactly equal to the
 * member price loses, and the member is never told their membership stopped
 * mattering; a `fixed_price` promo at or above list never applies, so no
 * struck-through price is ever identical to the charged one.
 *
 * When a promo beats an applicable benefit, that benefit rides out on
 * `appliedPromo.supersededBenefit` so provenance survives the campaign.
 */
function applyModifiers(
  snapshot: ContactPaymentSnapshot,
  rawBenefit: AnyBenefit | null | undefined,
  base: number,
  source: PriceSource,
  allowed: ReadonlySet<BenefitEffect>,
  promo: PromoModifier | null
): PaymentOptionsResult {
  const resolved = resolveBenefitCandidate(snapshot, rawBenefit, base, allowed)
  // Coverage beats every promo — there is no price to discount. The caller
  // reports `not_needed` from the option shape rather than re-deciding here.
  if (resolved?.kind === 'coverage') return resolved.result

  // The incumbent starts at the LIST price and is only ever lowered, which is
  // what makes "a resolved price never exceeds base" true by construction.
  let amount = base
  let appliedBenefit: Extract<PaymentOption, { type: 'pay' }>['appliedBenefit'] = null
  if (resolved) {
    amount = resolved.price
    appliedBenefit = { subscriptionTypeId: resolved.via, effect: resolved.effect, baseAmount: base }
  }

  let outcome: PromoOutcome | null = null
  let appliedPromo: Extract<PaymentOption, { type: 'pay' }>['appliedPromo'] = null
  if (promo) {
    // The effect set is a runtime guard on data the loader read from Firestore;
    // the compile-time type already excludes the coverage effects.
    const promoPrice = PROMO_EFFECTS.has(promo.effect)
      ? priceAfterModifier(base, promo.effect, promo.percent, promo.amount)
      : null
    if (promoPrice === null) {
      outcome = { code: promo.code, status: 'not_applicable' }
    } else if (promoPrice < amount) {
      appliedPromo = {
        code: promo.code,
        effect: promo.effect,
        baseAmount: base,
        ...(appliedBenefit
          ? {
              supersededBenefit: {
                subscriptionTypeId: appliedBenefit.subscriptionTypeId,
                effect: appliedBenefit.effect,
              },
            }
          : {}),
      }
      amount = promoPrice
      appliedBenefit = null
      outcome = { code: promo.code, status: 'applied' }
    } else {
      outcome = { code: promo.code, status: 'superseded', by: appliedBenefit ? 'benefit' : 'base' }
    }
  }

  return {
    options: [
      {
        type: 'pay',
        amount,
        source,
        // Omitted when absent — the convention that keeps every fixture
        // byte-identical under assert.deepEqual.
        ...(appliedBenefit ? { appliedBenefit } : {}),
        ...(appliedPromo ? { appliedPromo } : {}),
      },
    ],
    denial: null,
    ...(outcome ? { promo: outcome } : {}),
  }
}

const APPOINTMENT_EFFECTS: ReadonlySet<BenefitEffect> = new Set([
  'included',
  'spend_credits',
  'percent_off',
  'fixed_price',
])
// Classes: coverage (free/credits) is the accessRule's job — the drop-in
// benefit is a MEMBER RATE, price-modifying effects only.
const DROP_IN_EFFECTS: ReadonlySet<BenefitEffect> = new Set(['percent_off', 'fixed_price'])
// Courses: no grant+spend story in the webhook → no spend_credits.
const COURSE_EFFECTS: ReadonlySet<BenefitEffect> = new Set([
  'included',
  'percent_off',
  'fixed_price',
])
// Products: merchandise is never covered and never denied — excluding the two
// coverage effects is what makes that structural rather than a rule to
// remember. `Product` carries no benefit today, so this set is forward-looking.
const PRODUCT_EFFECTS: ReadonlySet<BenefitEffect> = new Set(['percent_off', 'fixed_price'])
// A promo reuses the price-modifying HALF of the Benefit vocabulary and adds no
// effect of its own: a promo that made a purchase free would need a
// payment-less confirm path on every rail and would bypass the 0.50 floor.
const PROMO_EFFECTS: ReadonlySet<BenefitEffect> = new Set(['percent_off', 'fixed_price'])
// Arms that can produce a `pay` option a promo could modify. `class_booking` is
// absent, which is load-bearing beyond tidiness: it guarantees a promo can never
// reach the arm whose denial is cast unchecked to BookingAccessDenialReason in
// functions/booking/access.ts.
const PROMO_TARGETS: ReadonlySet<PaymentTarget['kind']> = new Set([
  'drop_in',
  'appointment',
  'course',
  'product',
])

// ─── The resolver ───────────────────────────────────────────────────────────────

/**
 * The ONE coverage/quote resolver.
 *
 * `context` is optional, which is the whole reason this signature change touched
 * no existing call site: every caller that does not pass a promo gets a result
 * with no `promo` key at all.
 */
export function resolvePaymentOptions(
  snapshot: ContactPaymentSnapshot,
  target: PaymentTarget,
  context?: PaymentContext
): PaymentOptionsResult {
  const promo = context?.promo ?? null
  if (!promo) return resolveTarget(snapshot, target, null)

  const takesPromo = PROMO_TARGETS.has(target.kind)
  const result = resolveTarget(snapshot, target, takesPromo ? promo : null)
  // The arm decided (it reached the comparator) — one decision, two projections.
  if (result.promo) return result

  // It did not, so there was no price to modify: either the caller pays nothing
  // (coverage — nothing to discount) or there is no pay option this code could
  // ever have touched (a denial, the trial door, class_booking).
  const free = takesPromo && result.options.some((o) => o.type === 'covered' || o.type === 'spend_credits')
  const outcome: PromoOutcome = free
    ? { code: promo.code, status: 'not_needed' }
    : { code: promo.code, status: 'not_applicable' }
  return { ...result, promo: outcome }
}

function resolveTarget(
  snapshot: ContactPaymentSnapshot,
  target: PaymentTarget,
  promo: PromoModifier | null
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
          // No modifier of ANY kind reaches the trial door — this branch returns
          // its pay option directly and never enters `applyModifiers`, so
          // neither a benefit nor a promo is ever compared against it. A paid
          // trial is already an acquisition
          // price, enforced once per person via trial_used_at; stacking a code
          // on it double-discounts the cheapest thing in the product. The promo
          // is reported `not_applicable` by the caller.
          return {
            options: [{ type: 'pay', amount: trialPrice, source: 'trial' }],
            denial: null,
          }
        }
        return { options: [], denial: coverage.denial ?? 'no_subscription' }
      }

      if (target.dropIn?.enabled && typeof target.dropIn.priceAmount === 'number') {
        // Member rate: a held benefit type discounts the drop-in price.
        return applyModifiers(
          snapshot,
          target.benefit,
          target.dropIn.priceAmount,
          'drop_in',
          DROP_IN_EFFECTS,
          promo
        )
      }
      // No pay path configured — surface the underlying coverage denial.
      return { options: [], denial: coverage.denial ?? 'no_subscription' }
    }

    case 'appointment': {
      // THE PRICE IS THE GATE — guests always get an answer, never a denial.
      // Exact port of the old resolveEffectiveAppointmentPrice rules (see the
      // appointment parity fixtures), generalized through `applyModifiers`.
      const base = target.duration.priceAmount
      if (typeof base !== 'number') {
        return { options: [{ type: 'covered', via: { reason: 'unpriced' } }], denial: null }
      }
      return applyModifiers(snapshot, target.benefit, base, 'base', APPOINTMENT_EFFECTS, promo)
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
      const benefit = normalizeBenefit(target.benefit)
      if (!benefit && included) {
        // Legacy free-inclusion list (accessRule.subscriptionTypeIds) — only
        // consulted when no explicit benefit is configured; benefit wins.
        return {
          options: [
            { type: 'covered', via: { reason: 'subscription', subscriptionTypeId: included } },
          ],
          denial: null,
        }
      }
      if (typeof rule.priceAmount === 'number') {
        return applyModifiers(
          snapshot,
          benefit,
          rule.priceAmount,
          'course_price',
          COURSE_EFFECTS,
          promo
        )
      }
      // Purchase tier without a price — misconfig; nothing to offer.
      return {
        options: [],
        denial: snapshot.authenticated ? 'no_subscription' : 'sign_in_required',
      }
    }

    case 'product': {
      // NEVER COVERS AND NEVER DENIES: there is no free product tier and no
      // product access gate, and PRODUCT_EFFECTS excludes the two coverage
      // effects, so this arm is structurally incapable of returning anything
      // but exactly one `pay` option. It is also snapshot-INVARIANT today
      // (`Product` carries no benefit), which is why createProductCheckout can
      // resolve without loading contact facts — if `Product` ever gains a
      // benefit, that call site must start passing a real snapshot, and the
      // "ignores the snapshot" fixture is what will fail first.
      return applyModifiers(
        snapshot,
        target.benefit,
        target.priceAmount,
        'product',
        PRODUCT_EFFECTS,
        promo
      )
    }
  }
}
