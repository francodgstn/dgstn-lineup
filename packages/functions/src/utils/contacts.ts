/**
 * Shared contact query helpers.
 * Extracted from analytics/index.ts to be reusable across functions.
 */
import * as admin from 'firebase-admin'
import { to } from './async'

/**
 * Fetches all active (not deleted, not archived) contacts for a team.
 */
export async function getActiveContacts(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<admin.firestore.DocumentData[]> {
  const [err, snap] = await to(
    db.collection('contacts')
      .where('teamId', '==', teamId)
      .where('deleted_at', '==', null)
      .where('archived_at', '==', null)
      .get(),
  )
  if (err || !snap) return []
  return snap.docs.map((d) => d.data())
}

/**
 * Counts contacts by a given field value.
 * Returns a map of { fieldValue → count }.
 */
export function countByField(
  contacts: admin.firestore.DocumentData[],
  field: string,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of contacts) {
    const val = c[field] as string | undefined
    if (!val) continue
    counts[val] = (counts[val] ?? 0) + 1
  }
  return counts
}

/**
 * Count active contacts by type ('student' | 'external' | 'trial').
 */
export async function countContactsByType(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<Record<string, number>> {
  const contacts = await getActiveContacts(db, teamId)
  return countByField(contacts, 'type')
}

/**
 * Count active contacts by membership_status.
 */
export async function countContactsByMembershipStatus(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<Record<string, number>> {
  const contacts = await getActiveContacts(db, teamId)
  return countByField(contacts, 'membership_status')
}

/**
 * Count active contacts by subscription_type_id.
 */
export async function countContactsBySubscriptionType(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<Record<string, number>> {
  const contacts = await getActiveContacts(db, teamId)
  return countByField(contacts, 'subscription_type_id')
}

/**
 * Count active contacts (with a subscription) by subscription_recurrence.
 */
export async function countContactsByRecurrence(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<Record<string, number>> {
  const contacts = await getActiveContacts(db, teamId)
  return countByField(
    contacts.filter((c) => c.subscription_type_id),
    'subscription_recurrence',
  )
}
