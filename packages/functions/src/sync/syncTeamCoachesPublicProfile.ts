// Maintains teams/{teamId}/public_profile/{teamId}.coaches — an OPT-IN,
// world-readable coach roster (name + optional photo), consumed by the
// organization website's "coaches" aggregate section (see ../orgWebsite). Gated
// by Team.public_coaches_enabled (default off — staff PII stays private until a
// team explicitly opts in).
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION } from '@linyup/shared'
import type { PublicCoach } from '@linyup/shared'

/**
 * Recomputes teams/{teamId}/public_profile/{teamId}.coaches from the team's
 * current roster. Exported so it can be called both from the team_members
 * trigger below AND from syncTeamPublicProfile (so flipping
 * `public_coaches_enabled` on the team doc itself also refreshes the roster).
 *
 * Roster = team_members where `is_coach !== false` (absent ⇒ included — mirrors
 * the /coaches page + listTeamMembers). Name resolution: users/{uid}.displayName
 * → email → uid; photoUrl only when users/{uid}.photoURL is set.
 *
 * Always merges onto public_profile — must never clobber sibling fields written
 * by syncTeamPublicProfile or the other public_profile syncs.
 */
export async function rebuildTeamPublicCoaches(teamId: string): Promise<void> {
  const db = admin.firestore()
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId)
  const profileRef = teamRef.collection('public_profile').doc(teamId)

  const teamSnap = await teamRef.get()
  if (!teamSnap.exists) return // team gone — nothing to rebuild (public_profile is torn down elsewhere)
  const team = teamSnap.data()!

  if (team.public_coaches_enabled !== true) {
    // Not opted in (or opted out again) — clear any previously published roster.
    await profileRef.set({ coaches: FieldValue.delete() }, { merge: true })
    return
  }

  const membersSnap = await teamRef.collection(TEAM_MEMBERS_SUBCOLLECTION).get()
  const coachDocs = membersSnap.docs.filter((d) => d.data().is_coach !== false)

  if (coachDocs.length === 0) {
    await profileRef.set({ coaches: [] }, { merge: true })
    return
  }

  // Bulk-fetch user profiles with getAll() — single RPC regardless of roster size
  // (same pattern as listTeamMembers).
  const userRefs = coachDocs.map((d) => db.collection('users').doc(d.id))
  const userDocs = await db.getAll(...userRefs)
  const userById = new Map(userDocs.map((d) => [d.id, d]))

  const coaches: PublicCoach[] = coachDocs
    .map((memberDoc) => {
      const uid = memberDoc.id
      const userDoc = userById.get(uid)
      const u = userDoc?.exists ? userDoc.data()! : null
      const name = ((u?.displayName as string | undefined) || (u?.email as string | undefined) || uid) as string
      const photoUrl = u?.photoURL as string | undefined
      return photoUrl ? { uid, name, photoUrl } : { uid, name }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  await profileRef.set({ coaches }, { merge: true })
}

// Trigger: any team_members write (member added/removed, role change, is_coach
// flip) refreshes the opt-in public coach roster.
export const syncTeamCoachesPublicProfile = onDocumentWritten(
  'teams/{teamId}/team_members/{memberId}',
  async (event) => {
    const { teamId } = event.params
    await rebuildTeamPublicCoaches(teamId)
  },
)
