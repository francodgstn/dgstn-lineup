// ─── THE ACTIVITY ↔ PLAN EDGE ────────────────────────────────────────────────
//
// "Premium includes Yoga Basics" is a relationship, and it is stored on the
// ACTIVITY — the SubscriptionType document holds nothing about activities. It
// was nonetheless authored from two places (the activity form's access tier +
// benefit editor, and "Activities this subscription unlocks" on the plan side),
// each carrying its own copy of where to write.
//
// This is that write, once. BOTH directions call `activityPlanEdgeUpdate` with
// the same arguments, so "editing the edge from the plan produces the same
// document as editing it from the activity" holds BY CONSTRUCTION rather than by
// two implementations agreeing — which is the property the catalogue page exists
// to offer, and the one that quietly stopped holding before (UX-69: the plan
// side read only `accessRule`, so every appointment benefit looked unlinked, and
// an unlinked-looking tick gets wiped on the next save).
//
// ── THE EDGE HAS TWO FACETS, AND THEY ARE INDEPENDENT ────────────────────────
//
//   ACCESS — may a holder of this plan book it at all?  `accessRule`
//   RATE   — what does a holder pay?                    `memberBenefit`
//
// A class can carry BOTH: gated to Premium AND giving Premium a drop-in rate.
// Collapsing them into one "linked" boolean cannot express that, and quietly
// picks one of the two to write.
//
// An appointment has **no access facet at all** — the price is the gate — so
// `access` is meaningless there and is ignored rather than stored. That is why
// this returns a payload instead of the caller assembling fields: the difference
// between the kinds is a fact about where the edge lives, not a UI choice, and
// it belongs on this side of the boundary.
//
// ── THE RATE IS ONE RULE PER ACTIVITY, SHARED BY EVERY PLAN ON IT ────────────
//
// There is no per-pair payload: `memberBenefit` carries ONE effect for the whole
// id list (the per-pair `subscriptionPricing` matrix was deliberately cut in
// 2026-07 — see the note on `Activity`). So changing the rate "for Premium"
// changes it for every plan on that rule. This module cannot soften that; it is
// a property of the storage. What it CAN do is refuse to guess — see the
// `choice` parameter — and name who else is affected, which is what
// `plansSharingRate` is for.

import type { Activity } from '../types/activity'
import { resolveActivityAccessRule } from '../types/activity'
import type { Benefit, BenefitEffect } from '../types/benefit'
import { normalizeBenefit } from '../types/benefit'
// The effect sets the RESOLVER honours — the editor offers exactly these.
import { APPOINTMENT_EFFECTS, COURSE_EFFECTS, DROP_IN_EFFECTS } from './paymentOptions'

/** The fields the edge is read from and written to — narrow on purpose, so a
 *  caller can pass a form's partial state or a Firestore snapshot alike.
 *  `dropIn` / `durations` are not written by the edge: they are read to answer
 *  whether a member rate would have any price to reduce (`rateHasAPriceToApplyTo`). */
export type ActivityEdgeFields = Pick<
  Activity,
  'type' | 'accessRule' | 'isFreeTrial' | 'memberBenefit' | 'dropIn' | 'durations'
>

/** One (activity, plan) pair, as two independent facts. */
export interface ActivityPlanEdge {
  /** On the activity's access gate. CLASS ONLY — always false for an
   *  appointment, which has no gate. */
  access: boolean
  /** On the activity's member-rate rule. */
  rate: boolean
}

/** The rate itself, WITHOUT the id list — the ids come from the edge, never
 *  passed in, so the two cannot disagree. */
export interface ActivityRateChoice {
  effect: BenefitEffect
  /** percent_off only: 1–99. */
  percent?: number | null
  /** fixed_price only: major units (>= 0.50). */
  amount?: number | null
}

export function isAppointmentActivity(a: Pick<Activity, 'type'>): boolean {
  return a.type === 'appointment'
}

