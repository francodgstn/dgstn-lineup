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

/** The fields the edge is read from and written to — narrow on purpose, so a
 *  caller can pass a form's partial state or a Firestore snapshot alike. */
export type ActivityEdgeFields = Pick<
  Activity,
  'type' | 'accessRule' | 'isFreeTrial' | 'memberBenefit'
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
