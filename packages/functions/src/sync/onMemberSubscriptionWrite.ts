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
  rollupMemberSubscriptions,
} from '@linyup/shared'

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

    // THE rollup lives in @linyup/shared, because the seed fixture writes
    // member_subscriptions through the Admin SDK where no trigger fires and must
    // leave the contact in exactly the state this trigger would.
    const { status: best, activeSubscriptions } = rollupMemberSubscriptions(
      snap.docs.map((d) => d.data())
    )

    const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
    const contactSnap = await contactRef.get()
    if (!contactSnap.exists || contactSnap.data()?.teamId !== teamId) return
    const cur = contactSnap.data() ?? {}
    const statusChanged = cur.subscription_status !== best
    const listChanged =
      JSON.stringify(cur.active_subscriptions ?? []) !== JSON.stringify(activeSubscriptions)
    if (!statusChanged && !listChanged) return // idempotent
    await contactRef.update({
      ...(statusChanged ? { subscription_status: best } : {}),
      ...(listChanged ? { active_subscriptions: activeSubscriptions } : {}),
    })
  }
)