/** Plans on the activity's ACCESS gate. Empty for an appointment, and for a
 *  class that is open or members-only. */
export function gatedPlanIds(a: ActivityEdgeFields): string[] {
  if (isAppointmentActivity(a)) return []
  const rule = resolveActivityAccessRule(a)
  return rule.type === 'subscription' ? (rule.subscriptionTypeIds ?? []) : []
}

/** Plans on the activity's RATE rule, for either kind. Goes through
 *  `normalizeBenefit`, so a rule stored in the legacy appointment shape is not
 *  mistaken for no rule — reading past it is the bug that made a saved benefit
 *  look unlinked, and an unlinked-looking tick gets wiped on the next save. */
export function ratedPlanIds(a: Pick<Activity, 'memberBenefit'>): string[] {
  return normalizeBenefit(a.memberBenefit)?.subscriptionTypeIds ?? []
}

/** How one plan stands against one activity right now. */
export function activityPlanEdge(a: ActivityEdgeFields, subTypeId: string): ActivityPlanEdge {
  return {
    access: gatedPlanIds(a).includes(subTypeId),
    rate: ratedPlanIds(a).includes(subTypeId),
  }
}

/** The rate an activity's rule carries today, or the default for a fresh one:
 *  'included' — right for a credit pack, where a booking spends a credit. */
export function activityRateChoiceOf(a: Pick<Activity, 'memberBenefit'>): ActivityRateChoice {
  const n = normalizeBenefit(a.memberBenefit)
  if (!n) return { effect: 'included' }
  return {
    // `spend_credits` is a resolver effect no editor offers; show it as the
    // closest thing a studio can pick rather than dropping the rule on the floor.
    effect: n.effect === 'spend_credits' ? 'included' : n.effect,
    percent: n.percent ?? null,
    amount: n.amount ?? null,
  }
}

/** Builds the stored rule, or null to CLEAR it — an empty id list means NO rule,
 *  not an empty one. */
function buildRate(ids: string[], choice: ActivityRateChoice): Benefit | null {
  if (ids.length === 0) return null
  return {
    subscriptionTypeIds: ids,
    effect: choice.effect,
    ...(choice.effect === 'percent_off' && choice.percent != null
      ? { percent: Number(choice.percent) }
      : {}),
    ...(choice.effect === 'fixed_price' && choice.amount != null
      ? { amount: Number(choice.amount) }
      : {}),
  }
}

function sameRate(a: Benefit | null, b: Benefit | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.effect === b.effect &&
    (a.percent ?? null) === (b.percent ?? null) &&
    (a.amount ?? null) === (b.amount ?? null) &&
    a.subscriptionTypeIds.length === b.subscriptionTypeIds.length &&
    a.subscriptionTypeIds.every((id, i) => id === b.subscriptionTypeIds[i])
  )
}

/**
 * The ONE edge write. Returns the Firestore update payload, or **null when
 * nothing would change** — so a caller skips the document rather than writing an
 * identical one. That is not merely a saving: an identical class write would
 * stamp `isFreeTrial: false` onto an activity nobody asked to change.
 *
 * `fresh` must be the document as READ INSIDE THE TRANSACTION, not the copy the
 * form was hydrated from: both id lists are recomputed from it, so two studios
 * ticking different plans on the same activity merge instead of clobbering.
 *
 * @param subTypeId the plan on the other end of the edge
 * @param next      what the two facets should be afterwards
 * @param choice    the rate to store. Read ONLY when `next.rate` is true — when
 *                  a plan comes OFF the rule the effect on `fresh` is kept for
 *                  whoever remains, because a draft left behind in a row whose
 *                  controls were hidden must not be written onto the others.
 */
