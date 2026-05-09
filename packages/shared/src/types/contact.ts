import type { Timestamp } from './common'

export type MembershipStatus =
  | 'guest'
  | 'requested'
  | 'under_review'
  | 'almost_ready'
  | 'active'
  | 'expired'

export type ContactType = 'trial' | 'student' | 'external'

export interface Contact {
  id: string
  teamId: string
  firstname: string
  lastname: string
  email?: string
  phone?: string
  birthdate?: Timestamp
  // Generic progression level (replaces martial arts rank)
  level?: number
  // Membership
  membership_status?: MembershipStatus
  membership_active?: boolean
  membership_expiration?: Timestamp
  subscription_type_id?: string
  // Tracking
  type?: ContactType
  archived_at?: Timestamp | null
  deleted_at?: Timestamp | null
  created_at?: Timestamp
  last_session_at?: Timestamp
  // Notes
  notes?: string
}

export interface SubscriptionHistory {
  id: string
  subscription_type_id: string
  subscription_type_name: string
  created_at: Timestamp
  created_by: string
  action: 'add' | 'edit' | 'delete'
}
