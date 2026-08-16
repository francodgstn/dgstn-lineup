// `revokeWaiverAcceptance` — a manager withdrawing a signature they hold.
//
// ── WHY A REVOCATION IS A NEW ROW AND NEVER AN EDIT ─────────────────────────
// The accepted event is untouched, byte for byte. Revoking means the row's
// MEANING changed while its FACTS did not: the person really did read that text
// and tick at that instant, and rewriting the row to say otherwise would destroy
// the evidence the append-only discipline exists to protect. So a revocation is
// a second event that NAMES the first (`revokes_acceptance_id`), and the only
// thing that moves is the one mutable current-state row's `status`.
//
// ── WHY IT IS NOT IN accept.ts, WHICH IS WHERE THE SPEC PUT IT ──────────────
// `accept.ts` is THE ledger writer, imported by every public rail, and it
// deliberately exports no callable at all. A manager-only callable there would
// also put ADMIN refusal codes (`not_signed`, `document_not_found`) into the file
// that `waiverReasons.test.ts` reads as the census of refusals a VISITOR can be
// shown in four languages — two vocabularies with different audiences in one
// module, which is how one ends up rendered to the wrong one. The single-writer
// property is unaffected: this file computes no state and writes no row itself.
// It builds an event and hands it to `recordWaiverEvent`, so `rounds`, the
// precedence rule and the read-then-skip all still live in exactly one place.
//
// ── WHAT A REVOCATION EVENT COPIES, AND FROM WHERE ─────────────────────────
// A revocation describes the same relationship as the acceptance it revokes, so
// its immutable fields are COPIED from that acceptance rather than re-derived —
// re-deriving `subject_name` from today's contact document would file a
// revocation against a name the signature was never taken under. The version's
// own `bodyHash` is the fallback when the acceptance row cannot be read, which is
// a broken-ledger case the verifier reports and a manager must still be able to
// act in: being unable to withdraw a signature because its event row is damaged
// is the worst possible failure mode for this control.

import * as admin from 'firebase-admin'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_ACCEPTANCES_SUBCOLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  contactIdentityKey,
  documentVersionId,
  type DocumentVersion,
  type WaiverAcceptanceEvent,
  type WaiverSignerState,
} from '@linyup/shared'
import { assertManager } from '../connect/access'
import { sha256Hex } from '../utils/crypto'
import { recordWaiverEvent, type WaiverEventInput } from './accept'

function refuse(reason: string, message: string): HttpsError {
  return new HttpsError('failed-precondition', message, { reason })
}

export const revokeWaiverAcceptance = onCall(async (request: CallableRequest<unknown>) => {
  const data = (request.data ?? {}) as {
    documentId?: string
    contactId?: string
    reason?: string
  }
  const documentId = (data.documentId ?? '').trim()
  const contactId = (data.contactId ?? '').trim()
  if (!documentId || !contactId) {
    throw new HttpsError('invalid-argument', 'documentId and contactId are required')
  }
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const db = admin.firestore()
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(documentId)
  const docSnap = await docRef.get()
  if (!docSnap.exists) {
    throw refuse('document_not_found', 'That document no longer exists.')
  }
  const teamId = docSnap.get('teamId') as string
  await assertManager(request.auth.uid, teamId)

  // NO PLAN GATE, deliberately. Retiring is not creating: a downgraded team must
  // always be able to withdraw a signature it holds, exactly as it can turn a
  // requirement off and archive a waiver.

  const signerRef = docRef.collection(DOCUMENT_SIGNERS_SUBCOLLECTION).doc(contactId)
  const signerSnap = await signerRef.get()
  if (!signerSnap.exists) {
    // Nothing to revoke. Refused rather than recorded: the gate already answers
    // `none` for a contact with no row, so an event here would assert that a
    // signature existed to withdraw when none ever did.
    throw refuse('not_signed', 'This person has no signature on this document.')
  }
  const signer = signerSnap.data() as WaiverSignerState
  if (signer.status === 'revoked') {
    // Idempotent in effect anyway — the derived event id is the same and the
    // create is skipped — but saying so is better than a silent success that
    // looks like a second revocation happened.
    throw refuse('already_revoked', 'That signature is already revoked.')
  }

  const [acceptanceSnap, versionSnap] = await Promise.all([
    docRef.collection(DOCUMENT_ACCEPTANCES_SUBCOLLECTION).doc(signer.acceptance_id).get(),
    docRef
      .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
      .doc(documentVersionId(signer.accepted_version))
      .get(),
  ])
  const accepted = acceptanceSnap.exists
    ? (acceptanceSnap.data() as WaiverAcceptanceEvent)
    : null
  const version = versionSnap.exists ? (versionSnap.data() as DocumentVersion) : null
  const bodyHash = accepted?.body_hash ?? version?.bodyHash ?? null
  if (!bodyHash) {
    // Both the event and its version are unreadable. Recording a revocation with
    // no fingerprint would put a hole in the one collection whose value is that
    // every row pins its text.
    throw refuse(
      'ledger_unreadable',
      'This signature’s stored text cannot be read. Run verify-waiver-ledger before revoking it.'
    )
  }

  const identityKey =
    accepted?.identity_key ??
    contactIdentityKey({ email: signer.contact_email ?? null, contactId }, sha256Hex)

  const input: WaiverEventInput = {
    teamId,
    documentId,
    // The version and hash of the signature BEING REVOKED, not of the document's
    // current version — a revocation is about a specific past signature.
    version: signer.accepted_version,
    bodyHash,
    contactId,
    identityKey,
    kind: 'revoked',
    // Derived from the acceptance it revokes, so revoking twice writes ONE row
    // (the read-then-skip turns the replay into a no-op) while a later re-sign
    // and a second revocation get their own, because the re-sign minted a new
    // acceptance id.
    intentId: `rev_${signer.acceptance_id}`,

    // Copied from the acceptance, never re-derived from today's contact.
    signerRole: accepted?.signer_role ?? signer.signer_role,
    signerName: accepted?.signer_name ?? signer.signer_name,
    signerEmail: accepted?.signer_email ?? signer.signer_email,
    signerEmailVerifiedBy: accepted?.signer_email_verified_by ?? signer.signer_email_verified_by,
    subjectName: accepted?.subject_name ?? signer.contact_name,
    subjectEmail: accepted?.subject_email ?? signer.contact_email ?? null,
    validityMonthsAtSigning: accepted?.validity_months_at_signing ?? null,

    // The REVOCATION's own device and instant — this is a manager acting now,
    // not a replay of the signer's tick.
    ip: request.rawRequest?.ip ?? null,
    userAgent: (request.rawRequest?.headers?.['user-agent'] as string | undefined) ?? null,
    locale: null,
    source: 'admin',
    contactName: signer.contact_name,
    contactEmail: signer.contact_email ?? null,

    revokedBy: request.auth.uid,
    revokedReason: (data.reason ?? '').trim().slice(0, 500) || null,
    revokesAcceptanceId: signer.acceptance_id,
  }

  const plan = await recordWaiverEvent(input)
  return { acceptanceId: plan.acceptanceId, revoked: plan.signer?.status === 'revoked' }
})
