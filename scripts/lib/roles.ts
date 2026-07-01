/**
 * Shared member-capability helpers for the seed + migration scripts.
 *
 * Mirrors packages/shared/src/types/capabilities.ts (SYSTEM_ROLE_CAPABILITIES,
 * COACH_DEFAULT_CAPABILITIES, dataScopeForRole). Re-declared here because the seed
 * scripts compile under tsconfig.scripts.json, which does not resolve the
 * @linyup/shared workspace import. Keep in sync with that file.
 *
 * Member docs carry these denormalized capabilities + scope so the Firestore rules
 * can gate without extra reads. Writing them here means seeded/migrated teams match
 * what the app writes (via addTeamMember / updateTeamMemberRole), rather than relying
 * on the rules' legacy fallback.
 */

export type MemberRole = 'owner' | 'manager' | 'coach' | 'viewer'

const ALL_CAPABILITIES = [
  'contacts.view',
  'contacts.manage',
  'contacts.delete',
  'contacts.view.all',
  'schedule.view',
  'schedule.manage',
  'schedule.view.all',
  'activities.manage',
  'events.manage',
  'offerings.manage',
  'outreach.manage',
  'reports.view',
  'members.manage',
  'team.settings',
  'billing.manage',
  'integrations.manage',
  'plugins.manage',
]

const OWNER_ONLY = ['team.settings', 'billing.manage', 'integrations.manage', 'plugins.manage']

const SYSTEM_ROLE_CAPABILITIES: Record<'owner' | 'manager' | 'viewer', string[]> = {
  owner: ALL_CAPABILITIES,
  manager: ALL_CAPABILITIES.filter((c) => !OWNER_ONLY.includes(c)),
  // Read-only.
  viewer: ['contacts.view', 'contacts.view.all', 'schedule.view', 'schedule.view.all'],
}

export const COACH_DEFAULT_CAPABILITIES = [
  'contacts.view',
  'contacts.manage',
  'schedule.view',
  'schedule.view.all',
  'schedule.manage',
]

/** Denormalized `capabilities` + `scope` for a member role (mirrors the app). */
export function memberCapsFor(role: MemberRole): { capabilities: string[]; scope: 'all' | 'own' } {
  if (role === 'coach') return { capabilities: COACH_DEFAULT_CAPABILITIES, scope: 'own' }
  const known = SYSTEM_ROLE_CAPABILITIES[role as 'owner' | 'manager' | 'viewer']
  // Unknown/legacy roles fall back to viewer (read-only) — the safe default.
  return { capabilities: known ?? SYSTEM_ROLE_CAPABILITIES.viewer, scope: 'all' }
}
