// Recompute the denormalized capabilities on team members when a team's role
// override changes. Members carry capabilities[]/scope on their doc so Firestore
// rules can gate without extra reads; when an owner/manager edits the Coach role's
// capability set (teams/{teamId}/role_config/coach), every coach member's cached
// set must be recomputed to match.
import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  resolveRoleCapabilities,
  dataScopeForRole,
  type Capability,
  type TeamRole,
} from '@linyup/shared'

export const syncMemberCapabilities = onDocumentWritten(
  'teams/{teamId}/role_config/{roleId}',
  async (event) => {
    const { teamId, roleId } = event.params as { teamId: string; roleId: string }
    // role_config docs are keyed by the role id they customize (today: 'coach').
    const role = roleId as TeamRole

    const after = event.data?.after
    const override = (after?.exists ? (after.data()?.capabilities as Capability[] | undefined) : null) ?? null
    const capabilities = resolveRoleCapabilities(role, override)
    const scope = dataScopeForRole(role)

    const db = admin.firestore()
    const membersSnap = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(TEAM_MEMBERS_SUBCOLLECTION)
      .where('role', '==', role)
      .get()

    if (membersSnap.empty) return

    const batch = db.batch()
    for (const doc of membersSnap.docs) {
      batch.update(doc.ref, { capabilities, scope })
    }
    await batch.commit()
  }
)
