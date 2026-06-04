/**
 * Syncs aggregator subscription types to the team's public_profile so the
 * booking portal can list them without requiring authentication.
 *
 * Triggered on any write to teams/{teamId}/subscription_types/{typeId}.
 * Reads all active aggregator types for the team and writes the minimal list
 * to teams/{teamId}/public_profile/{teamId}.aggregator_subscription_types.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import {
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
} from '@linyup/shared'


export const syncSubscriptionTypesToPublicProfile = onDocumentWritten(
  `${TEAMS_COLLECTION}/{teamId}/${SUBSCRIPTION_TYPES_SUBCOLLECTION}/{typeId}`,
  async (event) => {
    const { teamId } = event.params
    const db = admin.firestore()

    const publicProfileRef = db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection('public_profile')
      .doc(teamId)

    const [queryErr, snapshot] = await to(
      db
        .collection(TEAMS_COLLECTION)
        .doc(teamId)
        .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
        .where('source', '==', 'aggregator')
        .where('active', '==', true)
        .orderBy('name')
        .get()
    )

    if (queryErr) {
      console.error(`Error fetching subscription types for team ${teamId}:`, queryErr)
      throw queryErr
    }

    const aggregatorTypes = snapshot!.docs.map((d) => ({
      id: d.id,
      name: d.data().name as string,
    }))

    const [updateErr] = await to(
      publicProfileRef.set({ aggregator_subscription_types: aggregatorTypes }, { merge: true })
    )

    if (updateErr) {
      console.error(`Error updating public profile for team ${teamId}:`, updateErr)
      throw updateErr
    }

    console.log(
      `Synced ${aggregatorTypes.length} aggregator subscription type(s) to public profile for team ${teamId}`
    )
  }
)
