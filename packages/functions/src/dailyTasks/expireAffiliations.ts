// Daily task: expire affiliations whose valid_until has passed.
// Scans contacts/*/affiliations (collectionGroup) where active===true and
// valid_until <= now; sets the affiliation to the issuer's "expired" status
// (the status def with isFinal===true && countsAsActive===false) + active:false.
// Keeps the existing batch pattern for Firestore performance.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  CONTACT_AFFILIATIONS_SUBCOLLECTION,
  ORGANIZATIONS_COLLECTION,
  ORG_AFFILIATION_STATUSES_SUBCOLLECTION,
  DEFAULT_ORG_AFFILIATION_STATUSES,
  type Affiliation,
  type OrgAffiliationStatusDef,
  type AffiliationIssuer,
} from '@linyup/shared'

const BATCH_SIZE = 400

// Resolve the "expired" status id for a given issuer/org combination.
// The expired status is: isFinal===true && countsAsActive===false.
// Defaults to 'expired' (the built-in DEFAULT_ORG_AFFILIATION_STATUSES id) if no
// custom org status fits that shape.
async function resolveExpiredStatusId(
  issuer: AffiliationIssuer,
  orgId: string | undefined,
): Promise<string> {
  const fallback = 'expired'

  if (issuer === 'org' && orgId) {
    const db = admin.firestore()
    try {
      const snap = await db
        .collection(ORGANIZATIONS_COLLECTION)
        .doc(orgId)
        .collection(ORG_AFFILIATION_STATUSES_SUBCOLLECTION)
        .get()

      if (!snap.empty) {
        const statuses = snap.docs.map((d) => d.data() as OrgAffiliationStatusDef)
        const expiredDef = statuses.find((s) => s.isFinal && !s.countsAsActive)
        if (expiredDef) return expiredDef.id
      }
    } catch {
      // Best effort — fall through to default
    }
  }

  // Use DEFAULT_ORG_AFFILIATION_STATUSES for team/external or when org lookup fails
  const defaultExpired = DEFAULT_ORG_AFFILIATION_STATUSES.find((s) => s.isFinal && !s.countsAsActive)
  return defaultExpired?.id ?? fallback
}

export async function expireAffiliations(): Promise<{ expired: number }> {
  const db = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const snap = await db
    .collectionGroup(CONTACT_AFFILIATIONS_SUBCOLLECTION)
    .where('active', '==', true)
    .where('valid_until', '<=', now)
    .get()

  if (snap.empty) return { expired: 0 }

  // Group by org_id/issuer to batch the status resolution (avoid N per-doc reads)
  const statusCache = new Map<string, string>()

  async function getExpiredStatus(affiliation: Affiliation): Promise<string> {
    const cacheKey = `${affiliation.issuer}:${affiliation.org_id ?? ''}`
    if (statusCache.has(cacheKey)) return statusCache.get(cacheKey)!
    const statusId = await resolveExpiredStatusId(affiliation.issuer, affiliation.org_id)
    statusCache.set(cacheKey, statusId)
    return statusId
  }

  let count = 0
  let batch = db.batch()

  for (const docSnap of snap.docs) {
    const affiliation = docSnap.data() as Affiliation
    const expiredStatusId = await getExpiredStatus(affiliation)

    batch.update(docSnap.ref, {
      active: false,
      status_id: expiredStatusId,
      updated_at: FieldValue.serverTimestamp(),
    })

    count++
    if (count % BATCH_SIZE === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit()
  }

  return { expired: count }
}
