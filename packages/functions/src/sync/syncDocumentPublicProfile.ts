// Keeps documents/{documentId}/public_profile/{documentId} in sync — a
// world-readable summary the public document page, the signup consent links and
// any website link render from (the public route never reads the root `documents`
// collection). Mirrors syncFormPublicProfile / syncCoursePublicProfile.
//
// Double-gated: the summary exists ONLY when the document is published AND the
// studio has flipped `isPublic`. THAT GATE IS UNCHANGED FOR EVERY KIND, WAIVERS
// INCLUDED. Widening it for waivers was considered and withdrawn: the
// collection-group rule on `public_profile` grants an unauthenticated `allow
// read`, so a widened mirror would not make a waiver readable to a visitor
// mid-booking — it would make the full text of every studio's liability release
// world-readable and enumerable by anyone, together with its required-ness and
// its settings. A visitor mid-booking gets the text from the requirement
// callable instead, which the consent step has to call anyway.
//
// ── WHERE THE HTML COMES FROM, AND WHY IT IS NOT SANITIZED HERE ─────────────
// The rich text is sanitized ONCE, at publish, and frozen into
// documents/{id}/versions/{v}. This sync COPIES that frozen string. Two
// sanitize calls with a library upgrade between them would silently break every
// acceptance hash — the text a signer read and the text stored as version N have
// to be the same string.
//
// The fallback below is for documents published BEFORE versioning existed, and
// it is a safety net rather than a mode: `scripts/backfill-document-versions.ts`
// is a deploy precondition that mints v1 for every one of them, and
// `scripts/verify-waiver-ledger.ts` keeps `status == 'published' &&
// current_version == null` empty permanently. Without both, this trigger — which
// fires the first time anything touches a legacy document, which is exactly when
// nobody is looking — would blank that document's public page and dead-end the
// signup consent link.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { DOCUMENT_VERSIONS_SUBCOLLECTION, MAX_WAIVER_BODY_CHARS, documentVersionId } from '@linyup/shared'
import { safeExternalUrl, sanitizeRichHtml } from '../utils/sanitizeHtml'
import { touchTeamForSurfaceRecompute } from '../utils/plugins'

// A document counts toward the team's Documents surface when it's published,
// shared publicly, and not archived — mirror the write/delete gate below.
const isLiveDocument = (d?: Record<string, unknown>): boolean =>
  !!d && d.status === 'published' && d.isPublic === true && d.archived_at == null

export const syncDocumentPublicProfile = onDocumentWritten(
  'documents/{documentId}',
  async (event) => {
    const { documentId } = event.params
    const afterRef = event.data!.after.ref
    const beforeData = event.data!.before.data()
    const data = event.data!.after.data()

    // Remove the public profile when the document is deleted, not published, not
    // shared publicly, or archived.
    if (
      !event.data!.after.exists ||
      data?.status !== 'published' ||
      data?.isPublic !== true ||
      data?.archived_at != null
    ) {
      await afterRef.collection('public_profile').doc(documentId).delete()
    } else {
      const isRich = data.source === 'rich_text'
      const currentVersion =
        typeof data.current_version === 'number' ? data.current_version : null

      const publicProfile: Record<string, unknown> = {
        type: 'document',
        teamId: data.teamId,
        slug: data.slug,
        title: data.title || '',
        kind: data.kind || 'other',
        source: data.source,
        summary: data.summary || '',
        version: currentVersion,
        updated_at: data.updated_at ?? event.data!.after.updateTime,
      }

      const versionSnap =
        currentVersion != null
          ? await afterRef
              .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
              .doc(documentVersionId(currentVersion))
              .get()
          : null
      const frozen = versionSnap?.exists ? versionSnap.data()! : null

      if (frozen) publicProfile.bodyHash = (frozen.bodyHash as string) ?? null

      if (isRich) {
        publicProfile.bodyHtml = frozen
          ? ((frozen.bodyHtml as string) ?? '')
          : // Pre-backfill only — see the header. Same call at the same clamp
            // this trigger has always used, so a legacy document's bytes do not
            // change on the way to being versioned.
            sanitizeRichHtml(
              typeof data.body === 'string' ? data.body.slice(0, MAX_WAIVER_BODY_CHARS) : ''
            )
      } else {
        const url = (frozen?.externalUrl as string | undefined) ?? safeExternalUrl(data.externalUrl)
        if (url) publicProfile.externalUrl = url
      }

      await afterRef.collection('public_profile').doc(documentId).set(publicProfile)
    }

    // A document crossing the published/public/archived boundary may flip whether
    // the team's Documents surface is live — nudge the team doc to recompute.
    if (isLiveDocument(beforeData) !== isLiveDocument(data)) {
      const teamId = (data?.teamId ?? beforeData?.teamId) as string | undefined
      if (teamId) await touchTeamForSurfaceRecompute(teamId)
    }
  }
)
