// ─── Document links — one document pointing at another ───────────────────────
//
// A studio's terms page says "see our house rules"; the house rules are another
// `documents/{id}`. The link stored in the body is a STABLE REFERENCE — the
// target's document id — and never a rendered URL, because both halves of that
// URL are editable: a studio can rename its own slug (`/public/{teamSlug}/…`)
// and a document's slug is re-minted whenever… well, whenever anything mints one.
// A frozen URL inside a published terms page would rot silently, which is the
// one failure mode this feature can actually cause.
//
// THE MODEL, and it is the whole model:
//
//   A link resolves to the target's LATEST version by default. The author may
//   PIN it to a specific version, and pinned means that version.
//
// Nothing else. A link is not frozen at publish time, is not validated at
// publish time, and a waiver's links are not special.
//
// The reference travels as two attributes on an ordinary `<a>`:
//
//   <a data-document-link="{documentId}" data-document-version="3">House rules</a>
//
// with NO href. That baseline matters: any renderer that does not hydrate the
// link — the printed consent export, an email, a `dangerouslySetInnerHTML` that
// never got the team slug — shows the author's words as plain text rather than a
// dead link to nowhere. Hydration turns it into a real anchor; the two
// attributes are on the sanitizer's `a` allowlist so they survive the trip
// through `sanitizeRichHtml` into a version snapshot and the public mirror.

import { publicSubPath } from '../publicRoutes'

/** The document id. Its presence is what marks an anchor as a document link. */
export const DOCUMENT_LINK_ID_ATTR = 'data-document-link'
/** The pinned version, as a decimal integer. ABSENT means "latest". */
export const DOCUMENT_LINK_VERSION_ATTR = 'data-document-version'

/** What is stored in the body. */
export interface DocumentLinkRef {
  documentId: string
  /** `null` ⇒ follow the target's latest published version. */
  version: number | null
  /**
   * The anchor's own text — the target's title at the moment it was inserted.
   *
   * Deliberately NOT refreshed from the target at render time: it sits inside
   * the author's sentence, and silently rewriting somebody's prose because a
   * document was renamed is a worse surprise than a slightly stale name.
   */
  label: string
}

/**
 * What a renderer knows about the target: its world-readable
 * `documents/{id}/public_profile/{id}` summary, or `null` when there isn't one
 * — the document is a draft, was unpublished, was never shared publicly, or is
 * gone. The mirror is double-gated on published AND `isPublic`, so its mere
 * absence is the complete answer to "can a visitor open this?".
 */
export interface DocumentLinkTarget {
  slug: string
  title: string
  /** The published version behind the mirror; `null` for a document that
   *  predates versioning and has not been backfilled. */
  version: number | null
}

export type DocumentLinkResolution =
  | {
      kind: 'link'
      label: string
      /** Unprefixed public path — feed it through the app's own href wrappers. */
      path: string
      /** The version the reader will actually get. */
      version: number | null
      pinned: boolean
    }
  | { kind: 'unavailable'; label: string }

/**
 * Read the version attribute. Anything that is not a positive integer reads as
 * UNPINNED rather than as an error: a mangled attribute should cost the reader
 * the pin, never the link.
 */
export function parseDocumentLinkVersion(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Turn a stored reference plus what is known about the target into something to
 * render. Pure — every surface resolves the same way.
 *
 * The path is rebuilt from the target's CURRENT slug on every render, which is
 * exactly why the reference is an id: rename either slug and the link follows.
 */
export function resolveDocumentLink(
  ref: DocumentLinkRef,
  target: DocumentLinkTarget | null,
  teamSlug: string
): DocumentLinkResolution {
  if (!target || !teamSlug) return { kind: 'unavailable', label: ref.label }
  const pinned = ref.version != null
  return {
    kind: 'link',
    label: ref.label,
    pinned,
    version: pinned ? ref.version : target.version,
    path: publicSubPath(
      teamSlug,
      'documents',
      target.slug,
      pinned ? { v: ref.version ?? undefined } : undefined
    ),
  }
}

/**
 * May this document be linked from the one being edited?
 *
 * A document linking to itself is a loop with no reader: the link lands on the
 * page the reader is already on. Called by BOTH the picker (so the option never
 * appears) and the insert command (so it cannot arrive another way).
 */
export function canInsertDocumentLink(
  candidateId: string,
  currentDocumentId: string
): boolean {
  return !!candidateId && candidateId !== currentDocumentId
}

/** The picker's list: everything but the document being edited, by title. */
export function documentLinkOptions<T extends { id: string; title: string }>(
  documents: T[],
  currentDocumentId: string
): T[] {
  return documents
    .filter((d) => canInsertDocumentLink(d.id, currentDocumentId))
    .sort((a, b) => a.title.localeCompare(b.title))
}