export function activityPlanEdgeUpdate(
  fresh: ActivityEdgeFields,
  subTypeId: string,
  next: ActivityPlanEdge,
  choice?: ActivityRateChoice
): Record<string, unknown> | null {
  const now = activityPlanEdge(fresh, subTypeId)
  const update: Record<string, unknown> = {}

  // ── the RATE facet, on both kinds ──
  const rateIds = ratedPlanIds(fresh)
  const nextRateIds = next.rate
    ? rateIds.includes(subTypeId)
      ? rateIds
      : [...rateIds, subTypeId]
    : rateIds.filter((id) => id !== subTypeId)
  const nextRate = buildRate(
    nextRateIds,
    next.rate ? (choice ?? activityRateChoiceOf(fresh)) : activityRateChoiceOf(fresh)
  )
  if (!sameRate(normalizeBenefit(fresh.memberBenefit), nextRate)) {
    update.memberBenefit = nextRate
  }

  // ── the ACCESS facet, classes only ──
  if (!isAppointmentActivity(fresh) && next.access !== now.access) {
    const gateIds = gatedPlanIds(fresh)
    const nextGateIds = next.access
      ? [...gateIds, subTypeId]
      : gateIds.filter((id) => id !== subTypeId)
    update.accessRule = nextGateIds.length
      ? { type: 'subscription', subscriptionTypeIds: nextGateIds }
      : // Emptying the allow-list falls back to `members`, never `open`: the
        // studio said this is not for the public, and dropping the last plan is
        // not them changing their mind about that.
        { type: 'members' }
    update.isFreeTrial = false
  }

  return Object.keys(update).length ? update : null
}

/**
 * Every plan that shares an activity's rate rule, minus the one being edited.
 *
 * The catalogue needs this BEFORE a change lands, not after: the rate is one
 * rule for the whole list, so setting "20% off" from Premium reprices Basic and
 * Gold too, and a warning that names them is the only thing standing between the
 * studio and doing that unknowingly. Returns ids; the caller resolves names.
 */
export function plansSharingRate(a: Pick<Activity, 'memberBenefit'>, subTypeId: string): string[] {
  return ratedPlanIds(a).filter((id) => id !== subTypeId)
}

// ─── COURSES ─────────────────────────────────────────────────────────────────
//
// A course carries THE SAME TWO FACETS AS A CLASS, in different fields: a GATE
// (`accessRule.subscriptionTypeIds` — the plans that get it free) and a RATE
// (`benefit` — one price rule for the plans that get it cheaper). Both are live
// on both plan-bearing tiers, and they are ADDITIVE: free wins where a plan is
// on both lists.
//
//   free         neither. It is free to everyone; there is nothing to gate.
//   registered   neither. Any signed-in contact opens it.
//   subscription both, but the rate is INERT until there is a price — exactly a
//                class that sells no drop-in yet. `rateHasAPriceToApplyTo` says
//                so, and the editor dims it and explains.
//   purchase     both, both live.
//
// HISTORY, because the shape used to be the opposite of this one. Until
// 2026-09-01 the gate and the rate were mutually exclusive per tier, and the
// resolver enforced it with `if (!benefit && included)` — a benefit made the
// gate list INVISIBLE. `firestore.rules` had always ORed the two instead, so
// "Premium free, Elite 20% off" would have let Premium READ the course while
// the shop quoted them full price. The editor hid the contradiction by never
// offering both controls at once; making the resolver additive is what fixes
// it, and per-plan rates on a course are what falls out (Franco, 2026-09-01).
//
// THE LEGACY SPELLING. A `benefit` with effect `included` is the OLD way to say
// "these plans get it free", and both rule files still honour it. It is read
// here as part of the GATE, and the first edge write ABSORBS it into
// `accessRule.subscriptionTypeIds` and clears it — so there is one canonical
// home going forward and no backfill to deploy.

import type { Course, CourseAccessRule } from '../types/course'

export type CourseEdgeFields = Pick<Course, 'accessRule' | 'benefit'>

/** Which facets an offering can actually carry. The UI renders a control only
 *  where this says the field is honoured. */
export interface OfferingFacets {
  access: boolean
  rate: boolean
}

