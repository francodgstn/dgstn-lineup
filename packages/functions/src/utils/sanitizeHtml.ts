// Shared rich-text HTML sanitizer.
//
// The Tiptap RichTextEditor output is authored by a (semi-trusted) manager, but
// the published/public copy is world-readable, so we run it through an explicit
// tag/attribute allowlist before it ever reaches a public doc. Used by both the
// website publisher (site_published) and the documents plugin's public_profile
// sync — keep the allowlist here so the two never diverge.
import sanitizeHtml from 'sanitize-html'
import { DOCUMENT_LINK_ID_ATTR, DOCUMENT_LINK_VERSION_ATTR } from '@linyup/shared'

// Allowlist matching the RichTextEditor's output (headings, lists, marks,
// blockquote/code, tables, links, images incl. ResizableImage width, and Tiptap
// task lists). Everything else — <script>, styles, event handlers, non-http(s)
// URLs — is stripped.
export const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'strong', 'em', 's', 'u', 'blockquote', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'label', 'input',
  ],
  allowedAttributes: {
    // The two document-link attributes are the whole widening, and they are on
    // `a` alone: they carry a document id and an integer, they are never a URL,
    // and a renderer that ignores them sees an ordinary anchor. Strip them and a
    // link inside a published terms page loses its target for good — the raw
    // body is sanitized on the way INTO the immutable version snapshot, so
    // there is no second chance to recover the reference.
    a: ['href', 'target', 'rel', DOCUMENT_LINK_ID_ATTR, DOCUMENT_LINK_VERSION_ATTR],
    img: ['src', 'alt', 'width', 'height'],
    input: ['type', 'checked', 'disabled'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    '*': ['data-type', 'data-checked'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['http', 'https'] },
}

export function sanitizeRichHtml(html: string): string {
  return html ? sanitizeHtml(html, RICH_TEXT_OPTIONS) : ''
}

/**
 * Allow only absolute http(s) URLs; everything else (javascript:, data:, …) is
 * dropped. Lives here beside the HTML allowlist because it is the same job on
 * the other half of a document — an `external_link` document's URL is what its
 * version snapshot freezes, and the publish callable and the public mirror sync
 * must agree on what a safe URL is.
 */
export function safeExternalUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\/.+/.test(v) ? v.slice(0, 2000) : undefined
}
