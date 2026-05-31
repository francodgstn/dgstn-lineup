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
  // Ranking systems shared across all clubs in the org.
  // When set, overrides individual team ranking_systems for all linked clubs.
  ranking_systems?: RankingSystem[]
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
