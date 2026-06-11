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

  // Team-level membership (legacy / bio-link signup flow)
  type?: ContactType
  membership_status?: MembershipStatus
  membership_active?: boolean
  membership_expiration?: Timestamp

  // Org-level membership (federation / affiliation)
  org_membership_status?: string
  org_membership_active?: boolean
  org_membership_expiration?: Timestamp
  subscription_type_id?: string
  subscription_type_name?: string
  subscription_recurrence?: string
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

export interface SubscriptionType {
  id: string
  name: string
  description?: string
  source?: 'internal' | 'aggregator'
  active?: boolean
}

// ─── subscription history (contacts/{id}/subscription_history) ────────────────

export interface SubscriptionHistoryEntry {
  id: string
  subscription_type_id?: string
  subscription_type_name?: string
  recurrence?: string
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
