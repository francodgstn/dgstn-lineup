import type { Timestamp } from './common'
import type { AffiliationSummary } from './affiliation'

// ─── Acquisition axis (sticky, event-named funnel) ───────────────────────────
// Single ordered, OPEN vocab. The stage is a high-water milestone: it advances on
// transition and never flips backward. Reserved (design-for, don't build):
// upstream 'enquired'; downstream 'left' | 'won_back'.
export const ACQUISITION_STAGES = ['trial_booked', 'trial_attended', 'joined'] as const
export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number]

// How the contact first ENTERED — immutable birth fact, set once by the entry event.
// 'booking' | 'walk_in' are the trial doors (walk-in is born already 'trial_attended');
// 'signup' (direct join) and 'import' (migration) are non-trial entries born 'joined'.
export const CONTACT_ENTRIES = ['booking', 'walk_in', 'signup', 'import'] as const
export type ContactEntry = (typeof CONTACT_ENTRIES)[number]

// Source axis — marketing CHANNEL (attribution only), set once, never overwritten.
// NOTE: 'walk_in' is an ENTRY value, never a source, or the channel is lost.
export const CONTACT_SOURCES = ['website', 'referral', 'social', 'event', 'import', 'other'] as const
export type ContactSource = (typeof CONTACT_SOURCES)[number]

// Subscription axis — contact-level ROLLUP of the per-subscription Stripe status in
// teams/{teamId}/member_subscriptions. The ONLY axis that pauses: a summer-break or
// injury freeze suspends BILLING (→ 'paused'), not belonging. Webhook-maintained.
// Distinct from the acquisition 'trial_*' stages — 'trialing' here is a Stripe free
// period, never a trial class.
export const SUBSCRIPTION_ROLLUP_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'paused',
  'cancelled',
  'none',
] as const
export type SubscriptionRollupStatus = (typeof SUBSCRIPTION_ROLLUP_STATUSES)[number]

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

  // ─── Acquisition axis ──────────────────────────────────────────────────────
  // Sticky high-water funnel position (trial_booked → trial_attended → joined).
  // Advances on transition, never regresses. Per-session attendance is a fact on
  // the booking, not here — the booking event PROMOTES the milestone.
  acquisition_stage: AcquisitionStage
  acquisition_stage_updated_at?: Timestamp
  // Immutable birth fact: which door the contact came through; sets the birth stage.
  // Correctable for data-entry mistakes, but never silently moves the stage.
  entry?: ContactEntry
  // Milestone timestamps — set when the stage first reaches them; editable in the
  // contact profile (e.g. backdating an imported member who joined long ago).
  // trial_booked_at is an optional override; the UI falls back to created_at.
  trial_booked_at?: Timestamp
  trial_attended_at?: Timestamp
  converted_at?: Timestamp

  // ─── Source axis ───────────────────────────────────────────────────────────
  // Marketing channel + free-form detail. Set once at creation, never overwritten.
  source?: ContactSource
  source_detail?: string
  // "New contact seen" UX flag (replaces the old acquisition.acknowledged).
  lead_acknowledged?: boolean

  // ─── Affiliation axis (belonging) ──────────────────────────────────────────
  // Affiliations themselves live in the contacts/{id}/affiliations subcollection
  // (a contact may hold several). This denormalized rollup is what the contacts
  // list + Firestore rules read; maintained by the onAffiliationWrite trigger.
  affiliation_summary?: AffiliationSummary

  // Subscription (one active subscription per contact)
  subscription_type_id?: string
  subscription_type_name?: string
  subscription_recurrence?: string // authoritative; derived from the chosen price when one exists
  subscription_price_id?: string // set only when the chosen type has prices
  subscription_amount?: number // amount snapshot at assignment time
  subscription_type_updated_at?: Timestamp
  // Contact-level rollup of member_subscriptions Stripe status (webhook-maintained).
  // 'none' when the contact holds no live subscription. See SubscriptionRollupStatus.
  subscription_status?: SubscriptionRollupStatus

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
  contact_email?: string
  team_id?: string
  request_type?: 'data_update'
  /** The fields the contact submitted (firstname, lastname, phone, …). */
  submitted_data?: Record<string, unknown>
  note?: string
  status?: 'pending' | 'approved' | 'discarded'
  requested_at: Timestamp
  reviewed_at?: Timestamp
  reviewed_by?: string
}
