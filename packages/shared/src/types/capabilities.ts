import type { TeamRole } from './team'
import type { Timestamp } from './common'

// ─────────────────────────────────────────────────────────────────────────────
// Team capability model — the single source of truth for what each role can do.
//
// Pure data + pure functions (no I/O), mirroring plan.ts. The web hook
// (useCapabilities), the Cloud Function guard (requireCapability) and the
// Firestore rules all derive from THESE definitions so there is one place to
// reason about permissions.
//
// A team member's access has two axes:
//   1. CAPABILITIES — which actions the member may perform (a set of Capability).
//   2. DATA SCOPE   — whether the (scoped) capabilities apply to ALL team records
//      or only to the member's OWN records (assigned/created). `own` is what makes
//      a Coach a coach: contacts.manage with scope 'own' = "manage MY contacts".
//
// System roles (owner/manager/viewer) have FIXED capability sets defined here and
// are always `all`-scoped. The Coach role has a customizable set (defaulting to
// COACH_DEFAULT_CAPABILITIES, overridable per team at teams/{id}/role_config/coach)
// and is `own`-scoped. Custom roles are a later phase; this model already fits them.
// ─────────────────────────────────────────────────────────────────────────────

export type DataScope = 'all' | 'own'

// Capability ids are `domain.action`. `*.view.all` variants let an otherwise
// own-scoped member read a whole domain (a coach may read the full studio calendar
// to avoid clashes, while still only editing their own sessions).
export type Capability =
  // Contacts (scoped)
  | 'contacts.view'
  | 'contacts.manage'
  | 'contacts.delete'
  | 'contacts.view.all'
  // Schedule = sessions / bookings / check-in (scoped)
  | 'schedule.view'
  | 'schedule.manage'
  | 'schedule.view.all'
  // Activities catalogue (unscoped)
  | 'activities.manage'
  // Events (unscoped)
  | 'events.manage'
  // Offerings = subscription types, products, courses, coach availability,
  // affiliation types (unscoped; manager+ today)
  | 'offerings.manage'
  // Outreach templates + automation flows (unscoped; manager+ today)
  | 'outreach.manage'
  // Advanced reports + activity log (unscoped; manager+ today)
  | 'reports.view'
  // Owner-only surfaces (unscoped)
  | 'members.manage'
  | 'team.settings'
  | 'billing.manage'
  | 'integrations.manage'
  | 'plugins.manage'

export type CapabilityDomain =
  | 'contacts'
  | 'schedule'
  | 'activities'
  | 'events'
  | 'offerings'
  | 'outreach'
  | 'reports'
  | 'members'
  | 'team'
  | 'billing'
  | 'integrations'
  | 'plugins'

export interface CapabilityMeta {
  id: Capability
  domain: CapabilityDomain
  // Whether the capability respects DATA SCOPE (own vs all). Unscoped capabilities
  // are team-wide by nature (you either can manage offerings or you can't).
  scoped: boolean
  // i18n key under the `Capabilities` namespace (label shown in the role editor).
  labelKey: string
}

export const CAPABILITY_CATALOG: CapabilityMeta[] = [
  { id: 'contacts.view', domain: 'contacts', scoped: true, labelKey: 'contacts_view' },
  { id: 'contacts.manage', domain: 'contacts', scoped: true, labelKey: 'contacts_manage' },
  { id: 'contacts.delete', domain: 'contacts', scoped: true, labelKey: 'contacts_delete' },
  { id: 'contacts.view.all', domain: 'contacts', scoped: false, labelKey: 'contacts_view_all' },
  { id: 'schedule.view', domain: 'schedule', scoped: true, labelKey: 'schedule_view' },
  { id: 'schedule.manage', domain: 'schedule', scoped: true, labelKey: 'schedule_manage' },
  { id: 'schedule.view.all', domain: 'schedule', scoped: false, labelKey: 'schedule_view_all' },
  { id: 'activities.manage', domain: 'activities', scoped: false, labelKey: 'activities_manage' },
  { id: 'events.manage', domain: 'events', scoped: false, labelKey: 'events_manage' },
  { id: 'offerings.manage', domain: 'offerings', scoped: false, labelKey: 'offerings_manage' },
  { id: 'outreach.manage', domain: 'outreach', scoped: false, labelKey: 'outreach_manage' },
  { id: 'reports.view', domain: 'reports', scoped: false, labelKey: 'reports_view' },
  { id: 'members.manage', domain: 'members', scoped: false, labelKey: 'members_manage' },
  { id: 'team.settings', domain: 'team', scoped: false, labelKey: 'team_settings' },
  { id: 'billing.manage', domain: 'billing', scoped: false, labelKey: 'billing_manage' },
  { id: 'integrations.manage', domain: 'integrations', scoped: false, labelKey: 'integrations_manage' },
  { id: 'plugins.manage', domain: 'plugins', scoped: false, labelKey: 'plugins_manage' },
]

export const ALL_CAPABILITIES: Capability[] = CAPABILITY_CATALOG.map((c) => c.id)

const SCOPED_CAPABILITIES: ReadonlySet<Capability> = new Set(
  CAPABILITY_CATALOG.filter((c) => c.scoped).map((c) => c.id),
)

export function capabilityIsScoped(cap: Capability): boolean {
  return SCOPED_CAPABILITIES.has(cap)
}

