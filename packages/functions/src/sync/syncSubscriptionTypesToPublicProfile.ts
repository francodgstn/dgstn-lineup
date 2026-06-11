/**
 * Syncs public subscription types to the team's public_profile so the booking
 * bio-link and the website pricing table can list them without authentication.
 *
 * Triggered on any write to teams/{teamId}/subscription_types/{typeId}.
 * Reads all active types flagged `public` for the team and writes the minimal
 * list (incl. active prices) to
 * teams/{teamId}/public_profile/{teamId}.aggregator_subscription_types.
 * (Field name kept for back-compat; it now means "public", not aggregator-only.)
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import { TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION } from '@linyup/shared'

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
        .where('public', '==', true)
        .where('active', '==', true)
        .orderBy('name')
        .get()
    )

    if (queryErr) {
      console.error(`Error fetching subscription types for team ${teamId}:`, queryErr)
      throw queryErr
    }

    type PublicPrice = { amount: number; recurrence: string; label?: string }
    const publicTypes = snapshot!.docs.map((d) => {
      const data = d.data()
      // name + description power the website Pricing cards / booking bio-link;
      // prices feed the automatic pricing table. Omit absent fields (no undefined).
      const entry: {
        id: string
        name: string
        description?: string
        prices?: PublicPrice[]
      } = {
        id: d.id,
        name: data.name as string,
      }
      if (typeof data.description === 'string' && data.description) {
        entry.description = data.description
      }
      const prices: PublicPrice[] = (Array.isArray(data.prices) ? data.prices : [])
        .filter(
          (p: { active?: boolean; amount?: unknown }) =>
            p && p.active !== false && typeof p.amount === 'number'
        )
        .map((p: { amount: number; recurrence: string; label?: string }) => {
          const price: PublicPrice = { amount: p.amount, recurrence: p.recurrence }
          if (p.label) price.label = p.label
          return price
        })
      if (prices.length) entry.prices = prices
      return entry
    })

    const [updateErr] = await to(
      publicProfileRef.set({ aggregator_subscription_types: publicTypes }, { merge: true })
    )

    if (updateErr) {
      console.error(`Error updating public profile for team ${teamId}:`, updateErr)
      throw updateErr
    }

    console.log(
      `Synced ${publicTypes.length} public subscription type(s) to public profile for team ${teamId}`
    )
  }
)
