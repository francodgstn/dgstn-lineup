import type { Timestamp } from './common'

export type TeamRole = 'owner' | 'manager' | 'viewer'

export type SaasPlan = 'coach' | 'club' | 'org' | 'enterprise'
export type SaasStatus = 'trial' | 'active' | 'past_due' | 'cancelled'

export interface LevelDefinition {
  label: string
  color?: string
  value: number
}

export interface TeamLink {
  label: string
  description?: string
  url: string
  showInPortal: boolean
  isBookingLink?: boolean
  isMembershipLink?: boolean
}

export interface Team {
  id: string
  name: string
  slug: string
  description?: string
  primaryContact?: string
  sport_type?: string
  level_system?: LevelDefinition[]
  links?: TeamLink[]
  language?: 'en' | 'de' | 'fr' | 'it'
  settings?: Record<string, unknown>
  // SaaS plan fields (new in Lineup)
  plan?: SaasPlan
  plan_status?: SaasStatus
  trial_ends_at?: Timestamp
  stripe_customer_id?: string
  max_contacts?: number
  // Timestamps
  created: Timestamp
  createdBy: string
  disabled_at?: Timestamp | null
}

export interface TeamMember {
  userId: string
  teamId: string
  role: TeamRole
  joined: Timestamp
  addedBy: string
  roleUpdatedAt?: Timestamp
}

export interface TeamPublicProfile {
  name: string
  description?: string
  slug: string
  links?: TeamLink[]
  sport_type?: string
}

export interface TeamInvitation {
  id: string
  teamId: string
  email: string
  role: TeamRole
  token: string
  invitedBy: string
  created: Timestamp
  accepted_at?: Timestamp
  expired_at?: Timestamp
}