// ─── Fixed capability sets for the SYSTEM roles ─────────────────────────────────
// These reproduce today's EFFECTIVE permissions exactly (Phase 1 is behaviour-
// preserving), so migrating a check to a capability is a no-op for these roles:
//   • owner   → everything.
//   • manager → everything except the owner-only surfaces
//     (members / team settings / billing / integrations / plugins).
//   • viewer  → the "any team member" set. NOTE: today any member — viewer included —
//     can create/edit/delete contacts, sessions, activities and events (the
//     Firestore rules gate those on team membership, not role). So `viewer` keeps
//     contacts.manage/delete + schedule.manage here to avoid a regression. Tightening
//     viewer to read-only is now a one-line change to this set (a deliberate future
//     decision, not made here).

// Surfaces only an owner may touch today (team-doc settings, billing, integrations,
// plugin install). NOTE: members.manage is NOT here — managers manage members below
// them via the manageTeamMember callable (rank precedence decides WHO), matching the
// members UI's `canManage = owner || manager`.
const OWNER_ONLY: Capability[] = [
  'team.settings',
  'billing.manage',
  'integrations.manage',
  'plugins.manage',
]

const MANAGER_CAPABILITIES: Capability[] = ALL_CAPABILITIES.filter(
  (c) => !OWNER_ONLY.includes(c),
)

const VIEWER_CAPABILITIES: Capability[] = [
  'contacts.view',
  'contacts.view.all',
  'contacts.manage',
  'contacts.delete',
  'schedule.view',
  'schedule.view.all',
  'schedule.manage',
  'activities.manage',
  'events.manage',
]

export const SYSTEM_ROLE_CAPABILITIES: Record<'owner' | 'manager' | 'viewer', Capability[]> = {
  owner: ALL_CAPABILITIES,
  manager: MANAGER_CAPABILITIES,
  viewer: VIEWER_CAPABILITIES,
}

// ─── Coach role (predefined, team-customizable) ─────────────────────────────────
// Default Coach set: view + manage their OWN contacts and their OWN schedule, plus
// read-only access to the whole studio calendar (schedule.view.all) so they can see
// around clashes. No offerings/members/billing/etc. Scope is `own`. Owners/managers
// can override the set per team (teams/{id}/role_config/coach), never the scope.
export const COACH_DEFAULT_CAPABILITIES: Capability[] = [
  'contacts.view',
  'contacts.manage',
  'schedule.view',
  'schedule.view.all',
  'schedule.manage',
]

// Which capabilities a team may toggle for the Coach role (the customizable menu).
// Owner-only surfaces AND members.manage are intentionally excluded — a coach can
// never be granted members / billing / integrations / plugins / team-settings.
const COACH_NEVER: Capability[] = [...OWNER_ONLY, 'members.manage']
export const COACH_ASSIGNABLE_CAPABILITIES: Capability[] = ALL_CAPABILITIES.filter(
  (c) => !COACH_NEVER.includes(c),
)

// ─── Role rank (member-management PRECEDENCE only) ──────────────────────────────
// NOT a capability hierarchy (a coach is not a superset of a viewer). Used solely to
// decide who may add/edit/remove whom: you can only manage members ranked below you.
export const ROLE_RANK: Record<TeamRole, number> = {
  owner: 4,
  manager: 3,
  coach: 2,
  viewer: 1,
}

// Roles that can be assigned via the members UI / invitations (owner is never
// invitable — ownership transfer is a separate, deliberate flow).
export const ASSIGNABLE_ROLES: TeamRole[] = ['manager', 'coach', 'viewer']

// ─── Pure resolvers ─────────────────────────────────────────────────────────────

/** The DATA SCOPE for a role. Coach is own-scoped; every system role is all-scoped. */
export function dataScopeForRole(role: TeamRole): DataScope {
  return role === 'coach' ? 'own' : 'all'
}

/**
 * The effective capability set for a role. For 'coach', pass the team's override
 * (role_config/coach.capabilities) to honour customization; omit to get the default.
 * Unknown/invalid override entries are ignored.
 */
export function resolveRoleCapabilities(
  role: TeamRole,
  coachOverride?: Capability[] | null,
): Capability[] {
  if (role === 'coach') {
    const base = coachOverride && coachOverride.length ? coachOverride : COACH_DEFAULT_CAPABILITIES
    // Never let an override grant an owner-only capability, whatever is stored.
    return base.filter((c) => COACH_ASSIGNABLE_CAPABILITIES.includes(c))
  }
  return SYSTEM_ROLE_CAPABILITIES[role]
}

/** Does a role (with optional coach override) hold a capability? */
export function roleHasCapability(
  role: TeamRole,
  cap: Capability,
  coachOverride?: Capability[] | null,
): boolean {
  // Owner is always all-capable, defensively, regardless of any stored set.
  if (role === 'owner') return true
  return resolveRoleCapabilities(role, coachOverride).includes(cap)
}

/** Can a member of `actorRole` manage (add/edit/remove) a member of `targetRole`? */
export function canManageRole(actorRole: TeamRole, targetRole: TeamRole): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole]
}

// ─── Per-team role override doc ─────────────────────────────────────────────────
// Stored at teams/{teamId}/role_config/{roleId}. Today only 'coach' is customizable;
// the shape is role-agnostic so custom roles slot in later. `scope` is reserved for
// the future — the Coach role stays own-scoped for now (dataScopeForRole).
export interface RoleConfig {
  role: TeamRole
  capabilities: Capability[]
  scope?: DataScope
  updatedBy?: string
  updated_at?: Timestamp
}