export function activityPlanFacets(
  a: Pick<Activity, 'type'> & Partial<Pick<Activity, 'accessRule' | 'isFreeTrial'>>
): OfferingFacets {
  // An appointment has no gate — the price is the gate.
  if (isAppointmentActivity(a)) return { access: false, rate: true }

  // AN OPEN CLASS HAS NEITHER, and this is the one place it can be said once.
  //
  // Read off `resolvePaymentOptions`, not assumed: its drop_in arm calls
  // `resolveClassCoverage` FIRST and an open class comes back covered, so the
  // arm returns before `applyModifiers` is ever reached. Nobody pays for an
  // open class, which makes a member rate on it a discount on nothing.
  //
  // The gate is worse than dead — it is a trap. Ticking "Included" on an open
  // class writes `{type:'subscription', subscriptionTypeIds:[…]}`, silently
  // NARROWING a class from everyone to one plan. Widening is a decision for the
  // activity's own "Who can book", not a side effect of linking a plan
  // (Franco, 2026-09-01).
  return resolveActivityAccessRule(a).type === 'open'
    ? { access: false, rate: false }
    : { access: true, rate: true }
}

export function coursePlanFacets(c: { accessRule?: CourseAccessRule | null }): OfferingFacets {
  // Both, or neither. A course no plan can open or discount is one that is
  // already open to everybody.
  const bearsPlans = c.accessRule?.type === 'subscription' || c.accessRule?.type === 'purchase'
  return { access: bearsPlans, rate: bearsPlans }
}

/**
 * The ids on a `benefit` that mean "free" rather than "cheaper" — the legacy
 * spelling of the gate. `spend_credits` is here because the resolver treats it
 * as coverage too, and no course editor has ever offered it.
 */
function legacyIncludedIds(c: Pick<Course, 'benefit'>): string[] {
  const n = normalizeBenefit(c.benefit)
  if (!n) return []
  return n.effect === 'included' || n.effect === 'spend_credits' ? n.subscriptionTypeIds : []
}

/** Plans that get a course FREE — the gate, plus its legacy spelling. */
export function courseGatedPlanIds(c: CourseEdgeFields): string[] {
  if (!coursePlanFacets(c).access) return []
  const gate = c.accessRule?.subscriptionTypeIds ?? []
  const legacy = legacyIncludedIds(c)
  return legacy.length ? [...new Set([...gate, ...legacy])] : gate
}

/** Plans that get a course CHEAPER. A benefit meaning "free" is the gate, so it
 *  is deliberately not counted here — it would otherwise show as both. */
export function courseRatedPlanIds(c: Pick<Course, 'benefit'>): string[] {
  const n = normalizeBenefit(c.benefit)
  if (!n || n.effect === 'included' || n.effect === 'spend_credits') return []
  return n.subscriptionTypeIds
}

export function coursePlanEdge(c: CourseEdgeFields, subTypeId: string): ActivityPlanEdge {
  return {
    access: courseGatedPlanIds(c).includes(subTypeId),
    rate: courseRatedPlanIds(c).includes(subTypeId),
  }
}

/** The price rule a course carries today, or the default for a fresh one.
 *  `percent_off`, NOT the `included` an activity defaults to: on a course
 *  "included" is the GATE column, and offering it in both places is what the
 *  two overlapping tiers used to do. */
