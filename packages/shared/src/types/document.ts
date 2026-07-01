import type { Timestamp } from './common'

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
export type DocumentKind = 'terms' | 'privacy' | 'regulation' | 'other'

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
  bodyHtml?: string // SANITIZED HTML — only for source === 'rich_text'
  externalUrl?: string // only for source === 'external_link'
  updated_at: Timestamp // used as the consent "version" stamp
}
