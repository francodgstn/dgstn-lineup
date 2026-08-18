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
  /** When the org's trial ends (ORG_TRIAL_DAYS from creation). READ, never
   *  recomputed, by handleTrialLifecycle's org phase — editing this field is how
   *  a Linyup operator extends a hand-onboarded customer's trial. */
  trial_ends_at?: Timestamp
  /** Set when the org trial lapsed and the org was moved off the tier
   *  (lapseOrganization). Nothing reads it as state — the status does that; it
   *  is the "when" for support. */
  downgraded_from_trial_at?: Timestamp
  /** Operational flags — same meaning and same exemption as `Team.flags`: an
   *  internal or pilot organisation is never auto-lapsed by the trial sweep. */
  flags?: {
    internal?: boolean
    pilot?: boolean
  }
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
  removed_at?: Timestamp
  /** Why the link ended. Absent = an org admin removed the team by hand
   *  (removeTeamFromOrg). 'org_lapsed' = the organisation stopped paying and
   *  the studio was dropped to Free by lapseOrganization — the org admin's
   *  access to that studio's data ended with it. */
  removed_reason?: 'org_lapsed'
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
