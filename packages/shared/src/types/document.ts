import type { Timestamp } from './common'
import type { WaiverConfig } from './waiver'

// ─── Documents plugin ─────────────────────────────────────────────────────────
//
// A studio's small set of core operational documents — general terms, privacy
// policy, regulations, and the like. NOT a general file manager. Each document is
// authored with the same rich-text editor as the website builder (Tiptap → HTML),
// OR points to an external URL instead. Top-level `documents/{documentId}`
// collection, team-scoped via `teamId` (mirrors the Online Courses `courses` and
// Custom Forms `forms` collections).
//
// A document can be (a) referenced internally — the signup consent checkbox, a
// bio-link page link, a website link — and (b) independently shared as a public
// page + QR code, but ONLY when the studio publishes it AND flips `isPublic`.

export type DocumentStatus = 'draft' | 'published' | 'archived'

// A document is either authored inline (rich text, stored as sanitized-on-publish
// HTML) or a pointer to an external URL the studio already hosts elsewhere.
export type DocumentSource = 'rich_text' | 'external_link'

// Semantic role — drives which documents are suggested for the signup consent
// slot (terms/privacy) and the icon/label shown on cards. 'other' is the catch-all.
//
// 'waiver' is a liability release, and it is the one kind that is not merely
// semantic: a waiver document is CALLABLE-ONLY (firestore.rules denies client
// create, update and delete on it), because its content is somebody's evidence
// and its required-ness is an authorization fact. Its settings live in
// `StudioDocument.waiver` — see types/waiver.ts.
export type DocumentKind = 'terms' | 'privacy' | 'regulation' | 'waiver' | 'other'

export interface StudioDocument {
  id: string
  teamId: string
  orgId?: string // reserved; unset in MVP (mirrors Course.scope)
  title: string
  slug: string // slugify() → <slug>-<4char>
  kind: DocumentKind
  source: DocumentSource
  body?: string // RAW Tiptap HTML — only when source === 'rich_text'
  externalUrl?: string // only when source === 'external_link'
  summary?: string // short description for cards / public header
  status: DocumentStatus
  isPublic: boolean // "share as public page + QR" toggle (needs status 'published')
  order?: number
  created_at: Timestamp
  updated_at: Timestamp
  createdBy: string
  archived_at?: Timestamp | null

  // ── Versioning (Wave 3 Phase 4) ─────────────────────────────────────────────
  /**
   * Highest published version, or null when never published. Written ONLY by
   * `publishDocumentVersion`; `firestore.rules` denies every client write of
   * this field on every kind.
   *
   * A document that is published, or that has ever been published, can never be
   * DELETED — its text may be somebody's evidence. Note that the delete rule
   * keys on `status != 'published'` AS WELL as this field: every document
   * published before Phase 4 has `current_version` unset, so the version clause
   * alone would protect nothing that already carries acceptances.
   */
  current_version?: number | null
  /**
   * The floor a signature must meet to still count. Moved ONLY by a
   * `require_resign` publish; a `silent` publish leaves it alone. This one
   * number is what makes supersession a LAZY DERIVATION (`waiverAcceptanceState`)
   * instead of a bulk write over every signer row.
   */
  min_valid_version?: number | null
  /** `kind === 'waiver'` only. Absent on every other kind, and the booking gate
   *  reads it from `teams/{t}/waiver_policy/current`, never from here. */
  waiver?: WaiverConfig | null
}

// Mirrored to documents/{documentId}/public_profile/{documentId} by
// syncDocumentPublicProfile. World-readable summary the public document page, the
// signup consent links and any website link render from — the public route never
// reads the root `documents` collection. Present ONLY when the document is
// published AND isPublic (double-gated). The HTML in `bodyHtml` is sanitized by
// the sync trigger, so consumers never touch the raw `body`.
export interface DocumentPublicProfile {
  type: 'document'
  teamId: string
  slug: string
  title: string
  kind: DocumentKind
  source: DocumentSource
  summary?: string
  /**
   * The SANITIZED HTML — only for source === 'rich_text'.
   *
   * COPIED FROM THE FROZEN VERSION SNAPSHOT (`documents/{d}/versions/{v}`)
   * rather than re-sanitized from the raw `body`, so the text a signer read and
   * the text stored as version N are the same string. Two sanitize calls with a
   * library upgrade between them would silently break every acceptance hash.
   * (A document published before versioning existed and not yet covered by
   * `scripts/backfill-document-versions.ts` still falls back to sanitizing
   * `body` — see the sync.)
   */
  bodyHtml?: string
  externalUrl?: string // only for source === 'external_link'
  /** The published version this summary was taken from, or null for a document
   *  that predates versioning and has not been backfilled. */
  version?: number | null
  /** sha256 of `bodyHtml`, copied from the version snapshot. */
  bodyHash?: string | null
  /**
   * When the document row was last written.
   *
   * NOT a version stamp. It used to carry a comment claiming it was "used as
   * the consent version stamp"; nothing ever read it that way, and the real
   * version is `version` above — minted by `publishDocumentVersion` and equal to
   * the id of an immutable snapshot.
   */
  updated_at: Timestamp
}
