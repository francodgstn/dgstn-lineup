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
  subscriptionEndsAtMs,
  subscriptionIsCancelling,
  type SubscriptionRollupStatus,
  type ActiveSubscriptionSummary,
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
    // Build the multi-subscription list in the same pass: the LIVE subs (active /
    // trialing / past_due / paused), deduped by the studio's stable type id, keeping the
    // most-live status per type. Refunded duplicates and legacy docs without a type id
    // are skipped.
    const byType = new Map<string, ActiveSubscriptionSummary>()
    for (const d of snap.docs) {
      const data = d.data()
      const s = recordRollupStatus(data)
      if (ROLLUP_PRIORITY.indexOf(s) < ROLLUP_PRIORITY.indexOf(best)) best = s

      const typeId = data.subscriptionTypeId as string | undefined
      const isLive = s === 'active' || s === 'trialing' || s === 'past_due' || s === 'paused'
      if (!typeId || !isLive || data.duplicate) continue
      const existing = byType.get(typeId)
      if (!existing || ROLLUP_PRIORITY.indexOf(s) < ROLLUP_PRIORITY.indexOf(existing.status)) {
        byType.set(typeId, {
          subscription_type_id: typeId,
          subscription_type_name: (data.subscriptionTypeName as string | null) ?? null,
          recurrence: (data.recurrence as string | null) ?? null,
          amount: Math.round((data.amount as number) ?? 0) / 100, // Rappen → major units
          status: s,
          // A subscription that is cancelled but still LIVE stays 'active' here —
          // the member still trains until it lapses. The date is what says it is
          // winding down, and it rides the summary so the member's own Space can
          // show it without reading member_subscriptions (which it cannot).
          cancels_at_ms: subscriptionEndsAtMs(data),
          // …and WHETHER, which the date cannot express on its own: a
          // pre-migration doc is cancelling with no date to give, and a Space
          // keyed only on the date told that member nothing.
          cancelling: subscriptionIsCancelling(data),
        })
      }
    }
    const activeSubscriptions = Array.from(byType.values())

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
