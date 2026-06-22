import type { Timestamp } from './common'

export type MembershipStatus =
  | 'guest'
  | 'requested'
  | 'under_review'
  | 'almost_ready'
  | 'active'
  | 'expired'

export type ContactType = 'trial' | 'student' | 'external'

export type ContactGender = 'M' | 'F' | 'other'

export interface ContactAddress {
  route?: string
  street_number?: string
  postal_code?: string
  locality?: string
}

export interface EmergencyContact {
  name: string
  phone?: string
  email?: string
}

export interface ContactAcquisition {
  channel?: string
  campaign?: string
  notes?: string
  acknowledged?: boolean
}

export interface Contact {
  id: string
  teamId: string
  createdBy?: string

  // Identity
  firstname: string
  lastname: string
  email?: string
  phone?: string
  gender?: ContactGender
  birthdate?: Timestamp
  birthplace?: string
  weight?: number
  avatar_url?: string

  // Address
  address?: ContactAddress

  // Emergency contacts (max 2)
  emergency_contacts?: EmergencyContact[]

  // Team-level membership (legacy / bio-link signup flow)
  type?: ContactType
  membership_status?: MembershipStatus
  membership_active?: boolean
  membership_expiration?: Timestamp

  // Org-level membership (federation / affiliation)
  org_membership_status?: string
  org_membership_active?: boolean
  org_membership_expiration?: Timestamp
  // Subscription (one active subscription per contact)
  subscription_type_id?: string
  subscription_type_name?: string
  subscription_recurrence?: string // authoritative; derived from the chosen price when one exists
  subscription_price_id?: string // set only when the chosen type has prices
  subscription_amount?: number // amount snapshot at assignment time
  subscription_type_updated_at?: Timestamp

  // Acquisition / funnel
  acquisition?: ContactAcquisition

  // Notes (plain text; rich-text JSON stored as string in hmd-lineup)
  notes?: string

  // Gamification
  current_month_score?: number
  current_streak?: number
  streak_last_qualified_week?: string
  max_streak?: number
  total_sessions?: number
  last_session_at?: Timestamp
  distinct_activities?: string[]
  times_leader?: number
  times_top5?: number
  custom_badges?: string[]

  // Booking / bio-link counters (managed by Cloud Functions)
  pending_bookings_count?: number
  conversions_count?: number

  // Bio-link login tracking
  login_count?: number
  last_login_at?: Timestamp

  // Activity tracking
  last_seen_at?: Timestamp

  // Alerts (denormalized count)
  alerts_count?: number

  // Tags — free-form labels attached by automations or manually
  tags?: string[]

  // Contact Groups plugin — IDs of teams/{teamId}/contact_groups docs
  group_ids?: string[]

  // Ranking — keyed by RankingSystem.id (e.g. { "hmd": 5, "internal": 2 })
  ranks?: Record<string, number>

  // Custom Fields plugin — keyed by CustomFieldDefinition.id. Dates are stored
  // as ISO 'YYYY-MM-DD' strings to keep the map JSON-flat.
  custom_fields?: Record<string, string | number | boolean>

  // Lifecycle
  created_at?: Timestamp
  archived_at?: Timestamp | null
  deleted_at?: Timestamp | null
  anonymized_at?: Timestamp | null
}

// ─── contact group (teams/{teamId}/contact_groups) ───────────────────────────
// Contact Groups plugin — nested member groups à la association management
// tools. Nesting via parent_id; membership lives on Contact.group_ids.

export interface ContactGroup {
  id: string
  name: string
  parent_id: string | null
  color?: string
  description?: string
  created_at?: Timestamp
  created_by?: string
  updated_at?: Timestamp
}

// ─── subscription type (team configuration) ───────────────────────────────────

export type SubscriptionRecurrence =
  | 'per_class'
  | 'one_time' // a single charge (e.g. intro package); grants `included_months` of membership
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'annual'

// Recurrences billed as a Stripe subscription (vs one-off charges: per_class, one_time).
export const RECURRING_RECURRENCES: SubscriptionRecurrence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual',
]

export function isRecurringRecurrence(r: SubscriptionRecurrence): boolean {
  return RECURRING_RECURRENCES.includes(r)
}

// Maps a recurring recurrence to a Stripe interval + count. Returns null for the
// one-off recurrences (per_class, one_time), which are charged as single payments.
export function recurrenceToStripeInterval(
  r: SubscriptionRecurrence
): { interval: 'week' | 'month' | 'year'; interval_count: number } | null {
  switch (r) {
    case 'weekly':
      return { interval: 'week', interval_count: 1 }
    case 'biweekly':
      return { interval: 'week', interval_count: 2 }
    case 'monthly':
      return { interval: 'month', interval_count: 1 }
    case 'quarterly':
      return { interval: 'month', interval_count: 3 }
    case 'annual':
      return { interval: 'year', interval_count: 1 }
    default:
      return null // per_class, one_time
  }
}

// A single price option on a subscription type (Stripe-like: product → prices).
// Amount is in the team's default currency (Team.default_currency).
export interface SubscriptionPrice {
  id: string // client-generated; stable across edits
  amount: number // in the team default currency, e.g. 49.9
  recurrence: SubscriptionRecurrence
  // For one_time prices: months of membership granted by the charge (e.g. an
  // "intro offer: 100, 2 months incl." sets membership_expiration = now + 2 months).
  included_months?: number
  label?: string // optional, e.g. "Intro offer"
  active?: boolean // default true; inactive prices are hidden from the table + assignment
}

export interface SubscriptionType {
  id: string
  name: string
  description?: string
  source?: 'internal' | 'aggregator'
  active?: boolean
  public?: boolean // show on the bio-link / website pricing table (default off)
  // Display order (lower = first), respected by the manager list, the website
  // pricing table, and any other place that lists subscription types. Absent
  // values sort last (by name) until the studio reorders.
  order?: number
  prices?: SubscriptionPrice[] // optional; absent = the simple "just a container" flow
}

/** Stable sort for subscription types: explicit `order` first (asc), then name. */
export function compareSubscriptionTypes(a: SubscriptionType, b: SubscriptionType): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER
  const bo = b.order ?? Number.MAX_SAFE_INTEGER
  if (ao !== bo) return ao - bo
  return (a.name ?? '').localeCompare(b.name ?? '')
}

// ─── subscription history (contacts/{id}/subscription_history) ────────────────

export interface SubscriptionHistoryEntry {
  id: string
  subscription_type_id?: string
  subscription_type_name?: string
  recurrence?: string
  subscription_price_id?: string // price chosen at the time, when the type had prices
  amount?: number // amount snapshot at the time of subscription
  start_date?: Timestamp
  end_date?: Timestamp | null
  termination_reason?: string
  created_at?: Timestamp
  created_by?: string
}

// ─── contact alert (contacts/{id}/contact_alerts) ─────────────────────────────

export type AlertScheduleType = 'sessions_countdown' | 'datetime'

export interface ContactAlert {
  id: string
  schedule_type: AlertScheduleType
  schedule_value: number | Timestamp
  message: string
  show_in_app?: boolean
  archived_at?: Timestamp | null
  created_at?: Timestamp
}

// ─── contact update request (teams/{teamId}/contact_requests) ─────────────────

export interface ContactRequest {
  id: string
  contact_id: string
  contact_name?: string
  requested_at: Timestamp
  note?: string
  changes: Record<string, unknown>
}
