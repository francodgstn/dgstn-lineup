// Ported from hmd-lineup/functions/src/utils/teams.js — converted to TypeScript
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { Team, TeamMember, TeamRole } from '@linyup/shared'
import { isReservedSlug } from '@linyup/shared'

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
  const hierarchy: Record<TeamRole, number> = { owner: 3, manager: 2, viewer: 1 }
  return hierarchy[role] >= hierarchy[requiredRole]
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
  await admin
    .firestore()
    .collection('teams')
    .doc(teamId)
    .collection('team_members')
    .doc(userId)
    .update({ role: newRole, roleUpdatedAt: FieldValue.serverTimestamp() })
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
      isBookingLink: true,
    },
    {
      label: 'Membership Signup',
      description: 'Join our community and become a member',
      url: '',
      showInBioLink: true,
      isMembershipLink: true,
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
