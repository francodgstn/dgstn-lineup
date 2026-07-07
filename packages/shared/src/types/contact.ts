import type { Timestamp } from './common'
import type { AffiliationSummary } from './affiliation'

// ─── Acquisition axis (sticky, event-named funnel) ───────────────────────────
// Single ordered, OPEN vocab. The stage is a high-water milestone: it advances on
// transition and never flips backward. Reserved (design-for, don't build):
// upstream 'enquired'; downstream 'left' | 'won_back'.
//
// The funnel is OPTIONAL: it measures progress toward joining the training
// relationship (trial → join). A contact who entered off-funnel — bought in the shop
// or submitted a public form without ever booking/attending a trial — simply has NO
// acquisition_stage yet (see Contact.acquisition_stage). Absent = "not on the funnel",
// NOT a stage. Such a contact enters the funnel later, normally, if they book a trial.
export const ACQUISITION_STAGES = ['trial_booked', 'trial_attended', 'joined'] as const
export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number]

// How the contact first ENTERED — immutable birth fact, set once by the entry event.
// Two kinds:
//  • FUNNEL doors — born on the trial funnel:
//      'booking'  → trial door, born 'trial_booked'
//      'walk_in'  → trial door, born already 'trial_attended'
//      'signup'   → direct join, born 'joined'
//      'import'   → migration, born 'joined'
//  • OFF-FUNNEL routes — enter the contact base with NO acquisition_stage (not on the
//    funnel; a purchase/lead-capture is not a funnel milestone):
//      'shop'     → self-created by a public shop purchase (product / course / membership)
//      'form'     → lead captured via a published Custom Form
export const CONTACT_ENTRIES = ['booking', 'walk_in', 'signup', 'import', 'form', 'shop'] as const
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

// One entry of Contact.active_subscriptions — a compact snapshot of a LIVE Stripe
// member subscription, deduped by type. Maintained by onMemberSubscriptionWrite.
export interface ActiveSubscriptionSummary {
  subscription_type_id: string
  subscription_type_name: string | null
  recurrence: string | null
  amount: number // major units (CHF), per period
  status: SubscriptionRollupStatus
}

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

// Max passwordless-login allow-list emails per contact (on top of the primary
// `email`). Shared by the admin editor + the login callable.
export const MAX_CONTACT_LOGIN_EMAILS = 5

export interface Contact {
  id: string
  teamId: string
  createdBy?: string
  // Assigned coaches (team_member uids) — the staff who coach this contact. A contact
  // may have several. Backs the Coach role's own-data scope: a coach-role member may
  // see/manage only contacts they are assigned to (or created). Empty/absent =
  // unassigned. Owner/manager may also appear here (they can be coaches), but stay
  // all-scoped regardless — for them it's a relationship record, not a restriction.
  assigned_coach_ids?: string[]

  // Identity
  firstname: string
  lastname: string
  email?: string
  phone?: string
  // Passwordless-login allow-list: extra emails permitted to sign in AS this
  // contact via the OTP flow (on top of `email`), e.g. a parent logging in to
  // their child's profile. Normalized lowercase, deduped, capped at 5. Each entry
  // is a deliberate access grant — anyone who controls one of these inboxes can
  // authenticate as this contact. See loginContactWithCode / buildContactSession.
  login_emails?: string[]
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
  // OPTIONAL: absent = the contact is NOT on the trial funnel. An off-funnel entry
  // ('shop' / 'form' — a buyer or a captured lead) has no stage until it first books
  // a trial, at which point it enters the funnel normally. Never synthesise a stage
  // for these; "not applicable" is the honest value (don't assert a milestone that
  // didn't happen). The purchase itself is never a stage — a recurring purchase lives
  // on the subscription axis, a one-off on order/payment history.
  acquisition_stage?: AcquisitionStage
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
  // "Paid at checkout but hasn't finished signup yet" — set true only on a contact
  // created by a 'full'-mode shop purchase (consent + the studio's required fields
  // still owed). Cleared, with signup_completed_at stamped, when the buyer finishes
  // the signup-finalize flow. Absent ⇒ not pending (a minimal/back-office contact is
  // considered complete). See CheckoutContactMode.
  pending_signup?: boolean
  signup_completed_at?: Timestamp | null
  // PROVISIONAL = a lead that does NOT count toward the plan's contact cap yet.
  // Carried by every entrant that hasn't materialized: shop registrations awaiting
  // their first payment, trial bookings never attended, and public-form leads. All
  // live under the contacts page's "Leads" tab. MATERIALIZATION clears both fields:
  // a successful payment (Connect webhook), first attendance (booked→attended
  // promotion), stage promotion to attended/joined, full signup completion, a
  // manual subscription assignment, or the studio's manual Confirm.
  // provisional_expires_at is set ONLY for shop registrations (anti-flooding): the
  // daily purge task hard-deletes those once it passes unpaid. Leads without an
  // expiry are never purged — stale trial bookings are archived by the opt-out
  // 'lib_trial_cleanup' automation instead. Absent ⇒ a normal, counted contact.
  provisional?: boolean
  provisional_expires_at?: Timestamp | null

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

  // Subscription — the single fields below are the "primary / most-recent" snapshot
  // (manual assignment, or the latest Stripe purchase). A contact may hold SEVERAL
  // different active subscription types at once (never two of the same) — the full set
  // lives in active_subscriptions, maintained by onMemberSubscriptionWrite from the
  // member_subscriptions docs. Read active_subscriptions for display; the single fields
  // remain for back-compat (filters, manual assignment).
  subscription_type_id?: string
  subscription_type_name?: string
  subscription_recurrence?: string // authoritative; derived from the chosen price when one exists
  subscription_price_id?: string // set only when the chosen type has prices
  subscription_amount?: number // amount snapshot at assignment time
  subscription_type_updated_at?: Timestamp
  // Contact-level rollup of member_subscriptions Stripe status (webhook-maintained).
  // 'none' when the contact holds no live subscription. See SubscriptionRollupStatus.
  subscription_status?: SubscriptionRollupStatus
  // All LIVE Stripe subscriptions the contact holds, deduped by type (webhook-maintained
  // by onMemberSubscriptionWrite). Empty/absent when none. Drives the multi-subscription
  // chips on the contacts list + detail.
  active_subscriptions?: ActiveSubscriptionSummary[]

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

// How the public shop captures a contact when this subscription is bought:
//   'off'     — no contact created at checkout (the studio links the payment later)
//   'minimal' — collect first/last name + email and create a member contact (default)
//   'full'    — collect first/last name + email, then redirect the buyer to the signup
//               page to finish their profile + consent (contact is 'pending signup')
export type CheckoutContactMode = 'off' | 'minimal' | 'full'
export const CHECKOUT_CONTACT_MODES: CheckoutContactMode[] = ['off', 'minimal', 'full']

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
  // Public-shop contact capture for this type (absent ⇒ 'minimal').
  checkout_contact_mode?: CheckoutContactMode
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
