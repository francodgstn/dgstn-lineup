// Keeps documents/{documentId}/public_profile/{documentId} in sync — a
// world-readable summary the public document page, the signup consent links and
// any website link render from (the public route never reads the root `documents`
// collection). Mirrors syncFormPublicProfile / syncCoursePublicProfile.
//
// Double-gated: the summary exists ONLY when the document is published AND the
// studio has flipped `isPublic`. The rich-text HTML is sanitized HERE (the seam
// between the manager-authored raw `body` and the fully-public copy) so every
// consumer reads sanitized `bodyHtml` and never the raw root doc.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { sanitizeRichHtml } from '../utils/sanitizeHtml'

const MAX_BODY_CHARS = 50000

/** Allow only absolute http(s) URLs; everything else (javascript:, data:, …) is dropped. */
function safeExternalUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\/.+/.test(v) ? v.slice(0, 2000) : undefined
}

export const syncDocumentPublicProfile = onDocumentWritten(
  'documents/{documentId}',
  async (event) => {
    const { documentId } = event.params
    const afterRef = event.data!.after.ref
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
      return
    }

    const isRich = data.source === 'rich_text'

    const publicProfile: Record<string, unknown> = {
      type: 'document',
      teamId: data.teamId,
      slug: data.slug,
      title: data.title || '',
      kind: data.kind || 'other',
      source: data.source,
      summary: data.summary || '',
      updated_at: data.updated_at ?? event.data!.after.updateTime,
    }

    if (isRich) {
      publicProfile.bodyHtml = sanitizeRichHtml(
        typeof data.body === 'string' ? data.body.slice(0, MAX_BODY_CHARS) : ''
      )
    } else {
      const url = safeExternalUrl(data.externalUrl)
      if (url) publicProfile.externalUrl = url
    }

    await afterRef.collection('public_profile').doc(documentId).set(publicProfile)
  }
)
