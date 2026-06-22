/**
 * Denormalises a team's PRIMARY place to its public_profile so public surfaces
 * (the bio-link, which only reads world-readable public_profile) can show the
 * "Main Address" + map without reading the private team_places collection.
 *
 * Triggered on any write to teams/{teamId}/team_places/{placeId}. Picks the place
 * flagged isPrimary (else the first by order/name) and writes its public fields to
 * teams/{teamId}/public_profile/{teamId}.mainAddress (merge), or null when none.
 *
 * Mirrors syncProductsToPublicProfile: in-memory pick (no composite index) + a
 * merge write so sibling syncs (products, aggregator_subscription_types) aren't clobbered.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import { TEAMS_COLLECTION, TEAM_PLACES_SUBCOLLECTION } from '@linyup/shared'

export const syncPrimaryPlaceToPublicProfile = onDocumentWritten(
  `${TEAMS_COLLECTION}/{teamId}/${TEAM_PLACES_SUBCOLLECTION}/{placeId}`,
  async (event) => {
    const { teamId } = event.params
    const db = admin.firestore()

    const publicProfileRef = db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection('public_profile')
      .doc(teamId)

    const [queryErr, snapshot] = await to(
      db.collection(TEAMS_COLLECTION).doc(teamId).collection(TEAM_PLACES_SUBCOLLECTION).get()
    )
    if (queryErr) {
      console.error(`Error fetching places for team ${teamId}:`, queryErr)
      throw queryErr
    }

    const docs = snapshot!.docs
    const primary =
      docs.find((d) => d.data().isPrimary === true) ??
      [...docs].sort((a, b) => {
        const ao = (a.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
        const bo = (b.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
        if (ao !== bo) return ao - bo
        return String(a.data().name ?? '').localeCompare(String(b.data().name ?? ''))
      })[0]

    const mainAddress = primary
      ? {
          name: (primary.data().name as string) ?? '',
          address: (primary.data().address as string | undefined) ?? null,
          mapsLink: (primary.data().mapsLink as string | undefined) ?? null,
        }
      : null

    const [updateErr] = await to(publicProfileRef.set({ mainAddress }, { merge: true }))
    if (updateErr) {
      console.error(`Error updating public profile (mainAddress) for team ${teamId}:`, updateErr)
      throw updateErr
    }

    console.log(`Synced mainAddress (${mainAddress ? 'set' : 'cleared'}) for team ${teamId}`)
  }
)
