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

  // Membership & subscription
  type?: ContactType
  membership_status?: MembershipStatus
  membership_active?: boolean
  membership_expiration?: Timestamp
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
  max_streak?: number
  total_sessions?: number
  last_session_at?: Timestamp
  custom_badges?: string[]

  // Activity tracking
  last_seen_at?: Timestamp

  // Alerts (denormalized count)
  alerts_count?: number

  // Tags — free-form labels attached by automations or manually
  tags?: string[]

  // Ranking — keyed by RankingSystem.id (e.g. { "hmd": 5, "internal": 2 })
  ranks?: Record<string, number>

  // Lifecycle
  created_at?: Timestamp
  archived_at?: Timestamp | null
  deleted_at?: Timestamp | null
  anonymized_at?: Timestamp | null
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
