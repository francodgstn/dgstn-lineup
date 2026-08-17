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

import {
  resolveActivityAccessRule,
  normalizeBenefit,
  type ActivityAccessRule,
  type ActivityMemberBenefit,
  type Benefit,
} from '@linyup/shared'

export type ActivityTermKind =
  | 'trial'
  | 'dropIn'
  | 'gate'
  | 'price'
  | 'benefitIncluded'
  | 'benefitDiscount'

export interface ActivityTerm {
  kind: ActivityTermKind
  /** dropIn — the flat per-class price. trial — the paid-trial price (major
   *  units); absent/undefined means the trial is FREE (today's behaviour). */
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
  /** CLASS-ONLY. Reduced trial price (major units), sitting next to
   *  `trialEnabled`. Absent/null ⇒ FREE trial (today's behaviour); a number ⇒
   *  the trial costs that instead of the class's normal price. */
  trialPriceAmount?: number | null
  /** CLASS-ONLY. Ignored for appointments (money is the only gate there). */
  accessRule?: ActivityAccessRule | null
  /** CLASS-ONLY. */
  dropIn?: { enabled?: boolean; priceAmount?: number | null } | null
  /** APPOINTMENT-ONLY. */
  durations?: Array<{ minutes: number; priceAmount?: number | null }> | null
  /** APPOINTMENT-ONLY (as a money term here — classes also carry a
   *  `memberBenefit` now, a drop-in member rate, but it isn't surfaced as a
   *  term/chip by this resolver; see the class branch below). Accepts the
   *  legacy appointment shape or the generalized `Benefit`; normalized via
   *  `normalizeBenefit`. */
  memberBenefit?: ActivityMemberBenefit | Benefit | null
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

    // Display logic stays keyed on included/percent semantics — a fixed_price
    // benefit doesn't earn a term/chip here (no "from X" story to summarize in
    // one line); the public surfaces that show it do so via the resolver's
    // `appliedBenefit` on the actual priced option instead (see BookingForm /
    // ShopHome / AppointmentPicker).
    const benefit = normalizeBenefit(a.memberBenefit)
    const benefitTypeIds = benefit?.subscriptionTypeIds ?? []
    if (benefit && benefitTypeIds.length > 0) {
      if (benefit.effect === 'included') {
        terms.push({ kind: 'benefitIncluded', subscriptionTypeIds: benefitTypeIds })
      } else if (benefit.effect === 'percent_off' && typeof benefit.percent === 'number') {
        terms.push({ kind: 'benefitDiscount', percent: benefit.percent, subscriptionTypeIds: benefitTypeIds })
      }
    }

    return terms
  }

  // class (default when `type` is absent/'class')
  const rule = resolveActivityAccessRule(a)
  if (rule.type === 'members' || rule.type === 'subscription') {
    terms.push({
      kind: 'gate',
      tier: rule.type,
      // A subscription-gated class carries WHICH subscriptions grant access, so a
      // surface with the plan list can render "Included with {name}" per plan.
      ...(rule.type === 'subscription' && rule.subscriptionTypeIds?.length
        ? { subscriptionTypeIds: rule.subscriptionTypeIds }
        : {}),
    })
  }
  const triable = (rule.type === 'open' && a.isFreeTrial === true) || a.trialEnabled === true
  if (triable) {
    // A trial price only applies where the trial door actually grants something
    // — i.e. on a GATED class. On an open class everyone books free anyway, so
    // the door (and its price) is inert; mirrors `bookSession`'s isTrialDoor, so
    // the card never advertises a price the backend won't charge.
    const priced = typeof a.trialPriceAmount === 'number' && rule.type !== 'open'
    terms.push({
      kind: 'trial',
      ...(priced ? { amount: a.trialPriceAmount as number } : {}),
    })
  }
  if (a.dropIn?.enabled && typeof a.dropIn.priceAmount === 'number') {
    terms.push({ kind: 'dropIn', amount: a.dropIn.priceAmount })
  }

  return terms
}

// ─── structured pricing display (named subscriptions) ──────────────────────────
// The activity-card commercial display the PUBLIC surfaces render (booking flow +
// website). Resolves the raw terms into NAMED access routes, given a lookup from
// a subscription-type id → its display name + price label. Each surface supplies
// the lookup from the team's `aggregator_subscription_types`, formatted in its own
// locale/currency; a surface without the aggregator (or a sub it can't resolve)
// simply omits that line — never a generic "Subscription required".

