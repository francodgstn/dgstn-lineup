/**
 * Firestore trigger on teams/{teamId}/member_subscriptions/{subscriptionId}.
 * Recomputes the contact-level subscription_status ROLLUP whenever any of the
 * contact's Stripe member subscriptions changes (created, status update, invoice
 * result, pause/resume). The rollup is the "most live" status across all of the
 * contact's subscriptions — the single value the contacts list / detail / automation
 * conditions read. Covers every write path (webhook, invoice, pause/resume callable).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import {
  CONTACTS_COLLECTION,
  TEAMS_COLLECTION,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  type SubscriptionRollupStatus,
} from '@linyup/shared'

// Map a single member_subscription record to a rollup status. A set pause_collection
// wins (a deliberate billing freeze), otherwise the Stripe lifecycle status maps over.
function recordRollupStatus(rec: admin.firestore.DocumentData): SubscriptionRollupStatus {
  if (rec.pause_collection) return 'paused'
  switch (rec.status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'canceled':
    case 'cancelled':
      return 'cancelled'
    default:
      return 'none' // incomplete, incomplete_expired, …
  }
}

// Lower index = "more live". The best (min) across the contact's subscriptions wins.
const ROLLUP_PRIORITY: SubscriptionRollupStatus[] = [
  'active',
  'trialing',
  'past_due',
  'paused',
  'cancelled',
  'none',
]

export const onMemberSubscriptionWrite = onDocumentWritten(
  `${TEAMS_COLLECTION}/{teamId}/${MEMBER_SUBSCRIPTIONS_SUBCOLLECTION}/{subscriptionId}`,
  async (event) => {
    const { teamId } = event.params
    const after = event.data?.after?.data()
    const before = event.data?.before?.data()
    const contactId = (after?.contactId ?? before?.contactId) as string | undefined
    if (!contactId) return

    const db = admin.firestore()
    const snap = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(MEMBER_SUBSCRIPTIONS_SUBCOLLECTION)
      .where('contactId', '==', contactId)
      .get()

    let best: SubscriptionRollupStatus = 'none'
    for (const d of snap.docs) {
      const s = recordRollupStatus(d.data())
      if (ROLLUP_PRIORITY.indexOf(s) < ROLLUP_PRIORITY.indexOf(best)) best = s
    }

    const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
    const contactSnap = await contactRef.get()
    if (!contactSnap.exists || contactSnap.data()?.teamId !== teamId) return
    if (contactSnap.data()?.subscription_status === best) return // idempotent
    await contactRef.update({ subscription_status: best })
  }
)
