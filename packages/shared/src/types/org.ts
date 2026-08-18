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
  // Per-locale custom label for the affiliation concept (e.g. "Membership", "Lizenz").
  // Resolved at render time: term[locale] ?? term['en'] ?? 'Affiliation'.
  affiliation_term?: Partial<Record<'en' | 'de' | 'fr' | 'it', string>>
  // When true, a contact's affiliation status is read-only for team managers.
  // Only org admins (and org-level automations when implemented) may change it.
  lock_affiliation?: boolean
  created: Timestamp
  createdBy: string
}

export interface OrgMember {
  userId: string
  orgId: string
  role: OrgRole
  joined: Timestamp
  addedBy: string
  /** Display copy denormalized from `users/{uid}` when the member is added, so
   *  the org Members list can name people without reading the users collection
   *  (an org admin has no rule that lets them). Absent on rows written before
   *  the member callables existed — the list falls back to the uid. */
  displayName?: string
  email?: string
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
