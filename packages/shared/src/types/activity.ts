import type { Timestamp } from './common'

export type ActivityLevel = 'all' | 'beginners' | 'intermediate' | 'advanced'

/** Top-level category that determines the session model and booking flow.
 *  'class' = a scheduled event with seats; 'appointment' = a provider's exclusive
 *  time booked from published availability (was 'coaching'). */
export type ActivityType = 'class' | 'appointment'

// Who may book an activity — the paid-access axis (mirrors CourseAccessRule).
//  - 'open'         → anyone; a newcomer/guest booking creates a trial contact
//  - 'members'      → any signed-in 'joined' contact of the team (trial accounts can't)
//  - 'subscription' → a 'joined' contact holding one of `subscriptionTypeIds` (live)
// Enforced authoritatively in the bookSession callable; defended in Firestore rules.
export type ActivityAccessTier = 'open' | 'members' | 'subscription'

export interface ActivityAccessRule {
  type: ActivityAccessTier
  /** For 'subscription': the team subscription_type ids that grant access. */
  subscriptionTypeIds?: string[]
}

/** Resolve an activity's effective access rule, deriving from the legacy `isFreeTrial`
 *  flag when `accessRule` is unset (true/undefined → open, false → members). Keep this
 *  the single source of truth so callable, rules-sync, and UI agree. */
export function resolveActivityAccessRule(a: {
  accessRule?: ActivityAccessRule | null
  isFreeTrial?: boolean
}): ActivityAccessRule {
  if (a.accessRule) return a.accessRule
  return { type: a.isFreeTrial === false ? 'members' : 'open' }
}

/** Does a booking for this offering confirm itself? Falls back to the kind's
 *  default when the field is unset: appointments auto-confirm (a 1:1 slot has no
 *  roster-review step — the time is taken the moment it's booked), classes don't
 *  (the studio confirms via check-in). Keep this the single source of truth so
 *  the booking callables, the seeds, and the UI agree. */
export function resolveAutoConfirm(a: {
  autoConfirm?: boolean
  type?: ActivityType
}): boolean {
  if (typeof a.autoConfirm === 'boolean') return a.autoConfirm
  return a.type === 'appointment'
}

/** One bookable session length of an appointment offering, with its pricing.
 *
 *  The coach sells TIME, so price is per duration — a 30-minute session cannot
 *  cost the same as a 90-minute one. `priceAmount` (major units, team currency)
 *  is the base/walk-in price; null/absent = unpriced, so the plain access rules
 *  decide (open → free, members/subscription → covered-only).
 *
 *  `subscriptionPricing` is the EXPLICIT member benefit: an entry with
 *  `priceAmount: null` means INCLUDED (holders book free; credit-pack types
 *  spend a credit), a number is a member price. A priced duration with no
 *  entries costs base for everyone, subscribers included — benefit is data,
 *  never implied. A contact holding several types gets the LOWEST applicable
 *  price ("included" beats any amount). */
export interface ActivityDuration {
  minutes: number
  priceAmount?: number | null
  subscriptionPricing?: Array<{ subscriptionTypeId: string; priceAmount: number | null }>
}

/** An appointment activity's duration menu, defaulting to a single unpriced
 *  60-minute entry when unset — the one fallback rule, shared by the
 *  availability grid, the booking gate, and the UIs. */
export function resolveAppointmentDurations(a: {
  durations?: ActivityDuration[] | null
}): ActivityDuration[] {
  const ds = (a.durations ?? []).filter((d) => d.minutes > 0)
  return ds.length ? ds : [{ minutes: 60 }]
}

/** A duration's price for one particular contact, given the subscription types
 *  they currently hold — the PRICE gate (separate from, and orthogonal to, the
 *  ACCESS gate in `ActivityAccessRule`). Server-side resolution only; the client
 *  may mirror this for display, but booking/checkout always re-resolve.
 *
 *  Rule: candidates = the base `priceAmount` (what a guest, or any non-matching
 *  holder, pays) plus every `subscriptionPricing` entry whose type the contact
 *  holds. An entry with `priceAmount: null` means INCLUDED — it beats any amount
 *  outright, regardless of how it compares numerically. Otherwise the LOWEST
 *  amount among the candidates wins (several held types may each define a
 *  price; the contact gets the best one). An unpriced base with no matching
 *  entries resolves free (`{ free: true, amount: null }`) — the plain access
 *  rules decide, exactly like before paid appointments existed. A PRICED
 *  duration with no matching `subscriptionPricing` entry costs the base price
 *  for everyone, subscribers included — the member benefit is explicit data,
 *  never implied. */
