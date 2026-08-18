// Loading what the `consent` filter dimension reads — server side.
//
// ── THE COST SHAPE, WHICH IS THE WHOLE REASON THIS EXISTS ───────────────────
// "Has this contact signed document X" lives at `documents/{X}/signers/{contact}`
// — one row per person, not a field on the contact. Asking it per contact would
// be one read per row of whatever list is being filtered, which is exactly the
// fan-out `matchesFilter` is pure in order to avoid.
//
// So it is loaded the other way round: ONE query per DOCUMENT, returning that
// document's whole signature ledger, and the same map then answers every contact
// in the list, every dynamic-group count and every automation scan. The cost is
// bounded by how many people ever signed that document — never by how many
// contacts are being tested.
//
// The FLOOR comes from the waiver policy where there is one (it is what the gate
// itself compares against) and from the document otherwise, because a
// `require_resign` publish moves that number on every kind — including a
// signup-consent document, which has no policy entry but does have signers.

import * as admin from 'firebase-admin'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  type ConsentLedger,
  type WaiverSignerState,
} from '@linyup/shared'
import { loadWaiverPolicy } from './gate'

/** Above this, somebody is filtering a document with more signatures than any
 *  studio this product is sold to has members — worth saying out loud rather
 *  than truncating, since a truncated ledger reports its missing people as
 *  "never signed" and would have them asked again. */
const LEDGER_SIZE_WARNING = 5000

/**
 * The ledgers for a set of documents, keyed by documentId.
 *
 * A document that cannot be read is OMITTED rather than returned empty: the
 * predicate treats a missing entry as unanswerable and matches nobody, which is
 * the visible failure. An empty ledger would instead report every contact as
 * "never signed" — the confident wrong answer.
 */
export async function loadConsentLedgers(
  teamId: string,
  documentIds: string[]
): Promise<Record<string, ConsentLedger>> {
  if (documentIds.length === 0) return {}
  const db = admin.firestore()
  const policy = await loadWaiverPolicy(teamId)
  const out: Record<string, ConsentLedger> = {}

  for (const documentId of documentIds) {
    try {
      const entry = policy.find((e) => e.documentId === documentId)
      let minValidVersion = entry?.min_valid_version
      if (minValidVersion == null) {
        const docSnap = await db.collection(DOCUMENTS_COLLECTION).doc(documentId).get()
        // Another tenant's document is not this team's to read a ledger from.
        if (!docSnap.exists || docSnap.get('teamId') !== teamId) continue
        minValidVersion = (docSnap.get('min_valid_version') as number | undefined) ?? 0
      }

      const snap = await db
        .collection(DOCUMENTS_COLLECTION)
        .doc(documentId)
        .collection(DOCUMENT_SIGNERS_SUBCOLLECTION)
        .where('teamId', '==', teamId)
        .get()
      if (snap.size > LEDGER_SIZE_WARNING) {
        console.warn(`[waivers] consent ledger for ${documentId} holds ${snap.size} signers`) // eslint-disable-line no-console
      }

      const signers: ConsentLedger['signers'] = {}
      for (const doc of snap.docs) {
        const d = doc.data() as WaiverSignerState
        signers[doc.id] = {
          accepted_version: d.accepted_version,
          accepted_at: d.accepted_at,
          valid_until: d.valid_until ?? null,
          status: d.status,
        }
      }
      out[documentId] = { minValidVersion, signers }
    } catch (err) {
      // Omitted, loudly. See the docblock: matching nobody is the visible
      // failure; matching everybody is the invisible one.
      console.error(`[waivers] failed to load the consent ledger for ${documentId}:`, err) // eslint-disable-line no-console
    }
  }
  return out
}
