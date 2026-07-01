// Ported from hmd-lineup/functions/src/utils/teams.js — converted to TypeScript
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import type { Team, TeamMember, TeamRole, Capability, DataScope } from '@linyup/shared'
import {
  isReservedSlug,
  ROLE_CONFIG_SUBCOLLECTION,
  ROLE_RANK,
  resolveRoleCapabilities,
  dataScopeForRole,
} from '@linyup/shared'

export async function isAdmin(userId: string): Promise<boolean> {
  const userDoc = await admin.firestore().collection('users').doc(userId).get()
  if (!userDoc.exists) return false
  const roles = userDoc.data()?.roles
  return roles?.admin === true || roles?.superadmin === true
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const doc = await admin.firestore().collection('teams').doc(teamId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as Team
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const snap = await admin.firestore().collection('teams').where('slug', '==', slug).limit(1).get()
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as Team
}

export async function getTeamOwner(teamId: string): Promise<string | null> {
  const snap = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .where('role', '==', 'owner')
    .limit(1)
    .get()
  if (snap.empty) return null
  return snap.docs[0].id
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const snap = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as TeamMember)
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const doc = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .get()
  return doc.exists
}

export async function getTeamRole(userId: string, teamId: string): Promise<TeamRole | null> {
  const doc = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .get()
  if (!doc.exists) return null
  return doc.data()!.role as TeamRole
}

export async function hasTeamRole(
  userId: string,
  teamId: string,
  requiredRole: TeamRole
): Promise<boolean> {
  const role = await getTeamRole(userId, teamId)
  if (!role) return false
  // ROLE_RANK is the single source of member-management precedence (owner > manager
  // > coach > viewer). NOTE: this compares RANK, not capabilities — a coach outranks
  // a viewer here even though its capability set is different. Prefer requireCapability
  // for feature gating; hasTeamRole remains for precedence + legacy call sites.
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole]
}

// ─── Capability resolution + guards ─────────────────────────────────────────────

/** Read a team's Coach role override (teams/{id}/role_config/coach.capabilities). */
async function coachCapabilityOverride(teamId: string): Promise<Capability[] | null> {
  const doc = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection(ROLE_CONFIG_SUBCOLLECTION)
    .doc('coach')
    .get()
  const caps = doc.exists ? doc.data()?.capabilities : null
  return Array.isArray(caps) ? (caps as Capability[]) : null
}

/** Effective capabilities + data scope for a role in a team (honours coach override). */
export async function resolveMemberCapabilities(
  teamId: string,
  role: TeamRole
): Promise<{ capabilities: Capability[]; scope: DataScope }> {
  const override = role === 'coach' ? await coachCapabilityOverride(teamId) : null
  return {
    capabilities: resolveRoleCapabilities(role, override),
    scope: dataScopeForRole(role),
  }
}

/**
 * Does the caller hold `cap` in the team? Prefers the capabilities denormalized on
 * the member doc; falls back to resolving from the role (+ coach override) for
 * members written before the denormalization existed. Owner is always all-capable.
 */
export async function hasCapability(
  userId: string,
  teamId: string,
  cap: Capability
): Promise<boolean> {
  const doc = await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .get()
  if (!doc.exists) return false
  const data = doc.data() as TeamMember
  if (data.role === 'owner') return true
  const caps = Array.isArray(data.capabilities)
    ? data.capabilities
    : (await resolveMemberCapabilities(teamId, data.role)).capabilities
  return caps.includes(cap)
}

/** Throw permission-denied unless the caller holds `cap` in the team. */
export async function requireCapability(
  userId: string,
  teamId: string,
  cap: Capability
): Promise<void> {
  if (!(await hasCapability(userId, teamId, cap))) {
    throw new HttpsError('permission-denied', `Missing capability: ${cap}`)
  }
}

export async function getUserCurrentTeam(userId: string): Promise<string | null> {
  const doc = await admin.firestore().collection('users').doc(userId).get()
  if (!doc.exists) return null
  return doc.data()?.currentTeam || null
}

export async function setUserCurrentTeam(userId: string, teamId: string): Promise<void> {
  const isMember = await isTeamMember(userId, teamId)
  if (!isMember) throw new Error(`User ${userId} is not a member of team ${teamId}`)
  await admin.firestore().collection('users').doc(userId).update({
    currentTeam: teamId,
    currentTeamUpdatedAt: FieldValue.serverTimestamp(),
  })
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole,
  addedBy: string
): Promise<void> {
  const userDoc = await admin.firestore().collection('users').doc(userId).get()
  if (!userDoc.exists) throw new Error(`User ${userId} not found`)

  const { capabilities, scope } = await resolveMemberCapabilities(teamId, role)
  await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .set({
      userId,
      teamId,
      role,
      capabilities,
      scope,
      joined: FieldValue.serverTimestamp(),
      addedBy,
    })
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .delete()
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  newRole: TeamRole
): Promise<void> {
  const { capabilities, scope } = await resolveMemberCapabilities(teamId, newRole)
  await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .update({
      role: newRole,
      capabilities,
      scope,
      roleUpdatedAt: FieldValue.serverTimestamp(),
    })
}

export async function createTeamRecord(
  teamData: {
    name: string
    description?: string
    primaryContact?: string
    settings?: Record<string, unknown>
  },
  ownerId: string
): Promise<string> {
  const teamRef = admin.firestore().collection('teams').doc()
  const teamId = teamRef.id

  // Auto-generate slug from name
  let slug = ''
  if (teamData.name) {
    const baseSlug = teamData.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)

    if (baseSlug.length >= 3) {
      // Ensure the auto-generated slug never equals a reserved literal route
      // segment (e.g. 'booking', 'site', 'team-invitation', 'bio-link').
      const candidateSlug = isReservedSlug(baseSlug)
        ? `${baseSlug.slice(0, 44)}-team`
        : baseSlug

      const existing = await admin
        .firestore()
        .collection('teams')
        .where('slug', '==', candidateSlug)
        .limit(1)
        .get()
      slug = existing.empty
        ? candidateSlug
        : `${candidateSlug.slice(0, 44)}-${teamId.slice(0, 4).toLowerCase()}`
    }
  }

  const defaultLinks = [
    {
      label: 'Book Now',
      description: 'Reserve your spot in a session',
      url: '',
      showInBioLink: true,
      target: 'booking',
    },
    {
      label: 'Membership Signup',
      description: 'Join our community and become a member',
      url: '',
      showInBioLink: true,
      target: 'signup',
    },
  ]

  await teamRef.set({
    name: teamData.name,
    description: teamData.description || '',
    primaryContact: teamData.primaryContact || ownerId,
    settings: teamData.settings || {},
    slug,
    links: defaultLinks,
    created: FieldValue.serverTimestamp(),
    createdBy: ownerId,
  })

  await addTeamMember(teamId, ownerId, 'owner', ownerId)

  const currentTeam = await getUserCurrentTeam(ownerId)
  if (!currentTeam) await setUserCurrentTeam(ownerId, teamId)

  return teamId
}
