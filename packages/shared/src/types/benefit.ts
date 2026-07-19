// The GENERALIZED member benefit — how holding one thing (a subscription type)
// changes the price of another (an appointment duration, a class drop-in, a
// course). Promoted from the appointment-only `ActivityMemberBenefit`
// (2026-07): one rule per target entity, four effects. Benefits are DATA,
// never implied; absent = everyone pays base.
//
// Where benefits attach (Phase C scope): on the target entity itself —
// `Activity.memberBenefit` (appointments: every priced duration; classes: the
// DROP-IN price) and `Course.benefit` (the purchase price). A future
// EligibilitySet direction (one named audience shared by many targets) is
// deliberately out of scope — see the pricing design study.
//
// Effect semantics (enforced in resolvePaymentOptions, the ONE resolver):
//  • 'included'      → holders consume free (a credit-pack holder spends a
//                      credit instead). Appointments + courses; ignored for
//                      class drop-ins (coverage is the accessRule's job there).
//  • 'spend_credits' → consuming costs one credit of a held listed pack.
//                      Appointments only for now (class coverage already spends
//                      credits via the accessRule; courses have no grant+spend
//                      story in the webhook).
//  • 'percent_off'   → `percent` (1–99) off the base price, clamped to the
//                      0.50 floor, never free-via-discount. Malformed percent
//                      (missing/≤0) falls back to base WITHOUT the benefit;
//                      ≥100 clamps to the floor.
//  • 'fixed_price'   → holders pay `amount` (major units), clamped to the
//                      0.50 floor. Malformed amount falls back to base.

import type { ActivityMemberBenefit } from './activity'

export type BenefitEffect = 'included' | 'spend_credits' | 'percent_off' | 'fixed_price'

export interface Benefit {
  /** Holders of ANY of these subscription types get the effect; the FIRST held
   *  id in this (config) order resolves deterministically. */
  subscriptionTypeIds: string[]
  effect: BenefitEffect
  /** percent_off only: 1–99. */
  percent?: number
  /** fixed_price only: major units, team currency (≥ 0.50). */
  amount?: number
}

/**
 * Accept both the legacy appointment shape `{kind, discountPercent}` and the
 * generalized one — the single normalization point every reader goes through
 * (same spirit as resolveActivityAccessRule). Returns null for absent/empty.
 */
export function normalizeBenefit(
  raw: ActivityMemberBenefit | Benefit | null | undefined
): Benefit | null {
  if (!raw || !Array.isArray(raw.subscriptionTypeIds)) return null
  if ('effect' in raw && typeof raw.effect === 'string') {
    return raw as Benefit
  }
  const legacy = raw as ActivityMemberBenefit
  if (legacy.kind === 'included') {
    return { subscriptionTypeIds: legacy.subscriptionTypeIds, effect: 'included' }
  }
  if (legacy.kind === 'discount') {
    return {
      subscriptionTypeIds: legacy.subscriptionTypeIds,
      effect: 'percent_off',
      percent: legacy.discountPercent,
    }
  }
  return null
}
