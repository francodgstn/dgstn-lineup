/* eslint-disable no-console */
// The far end of self-service studio deletion — see `teams/deleteAccount.ts`
// for the shape and the reasoning. This sweep only executes what was decided
// thirty days earlier; it makes no decisions of its own.
//
// ORDER MATTERS, and it is: detach the Connect link, then erase the tenant,
// then remove the owner's Auth account if it holds nothing else. Erasing first
// would delete the `payments.connectAccountId` this needs to read.
//
// `purgeTeam` does the erasing, so the collection list stays driven by
// TENANT_DATA_COLLECTIONS and there is nothing here to keep in step.

import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION } from '@linyup/shared'
import { purgeTeam } from '../saas-billing/purgeTeam'
import { detachConnectAccount } from '../teams/deleteAccount'

/** A bound, not a target. A sweep that suddenly wants to erase dozens of
 *  tenants is a bug, and this is what keeps the first run of that bug small. */
const MAX_PER_RUN = 10

export interface PurgeScheduledTeamsResult {
  due: number
  purged: number
  usersDeleted: number
}

export async function purgeScheduledTeams(): Promise<PurgeScheduledTeamsResult> {
  const db = admin.firestore()
  const now = Timestamp.now()
  const result: PurgeScheduledTeamsResult = { due: 0, purged: 0, usersDeleted: 0 }

  const dueSnap = await db
    .collection(TEAMS_COLLECTION)
    .where('deletion_scheduled_for', '<=', now)
    .limit(MAX_PER_RUN)
    .get()
  result.due = dueSnap.size

  for (const teamDoc of dueSnap.docs) {
    const teamId = teamDoc.id
    const team = teamDoc.data()

    // Re-read the decision rather than trusting the query: a cancellation that
    // landed between the query and this line must win, because the direction of
    // that mistake is unrecoverable.
    const fresh = await teamDoc.ref.get()
    if (!fresh.exists || !fresh.data()?.deletion_scheduled_for) continue

    const owners = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(TEAM_MEMBERS_SUBCOLLECTION)
      .where('role', '==', 'owner')
      .get()
    const ownerIds = owners.docs.map((d) => d.id)

    const accountId = team.payments?.connectAccountId as string | undefined
    if (accountId) await detachConnectAccount(teamId, accountId)

    try {
      await purgeTeam(teamId, false)
    } catch (err) {
      console.error(`[purgeScheduledTeams] purge ${teamId} failed:`, err)
      continue // left scheduled; tomorrow's run tries again
    }
    result.purged++

    // The person, only if this was their last tenant. An owner who also runs a
    // second studio keeps their login — deleting it would take that one with it.
    for (const uid of ownerIds) {
      const stillOwns = await db
        .collectionGroup(TEAM_MEMBERS_SUBCOLLECTION)
        .where('userId', '==', uid)
        .limit(1)
        .get()
      if (!stillOwns.empty) continue
      await db.collection('users').doc(uid).delete().catch(() => {})
      await admin
        .auth()
        .deleteUser(uid)
        .then(() => {
          result.usersDeleted++
        })
        .catch((err) => console.error(`[purgeScheduledTeams] auth delete ${uid}:`, err))
    }

    console.log(`[purgeScheduledTeams] erased team ${teamId}`)
  }

  return result
}