export function resolveEffectiveAppointmentPrice(
  duration: ActivityDuration,
  heldSubscriptionTypeIds: string[] = [],
): { free: boolean; amount: number | null; viaSubscriptionTypeId?: string | null } {
  const held = new Set(heldSubscriptionTypeIds)
  const matchingEntries = (duration.subscriptionPricing ?? []).filter((e) =>
    held.has(e.subscriptionTypeId),
  )

  // "Included" (priceAmount: null) always wins outright — free beats any amount.
  const included = matchingEntries.find((e) => e.priceAmount === null)
  if (included) {
    return { free: true, amount: null, viaSubscriptionTypeId: included.subscriptionTypeId }
  }

  const candidates: Array<{ amount: number; viaSubscriptionTypeId: string | null }> = []
  if (typeof duration.priceAmount === 'number') {
    candidates.push({ amount: duration.priceAmount, viaSubscriptionTypeId: null })
  }
  for (const e of matchingEntries) {
    if (typeof e.priceAmount === 'number') {
      candidates.push({ amount: e.priceAmount, viaSubscriptionTypeId: e.subscriptionTypeId })
    }
  }

  if (candidates.length === 0) return { free: true, amount: null }

  const lowest = candidates.reduce((min, c) => (c.amount < min.amount ? c : min))
  return { free: false, amount: lowest.amount, viaSubscriptionTypeId: lowest.viaSubscriptionTypeId }
}

export interface Activity {
  id: string
  teamId: string
  name: string
  alternativeName?: string
  description?: string
  slug: string
  color?: string
  level?: ActivityLevel
  /** Session category — default 'class'. 'appointment' uses the availability model. */
  type?: ActivityType
  /** Assigned provider uid — populated when type === 'appointment'. */
  providerId?: string
  /** Denormalised provider display name. */
  providerName?: string
  /** APPOINTMENT-ONLY. The session lengths a client may book this offering at,
   *  each with an optional price. Duration belongs to the *what* (the activity),
   *  not to the *when* (the availability schedule): a "Technique Assessment" is
   *  60 minutes wherever it is offered. An availability window's selectable start
   *  times are derived from these — never configured on the availability doc.
   *  Classes don't use this (their length is per-session, from start/end).
   *  History: was `durationsMinutes: number[]` until 2026-07 (pre-launch), when
   *  per-duration pricing arrived with paid appointments. */
  durations?: ActivityDuration[]
  /** Does a booking confirm itself, or does the studio decide?
   *  - `true`  → the booking is written `status: 'confirmed'` on the spot.
   *  - `false` → it stays unconfirmed until the studio confirms/checks them in.
   *  Defaults by kind when unset (appointment → true, class → false) via
   *  `resolveAutoConfirm`, but it is a FIELD, not a type rule: a class may
   *  auto-confirm, and an appointment may require approval. Denormalised onto
   *  each Session at booking time. */
  autoConfirm?: boolean
  base_score?: number | null
  /** Legacy trial toggle. Superseded by `accessRule` but kept in sync
   *  (`isFreeTrial = accessRule.type === 'open'`) for existing queries. */
  isFreeTrial?: boolean
  /** Paid-access gate. When unset, derived from `isFreeTrial` (see resolveActivityAccessRule). */
  accessRule?: ActivityAccessRule
  /** Drop-in / pay-per-class: a contact not covered by the access rule may pay this
   *  one-off price to book a single session. Charged via Stripe Connect; no membership
   *  is created. Group-class only for now. Price is major units (team default_currency). */
  dropIn?: { enabled: boolean; priceAmount?: number }
  /** Display-only entry requirements shown on the public booking pages (e.g.
   *  "25m front crawl with side breathing"). Not enforced anywhere. */
  prerequisites?: string
  /** Extra instructions appended to this activity's booking confirmation email,
   *  overriding the team-wide `settings.bookingConfirmationInstructions`.
   *  Email-only — never mirrored to the public profile. */
  confirmationInstructions?: string
  isActive?: boolean
  image_url?: string
  // Display order (lower = first), respected by the manager list, the public
  // booking flow, the website, and any other place that lists activities. Absent
  // values sort last (by name) until the studio reorders.
  order?: number
  created_at?: Timestamp
  createdBy?: string
  archived_at?: Timestamp | null
}

