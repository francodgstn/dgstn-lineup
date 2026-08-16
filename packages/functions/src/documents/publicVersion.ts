// `getPublicDocumentVersion` — the frozen text of ONE older version of a
// publicly shared document.
//
// It exists for exactly one reason: a document link may be PINNED, and pinned
// means that version. The public mirror
// (documents/{id}/public_profile/{id}) carries only the LATEST version, so a
// visitor following `…/documents/{slug}?v=2` after the studio published v3 has
// nowhere else to get v2 from — and `documents/{id}/versions/{v}` is
// member-only by rule, which a public route may not read anyway (public routes
// read `public_profile` or call a callable; never a main collection).
//
// ── WHAT IT WILL AND WILL NOT SERVE ─────────────────────────────────────────
// The SAME double gate as the mirror, re-evaluated here rather than inherited:
// published AND `isPublic` AND not archived. A waiver is refused outright — its
// text reaches a signer through `resolveWaiverRequirement` and is deliberately
// absent from every world-readable surface.
//
// It is therefore not a widening: every version it returns belongs to a
// document whose current text is already world-readable at a stable URL. It
// writes nothing and reads nobody.

import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  documentVersionId,
} from '@linyup/shared'

export interface PublicDocumentVersion {
  documentId: string
  version: number
  title: string
  source: 'rich_text' | 'external_link'
  /** The frozen, already-sanitized HTML — `''` for an external-link document. */
  bodyHtml: string
  externalUrl: string | null
}

export const getPublicDocumentVersion = onCall(async (request) => {
  const data = (request.data ?? {}) as { documentId?: unknown; version?: unknown }
  const documentId = typeof data.documentId === 'string' ? data.documentId : ''
  const version = typeof data.version === 'number' ? data.version : NaN

  if (!documentId || documentId.includes('/'))
    throw new HttpsError('invalid-argument', 'documentId is required')
  if (!Number.isSafeInteger(version) || version < 1)
    throw new HttpsError('invalid-argument', 'version must be a positive integer')

  const docRef = admin.firestore().collection(DOCUMENTS_COLLECTION).doc(documentId)
  const snap = await docRef.get()
  const d = snap.data()

  // ONE refusal for every "you cannot have this", so the answer carries no
  // signal about which documents exist.
  const shared =
    snap.exists &&
    !!d &&
    d.status === 'published' &&
    d.isPublic === true &&
    d.archived_at == null &&
    d.kind !== 'waiver'
  if (!shared) throw new HttpsError('not-found', 'Document not available')

  const versionSnap = await docRef
    .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
    .doc(documentVersionId(version))
    .get()
  const v = versionSnap.data()
  if (!versionSnap.exists || !v) throw new HttpsError('not-found', 'Document not available')

  const result: PublicDocumentVersion = {
    documentId,
    version,
    title: (v.title as string) ?? (d!.title as string) ?? '',
    source: v.externalUrl ? 'external_link' : 'rich_text',
    bodyHtml: (v.bodyHtml as string) ?? '',
    externalUrl: (v.externalUrl as string) ?? null,
  }
  return result
})
