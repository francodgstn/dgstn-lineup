import type { Timestamp } from './common'

export type ActivityLevel = 'all' | 'beginners' | 'intermediate' | 'advanced'

/** Top-level category that determines the session model and booking flow. */
export type ActivityType = 'group_class' | 'coaching'

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
  /** Session category — default 'group_class'. 'coaching' uses 1:1 slot model. */
  type?: ActivityType
  /** Assigned coach uid — populated when type === 'coaching'. */
  coachId?: string
  /** Denormalised coach display name. */
  coachName?: string
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