/** Stable sort for activities: explicit `order` first (asc), then name. Absent
 *  order sorts last. Single source of truth so the manager, the public booking
 *  flow, the website, and everywhere else that lists activities agree. Typed
 *  loosely so denormalised public-profile shapes can reuse it. */
export function compareActivities(
  a: { order?: number | null; name?: string },
  b: { order?: number | null; name?: string },
): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER
  const bo = b.order ?? Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return (a.name ?? '').localeCompare(b.name ?? '')
}

export interface ActivityPublicProfile {
  teamId: string
  name: string
  description?: string
  slug: string
  color?: string
  image_url?: string
  /** Denormalised display order so public consumers sort identically to admin. */
  order?: number
  /** Denormalised access gate so booking UIs can render lock state and rules can gate. */
  accessRule?: ActivityAccessRule
  /** Denormalised drop-in config so the booking UI can offer pay-per-class. */
  dropIn?: { enabled: boolean; priceAmount?: number }
  /** APPOINTMENT-ONLY. The duration menu with base prices so public cards can
   *  show "from CHF 45". Mirrored from `Activity.durations` with
   *  `subscriptionPricing` STRIPPED — member benefits are per-contact data,
   *  never public; the picker gets the full shape from `listAvailability`. */
  durations?: Array<{ minutes: number; priceAmount: number | null }>
  /** Denormalised display-only prerequisites for the public booking pages. */
  prerequisites?: string
}

/** The subscription-type ids an access rule demands, or null when the rule doesn't
 *  gate on subscriptions at all (open/members). An empty array is a real (mis)config
 *  — a subscription-gated activity nobody can book — and is returned as-is. */
export function activityRequiresSubscription(
  accessRule: ActivityAccessRule | null | undefined,
): string[] | null {
  if (!accessRule || accessRule.type !== 'subscription') return null
  return accessRule.subscriptionTypeIds ?? []
}

// Structural subset of Contact the coverage check reads — typed loosely so it
// accepts full Contact docs, denormalised snapshots, and test fixtures alike.
export interface SubscriptionCoverageSnapshot {
  subscription_type_id?: string | null
  active_subscriptions?: Array<{ subscription_type_id?: string | null }> | null
  credit_summary?: Array<{
    subscription_type_id?: string | null
    remaining?: number
    next_expires_at?: { toMillis(): number } | null
  }> | null
}

/** The subscription-type ids a contact currently "holds" for coverage purposes:
 *  live subscriptions in `active_subscriptions`, the primary `subscription_type_id`
 *  snapshot, and non-exhausted, non-expired lesson-credit balances. Mirrors the
 *  coverage union in the bookSession callable (which stays authoritative — it
 *  additionally SPENDS credits). */
export function heldSubscriptionTypeIds(
  contact: SubscriptionCoverageSnapshot | null | undefined,
  nowMs: number = Date.now(),
): string[] {
  if (!contact) return []
  const held = new Set<string>()
  for (const s of contact.active_subscriptions ?? []) {
    if (s.subscription_type_id) held.add(s.subscription_type_id)
  }
  if (contact.subscription_type_id) held.add(contact.subscription_type_id)
  for (const e of contact.credit_summary ?? []) {
    if (!e.subscription_type_id) continue
    if ((e.remaining ?? 0) <= 0) continue
    if (e.next_expires_at && e.next_expires_at.toMillis() <= nowMs) continue
    held.add(e.subscription_type_id)
  }
  return Array.from(held)
}

/** Read-only "is this contact covered for these subscription types" check, shared by
 *  the admin session UI, the roster badges, and the member-facing booking warning. */
export function contactHoldsCoveringSubscription(
  contact: SubscriptionCoverageSnapshot | null | undefined,
  subscriptionTypeIds: string[] | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!contact || !subscriptionTypeIds?.length) return false
  const held = new Set(heldSubscriptionTypeIds(contact, nowMs))
  return subscriptionTypeIds.some((id) => held.has(id))
}
