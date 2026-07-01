// Shared rich-text HTML sanitizer.
//
// The Tiptap RichTextEditor output is authored by a (semi-trusted) manager, but
// the published/public copy is world-readable, so we run it through an explicit
// tag/attribute allowlist before it ever reaches a public doc. Used by both the
// website publisher (site_published) and the documents plugin's public_profile
// sync — keep the allowlist here so the two never diverge.
import sanitizeHtml from 'sanitize-html'

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
    a: ['href', 'target', 'rel'],
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
