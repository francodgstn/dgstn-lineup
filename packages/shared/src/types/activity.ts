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
   *  e.g. [30, 60, 90]. Duration belongs to the *what* (the activity), not to the
   *  *when* (the availability schedule): a "Technique Assessment" is 60 minutes
   *  wherever it is offered. An availability window's selectable start times are
   *  derived from these — they are never configured on the availability doc.
   *  Classes don't use this (their length is per-session, from start/end). */
  durationsMinutes?: number[]
  /** APPOINTMENT-ONLY. Booking cap for a materialised appointment session.
   *  Defaults to 1 (a true 1:1); >1 allows small-group coaching. */
  max_participants?: number
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