export interface ResolvedSub {
  /** Subscription type id — lets a surface deep-link /shop?type={id}. */
  id: string
  name: string
  /** e.g. "CHF 89 / mo" — the surface formats it; null when the sub has no price. */
  priceLabel: string | null
}
export type SubLookup = (subscriptionTypeId: string) => ResolvedSub | null

export interface ActivityPricingDisplay {
  type: 'class' | 'appointment'
  /** null ⇒ no trial offered. `{ priceAmount: null }` ⇒ FREE trial (today's
   *  behaviour). `{ priceAmount: 15 }` ⇒ a paid trial at that price. */
  trial: { priceAmount: number | null } | null
  /** "Included with {name} — {priceLabel}" — a class gated at the 'subscription'
   *  tier OR an appointment's INCLUDED member benefit. One per resolvable
   *  subscription. ALWAYS EMPTY for a 'members'-tier class, and that is load
   *  bearing — see `signedUpOnly`. */
  includedWith: ResolvedSub[]
  /** TRUE for a class gated at the 'members' tier.
   *
   *  THE TIER IS NOT ABOUT MONEY. `members` gates on `acquisition_stage ===
   *  'joined'` (`resolveClassCoverage`, `shared/utils/paymentOptions.ts`), i.e.
   *  on being SIGNED UP with the studio — which the public signup form grants
   *  for free, with no plan and no payment (`completeSignup` is the only writer
   *  of 'joined', and it charges nothing). A contact with no subscription at all
   *  books these classes.
   *
   *  So a surface must NOT name subscription plans or quote a price here: the
   *  true answer to "what do I have to buy?" is NOTHING, and a price would send
   *  a prospect to the shop for something they do not need. It points at the
   *  signup surface instead. This resolver takes no plan catalogue for exactly
   *  that reason — the wrong line is not merely discouraged, it is
   *  unrepresentable.
   *
   *  Contrast 'subscription' (`includedWith`), where the named plans genuinely
   *  ARE the key and their prices are the right thing to show. Never merge the
   *  two tiers. */
  signedUpOnly: boolean
  /** "Discount with {name} — {percent}%" — an appointment's DISCOUNT benefit. */
  discountWith: Array<{ name: string; percent: number }>
  /** Class drop-in price (major units), or null. */
  dropInAmount: number | null
  /** Appointment direct/base price range (major units), or null. */
  appointmentPrice: { min: number; max: number } | null
}

export function resolveActivityPricingDisplay(
  a: ActivityTermsInput,
  subLookup: SubLookup
): ActivityPricingDisplay {
  const terms = resolveActivityTerms(a)
  const type: 'class' | 'appointment' = a.type === 'appointment' ? 'appointment' : 'class'

  const includedIds = new Set<string>()
  let signedUpOnly = false
  let discount: { percent: number; ids: string[] } | null = null
  let dropInAmount: number | null = null
  let appointmentPrice: { min: number; max: number } | null = null
  let trial: { priceAmount: number | null } | null = null

  for (const term of terms) {
    if (term.kind === 'trial') trial = { priceAmount: term.amount ?? null }
    else if (term.kind === 'dropIn') dropInAmount = term.amount ?? null
    else if (term.kind === 'price') appointmentPrice = { min: term.min ?? 0, max: term.max ?? 0 }
    else if (term.kind === 'gate' && term.tier === 'subscription')
      (term.subscriptionTypeIds ?? []).forEach((id) => includedIds.add(id))
    else if (term.kind === 'gate' && term.tier === 'members') signedUpOnly = true
    else if (term.kind === 'benefitIncluded')
      (term.subscriptionTypeIds ?? []).forEach((id) => includedIds.add(id))
    else if (term.kind === 'benefitDiscount')
      discount = { percent: term.percent ?? 0, ids: term.subscriptionTypeIds ?? [] }
  }

  const includedWith = [...includedIds]
    .map((id) => subLookup(id))
    .filter((s): s is ResolvedSub => !!s)
  const discountWith = discount
    ? discount.ids
        .map((id) => {
          const s = subLookup(id)
          return s ? { name: s.name, percent: discount!.percent } : null
        })
        .filter((x): x is { name: string; percent: number } => !!x)
    : []

  return { type, trial, includedWith, signedUpOnly, discountWith, dropInAmount, appointmentPrice }
}
