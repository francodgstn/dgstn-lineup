/**
 * Syncs a team's sellable products to its public_profile so the public shop can
 * list them without authentication.
 *
 * Triggered on any write to teams/{teamId}/products/{productId}. Reads all active
 * products for the team and writes the minimal public list (incl. active variants)
 * to teams/{teamId}/public_profile/{teamId}.products.
 *
 * Mirrors syncSubscriptionTypesToPublicProfile: in-memory sort (no composite
 * index, so products without an `order` aren't dropped) and a merge write so the
 * sibling syncs (aggregator_subscription_types, team doc fields) aren't clobbered.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { to } from '../utils/async'
import { TEAMS_COLLECTION, PRODUCTS_SUBCOLLECTION } from '@linyup/shared'

export const syncProductsToPublicProfile = onDocumentWritten(
  `${TEAMS_COLLECTION}/{teamId}/${PRODUCTS_SUBCOLLECTION}/{productId}`,
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
        .collection(PRODUCTS_SUBCOLLECTION)
        .where('active', '==', true)
        .get()
    )

    if (queryErr) {
      console.error(`Error fetching products for team ${teamId}:`, queryErr)
      throw queryErr
    }

    const docsSorted = [...snapshot!.docs].sort((a, b) => {
      const ao = (a.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
      const bo = (b.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return String(a.data().name ?? '').localeCompare(String(b.data().name ?? ''))
    })

    type PublicVariant = { id: string; label: string; priceAmount?: number }
    type PublicProduct = {
      id: string
      name: string
      description?: string
      imageUrl?: string
      priceAmount: number
      variantLabel?: string
      variants?: PublicVariant[]
    }

    const publicProducts: PublicProduct[] = docsSorted
      .filter((d) => typeof d.data().priceAmount === 'number')
      .map((d) => {
        const data = d.data()
        const entry: PublicProduct = {
          id: d.id,
          name: data.name as string,
          priceAmount: data.priceAmount as number,
        }
        if (typeof data.description === 'string' && data.description) {
          entry.description = data.description
        }
        if (typeof data.imageUrl === 'string' && data.imageUrl) {
          entry.imageUrl = data.imageUrl
        }
        if (typeof data.variantLabel === 'string' && data.variantLabel) {
          entry.variantLabel = data.variantLabel
        }
        const variants: PublicVariant[] = (Array.isArray(data.variants) ? data.variants : [])
          .filter(
            (v: { id?: unknown; label?: unknown; active?: boolean }) =>
              v && v.active !== false && typeof v.id === 'string' && typeof v.label === 'string'
          )
          .map((v: { id: string; label: string; priceAmount?: number }) => {
            const variant: PublicVariant = { id: v.id, label: v.label }
            if (typeof v.priceAmount === 'number') variant.priceAmount = v.priceAmount
            return variant
          })
        if (variants.length) entry.variants = variants
        return entry
      })

    const [updateErr] = await to(
      publicProfileRef.set({ products: publicProducts }, { merge: true })
    )

    if (updateErr) {
      console.error(`Error updating public profile (products) for team ${teamId}:`, updateErr)
      throw updateErr
    }

    console.log(`Synced ${publicProducts.length} product(s) to public profile for team ${teamId}`)
  }
)
