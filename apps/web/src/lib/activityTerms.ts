// Pure, no-JSX resolver for an activity's public "commercial terms" — the money
// (and access) chips shown on activity cards across every surface that lists
// them: the admin activities manager, the public booking flow, the public
// website/embeds, and the shop's "pay per visit" strip. ONE place computes
// WHICH chips apply; each surface renders them with its own styling/labels
// (label copy differs slightly per surface — see each surface's i18n
// namespace) via its own i18n namespace.
//
// Design rule (locked with the user): terms chips live on the activity card,
// on every surface where activity cards appear. Prices are NEVER purchasable
// in the shop — payment always happens in the booking flows; the chips are
// information + routing only.
//
// Input is a structural subset shared by `Activity` (admin, full doc) and
// `ActivityPublicProfile` (public mirrors) — both shapes satisfy it, so
// callers can pass either without adapting field names.

import { resolveActivityAccessRule, type ActivityAccessRule, type ActivityMemberBenefit } from '@linyup/shared'

export type ActivityTermKind =
  | 'trial'
  | 'dropIn'
  | 'gate'
  | 'price'
  | 'benefitIncluded'
  | 'benefitDiscount'

export interface ActivityTerm {
  kind: ActivityTermKind
  /** dropIn only — the flat per-class price. */
  amount?: number
  /** price only (appointments) — lowest priced duration. Equal to `max` when
   *  every priced duration shares the same price. */
  min?: number
  /** price only (appointments) — highest priced duration. */
  max?: number
  /** benefitDiscount only — 1-99. */
  percent?: number
  /** gate only — which access tier is gating the class. Both tiers resolve to
   *  the SAME 'gate' kind (surfaces decide how much to differentiate). */
  tier?: 'members' | 'subscription'
  /** benefitIncluded / benefitDiscount only — the subscription types that
   *  grant the benefit, so a surface with the plan list loaded (admin, shop)
   *  may resolve names ("Included · Premium"). Surfaces without that context
   *  (the public website) use a generic label instead. */
  subscriptionTypeIds?: string[]
}

/** Structural subset of `Activity` / `ActivityPublicProfile` this resolves
 *  from — loose so both the admin form/list and every public mirror shape
 *  satisfy it without adapting field names. */
export interface ActivityTermsInput {
  /** Defaults to 'class' when absent, matching `Activity.type`'s own default. */
  type?: 'class' | 'appointment' | string
  /** CLASS-ONLY. Legacy trial flag — combines with `accessRule`/`trialEnabled`;
   *  see `resolveActivityAccessRule`. */
  isFreeTrial?: boolean
  /** CLASS-ONLY. Independent of the access tier — a gated class may still
   *  take a newcomer's trial booking. */
  trialEnabled?: boolean
  /** CLASS-ONLY. Ignored for appointments (money is the only gate there). */
  accessRule?: ActivityAccessRule | null
  /** CLASS-ONLY. */
  dropIn?: { enabled?: boolean; priceAmount?: number | null } | null
  /** APPOINTMENT-ONLY. */
  durations?: Array<{ minutes: number; priceAmount?: number | null }> | null
  /** APPOINTMENT-ONLY. */
  memberBenefit?: ActivityMemberBenefit | null
}

/** Resolves the structured list of commercial/access terms for one activity.
 *  Order is stable: gate, trial, drop-in for classes; price, benefit for
 *  appointments — surfaces may render a subset (e.g. the admin list and the
 *  booking flow already have their own gate/trial badges and only want the
 *  money kinds from here). */
export function resolveActivityTerms(a: ActivityTermsInput): ActivityTerm[] {
  const terms: ActivityTerm[] = []

  if (a.type === 'appointment') {
    const priced = (a.durations ?? [])
      .map((d) => d.priceAmount)
      .filter((p): p is number => typeof p === 'number')
    if (priced.length > 0) {
      terms.push({ kind: 'price', min: Math.min(...priced), max: Math.max(...priced) })
    }

    const benefit = a.memberBenefit
    const benefitTypeIds = benefit?.subscriptionTypeIds ?? []
    if (benefit && benefitTypeIds.length > 0) {
      if (benefit.kind === 'included') {
        terms.push({ kind: 'benefitIncluded', subscriptionTypeIds: benefitTypeIds })
      } else if (benefit.kind === 'discount' && typeof benefit.discountPercent === 'number') {
        terms.push({ kind: 'benefitDiscount', percent: benefit.discountPercent, subscriptionTypeIds: benefitTypeIds })
      }
    }

    return terms
  }

  // class (default when `type` is absent/'class')
  const rule = resolveActivityAccessRule(a)
  if (rule.type === 'members' || rule.type === 'subscription') {
    terms.push({ kind: 'gate', tier: rule.type })
  }
  const triable = (rule.type === 'open' && a.isFreeTrial === true) || a.trialEnabled === true
  if (triable) {
    terms.push({ kind: 'trial' })
  }
  if (a.dropIn?.enabled && typeof a.dropIn.priceAmount === 'number') {
    terms.push({ kind: 'dropIn', amount: a.dropIn.priceAmount })
  }

  return terms
}
