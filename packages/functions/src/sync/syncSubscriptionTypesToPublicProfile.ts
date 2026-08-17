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
import {
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  resolveIntroOffer,
  type SubscriptionType,
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
        .where('public', '==', true)
        .where('active', '==', true)
        .get()
    )

    if (queryErr) {
      console.error(`Error fetching subscription types for team ${teamId}:`, queryErr)
      throw queryErr
    }

    // Order by the studio-set `order` (asc), then name. Sorted in memory so docs
    // without an `order` field aren't excluded (a Firestore orderBy would drop
    // them) and no composite index is required. The website pricing table renders
    // this array in order.
    const docsSorted = [...snapshot!.docs].sort((a, b) => {
      const ao = (a.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
      const bo = (b.data().order as number | undefined) ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return String(a.data().name ?? '').localeCompare(String(b.data().name ?? ''))
    })

    // `id` + `included_months` are needed by the public shop checkout (resolves a
    // price by id; one-time prices grant a membership duration). `credits` lets
    // the shop card render "N lessons · valid M months" for credit packs.
    type PublicPrice = {
      id: string
      amount: number
      recurrence: string
      label?: string
      included_months?: number
      credits?: number
      // The plan's INTRO OFFER, resolved (never copied raw): present only when
      // `resolveIntroOffer` says it is sellable, so the public card can never
      // advertise terms the checkout would refuse to apply. Two whitelisted
      // numbers — `amount` is what the member pays per period while it runs
      // (0 = free) and `periods` how many periods that is; `recurrence` and the
      // full price are already on this entry.
      intro?: { periods: number; amount: number }
    }
    const publicTypes = docsSorted.map((d) => {
      const data = d.data()
      // name + description power the website Pricing cards / booking bio-link;
      // prices feed the automatic pricing table. Omit absent fields (no undefined).
      const entry: {
        id: string
        name: string
        description?: string
        checkout_contact_mode?: string
        prices?: PublicPrice[]
      } = {
        id: d.id,
        name: data.name as string,
        // Public-shop contact-capture mode (absent ⇒ 'minimal'); the shop modal reads it.
        checkout_contact_mode: (data.checkout_contact_mode as string | undefined) ?? 'minimal',
      }
      if (typeof data.description === 'string' && data.description) {
        entry.description = data.description
      }
      const prices: PublicPrice[] = (Array.isArray(data.prices) ? data.prices : [])
        .filter(
          (p: { id?: unknown; active?: boolean; amount?: unknown }) =>
            p && p.active !== false && typeof p.amount === 'number' && typeof p.id === 'string'
        )
        .map(
          (p: {
            id: string
            amount: number
            recurrence: string
            label?: string
            included_months?: number
            credits?: number
          }) => {
            const price: PublicPrice = { id: p.id, amount: p.amount, recurrence: p.recurrence }
            if (p.label) price.label = p.label
            if (typeof p.included_months === 'number') price.included_months = p.included_months
            if (typeof p.credits === 'number' && p.credits > 0) price.credits = p.credits
            const intro = resolveIntroOffer(data as SubscriptionType, p.id)
            if (intro) price.intro = { periods: intro.periods, amount: intro.amount }
            return price
          }
        )
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
