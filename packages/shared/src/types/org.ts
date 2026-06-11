import type { Timestamp } from './common'
import type { SaasStatus, RankingSystem } from './team'

export type OrgRole = 'org_admin' | 'org_viewer'
export type OrgTeamStatus = 'invited' | 'active' | 'removed'
export type OrgInvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export interface Organization {
  id: string
  name: string
  slug: string
  description?: string
  plan: 'organization'
  plan_status: SaasStatus
  stripe_customer_id?: string
  // Ranking systems shared across all teams in the org.
  // When set, overrides individual team ranking_systems for all linked teams.
  ranking_systems?: RankingSystem[]
  // Per-locale custom term for the membership concept (e.g. "Affiliation", "Lizenz").
  // Resolved at render time: term[locale] ?? term['en'] ?? 'Membership'.
  membership_term?: Partial<Record<'en' | 'de' | 'fr' | 'it', string>>
  // When true, org_membership_* fields on contacts are read-only for team managers.
  // Only org admins (and org-level automations when implemented) may write them.
  lock_org_membership?: boolean
  created: Timestamp
  createdBy: string
}

export interface OrgMember {
  userId: string
  orgId: string
  role: OrgRole
  joined: Timestamp
  addedBy: string
}

export interface OrgTeam {
  teamId: string
  orgId: string
  status: OrgTeamStatus
  joined: Timestamp
  addedBy: string
}

export type TeamAccessType = 'view' | 'manage'
export type TeamAccessRequestStatus = 'pending' | 'approved' | 'denied'

export interface TeamAccessRequest {
  teamId: string
  orgId: string
  requestedBy: string
  requestedAt: Timestamp
  accessType: TeamAccessType
  status: TeamAccessRequestStatus
  processedBy?: string
  processedAt?: Timestamp
}

export interface OrgInvitation {
  id: string
  orgId: string
  teamId?: string
  inviteeEmail?: string
  status: OrgInvitationStatus
  invitedBy: string
  created: Timestamp
  expires_at: Timestamp
}