export function courseRateChoiceOf(c: Pick<Course, 'benefit'>): ActivityRateChoice {
  const n = normalizeBenefit(c.benefit)
  if (!n || n.effect === 'included' || n.effect === 'spend_credits') {
    return { effect: 'percent_off' }
  }
  return { effect: n.effect, percent: n.percent ?? null, amount: n.amount ?? null }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * The course half of the ONE edge write. Same contract as
 * `activityPlanEdgeUpdate`: the fresh document read INSIDE the transaction, and
 * null when nothing would change.
 *
 * Both facets are computed every time — a course, unlike an appointment, has no
 * tier where one of them is unwritable, so the caller can always have offered
 * both controls. A tier that bears no plans at all writes nothing.
 */
export function coursePlanEdgeUpdate(
  fresh: CourseEdgeFields,
  subTypeId: string,
  next: ActivityPlanEdge,
  choice?: ActivityRateChoice
): Record<string, unknown> | null {
  if (!coursePlanFacets(fresh).access) return null
  const update: Record<string, unknown> = {}

  const gateIds = courseGatedPlanIds(fresh)
  const rateIds = courseRatedPlanIds(fresh)

  const nextGateIds = next.access
    ? gateIds.includes(subTypeId)
      ? gateIds
      : [...gateIds, subTypeId]
    : gateIds.filter((id) => id !== subTypeId)
  const nextRateIds = next.rate
    ? rateIds.includes(subTypeId)
      ? rateIds
      : [...rateIds, subTypeId]
    : rateIds.filter((id) => id !== subTypeId)

  const nextRate = buildRate(
    nextRateIds,
    next.rate ? (choice ?? courseRateChoiceOf(fresh)) : courseRateChoiceOf(fresh)
  )
  // A legacy `included` benefit has just been read as part of the GATE, so
  // leaving it in place would count its plans twice. Writing the (price-only)
  // rate here clears it — the absorption, and the only migration there is.
  const legacyAbsorbed = legacyIncludedIds(fresh).length > 0
  if (legacyAbsorbed || !sameRate(normalizeBenefit(fresh.benefit), nextRate)) {
    update.benefit = nextRate
  }

  // Compared against what is STORED, not against the union read above, so that
  // absorbing the legacy list registers as a change and gets written.
  if (!sameIds(nextGateIds, fresh.accessRule?.subscriptionTypeIds ?? [])) {
    // The tier is NOT changed here. Emptying a course's gate leaves the tier as
    // it was with nobody on it, which the pricing health check reports — the
    // same shape as a class with an empty allow-list. Silently demoting it to
    // 'registered' would hand a paid course to every signed-in contact, which is
    // not what removing one plan asked for.
    update.accessRule = { ...fresh.accessRule, subscriptionTypeIds: nextGateIds }
  }

  return Object.keys(update).length ? update : null
}

/** Every plan that shares a course's rate rule, minus the one being edited. */
export function plansSharingCourseRate(c: Pick<Course, 'benefit'>, subTypeId: string): string[] {
  return courseRatedPlanIds(c).filter((id) => id !== subTypeId)
}

// ─── ONE ENTRY POINT FOR BOTH KINDS ──────────────────────────────────────────
//
// The catalogue lists activities and courses side by side, and every row does
// the same thing to a different document. Dispatching here rather than in the
// component keeps that decision on the tested side of the boundary — and means
// a third kind is added in this file, not in a `switch` inside some JSX.
//
// PRODUCTS AND GIFT CARDS ARE NOT MEMBERS, and not by oversight. A plan can only
// open or discount something that has a gate or a benefit to write to. `Product`
// has neither (`resolvePaymentOptions`' product arm threads `benefit` purely for
// uniformity and documents it as "ALWAYS null today"), and a gift card is a
// TENDER — it pays for things, so there is nothing for a plan to unlock. A row
// for either would show controls that write nowhere.

export type PlanLinkTarget =
  | { kind: 'activity'; doc: ActivityEdgeFields }
  | { kind: 'course'; doc: CourseEdgeFields }

export function offeringFacets(t: PlanLinkTarget): OfferingFacets {
  return t.kind === 'activity' ? activityPlanFacets(t.doc) : coursePlanFacets(t.doc)
}

export function offeringPlanEdge(t: PlanLinkTarget, subTypeId: string): ActivityPlanEdge {
  return t.kind === 'activity'
    ? activityPlanEdge(t.doc, subTypeId)
    : coursePlanEdge(t.doc, subTypeId)
}

export function offeringRateChoiceOf(t: PlanLinkTarget): ActivityRateChoice {
  return t.kind === 'activity' ? activityRateChoiceOf(t.doc) : courseRateChoiceOf(t.doc)
}

/**
 * The rate effects an editor may OFFER for this offering — derived from the very
 * sets `resolvePaymentOptions` honours, so the two cannot drift.
 *
 * THE CASE THIS EXISTS FOR: a CLASS. Its rate rule is applied to the DROP-IN
 * price and price-modifying effects are the only ones the resolver reads there,
 * because being covered is what the ACCESS facet already says. An editor with
 * its own list offered `included` anyway, which made the two controls on a class
 * row look like two ways to say "free" — and the second one silently did
 * nothing. An appointment is the mirror image: it has no access facet at all
 * (the price is the gate), so `included` there is the ONLY way to say a holder
 * books free, and it must stay on offer.
 *
 * `spend_credits` is filtered out for every kind: the resolver honours it on an
 * appointment, but no editor writes it and the UI story for it does not exist
 * yet (see BenefitEditor's module doc). Offering it here would ship a control
 * ahead of the feature.
 */
/**
 * Is there a price here for a member RATE to reduce?
 *
 * A rate is a discount on something, and on two of the three kinds that
 * something can simply be absent:
 *
 *   • a CLASS discounts its DROP-IN price — a members-only class that sells no
 *     drop-in has no other price, so "20% off" reduces nothing;
 *   • an APPOINTMENT discounts its priced durations — one with no price is
 *     already free to everyone;
 *   • a PURCHASE-tier course always has a price; that is what the tier means.
 *
 * `included` is exempt and never asks this: making something free does not need
 * a price to start from. This answers only for the price-modifying effects, and
 * the editor uses it to MUTE them rather than to hide them — the studio should
 * see that the option exists and why it cannot bite yet.
 */
export function rateHasAPriceToApplyTo(t: PlanLinkTarget): boolean {
  // A course's price IS its sale, so an unsold course has nothing to reduce —
  // the same inert-until-priced state a class with no drop-in is in, and shown
  // the same way (dimmed, with a reason) rather than withheld.
  if (t.kind === 'course') {
    const r = t.doc.accessRule
    return r?.type === 'purchase' && typeof r.priceAmount === 'number' && r.priceAmount > 0
  }
  if (isAppointmentActivity(t.doc)) {
    return (t.doc.durations ?? []).some((d) => (d.priceAmount ?? 0) > 0)
  }
  const dropIn = t.doc.dropIn
  return !!dropIn?.enabled && (dropIn.priceAmount ?? 0) > 0
}

export type OfferableRateEffect = 'included' | 'percent_off' | 'fixed_price'

export function offeringRateEffects(t: PlanLinkTarget): OfferableRateEffect[] {
  const allowed =
    t.kind === 'course'
      ? COURSE_EFFECTS
      : isAppointmentActivity(t.doc as Pick<Activity, 'type'>)
        ? APPOINTMENT_EFFECTS
        : DROP_IN_EFFECTS
  // A fixed order, so the chips do not reshuffle between offerings.
  return (['included', 'percent_off', 'fixed_price'] as const).filter((e) => allowed.has(e))
}

export function plansSharingOfferingRate(t: PlanLinkTarget, subTypeId: string): string[] {
  return t.kind === 'activity'
    ? plansSharingRate(t.doc, subTypeId)
    : plansSharingCourseRate(t.doc, subTypeId)
}

export function offeringPlanEdgeUpdate(
  t: PlanLinkTarget,
  subTypeId: string,
  next: ActivityPlanEdge,
  choice?: ActivityRateChoice
): Record<string, unknown> | null {
  return t.kind === 'activity'
    ? activityPlanEdgeUpdate(t.doc, subTypeId, next, choice)
    : coursePlanEdgeUpdate(t.doc, subTypeId, next, choice)
}
