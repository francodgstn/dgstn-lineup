// Sync trigger: recomputes Contact.credit_summary whenever any credit grant
// under contacts/{contactId}/credit_grants/{grantId} is written/deleted. Only
// non-exhausted, non-expired grants contribute; the summary is what the contacts
// list, the booking access gate and the Space read without touching the
// subcollection. (Expiry mid-life is caught lazily: bookSession re-checks
// expires_at on spend, and any subsequent grant write recomputes the rollup.)

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import {
  CONTACTS_COLLECTION,
  CONTACT_CREDIT_GRANTS_SUBCOLLECTION,
  type CreditGrant,
  type CreditSummaryEntry,
} from '@linyup/shared'

/** Pure rollup: grants → per-type balances. Exported for unit tests. */
export function buildCreditSummary(
  grants: CreditGrant[],
  now: Date = new Date(),
): CreditSummaryEntry[] {
  const byType = new Map<string, CreditSummaryEntry>()
  for (const g of grants) {
    const remaining = (g.credits_total ?? 0) - (g.credits_used ?? 0)
    if (remaining <= 0) continue
    const expiresAt = g.expires_at ?? null
    if (expiresAt && (expiresAt as Timestamp).toDate() <= now) continue
    const entry = byType.get(g.subscription_type_id) ?? {
      subscription_type_id: g.subscription_type_id,
      subscription_type_name: g.subscription_type_name ?? null,
      remaining: 0,
      next_expires_at: null,
    }
    entry.remaining += remaining
    // Track the soonest upcoming expiry across contributing grants.
    if (expiresAt) {
      const cur = entry.next_expires_at as Timestamp | null
      if (!cur || (expiresAt as Timestamp).toMillis() < cur.toMillis()) {
        entry.next_expires_at = expiresAt
      }
    }
    if (!entry.subscription_type_name && g.subscription_type_name) {
      entry.subscription_type_name = g.subscription_type_name
    }
    byType.set(g.subscription_type_id, entry)
  }
  return [...byType.values()].sort((a, b) =>
    a.subscription_type_id.localeCompare(b.subscription_type_id),
  )
}

export const onCreditGrantWrite = onDocumentWritten(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_CREDIT_GRANTS_SUBCOLLECTION}/{grantId}`,
  async (event) => {
    const { contactId } = event.params

    const db = admin.firestore()
    const [snapErr, grantsSnap] = await to(
      db
        .collection(CONTACTS_COLLECTION)
        .doc(contactId)
        .collection(CONTACT_CREDIT_GRANTS_SUBCOLLECTION)
        .get(),
    )
    if (snapErr) {
      console.error(`[onCreditGrantWrite] failed to load grants for ${contactId}:`, snapErr) // eslint-disable-line no-console
      return
    }

    const grants = (grantsSnap?.docs ?? []).map((d) => ({ ...d.data(), id: d.id }) as CreditGrant)
    const summary = buildCreditSummary(grants)

    const [updateErr] = await to(
      db.collection(CONTACTS_COLLECTION).doc(contactId).update({
        credit_summary: summary,
        updated_at: FieldValue.serverTimestamp(),
      }),
    )
    if (updateErr) {
      console.error(`[onCreditGrantWrite] failed to update credit_summary for ${contactId}:`, updateErr) // eslint-disable-line no-console
    }
  },
)
