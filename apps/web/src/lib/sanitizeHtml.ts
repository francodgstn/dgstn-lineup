import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitize rich-text HTML for safe rendering through `dangerouslySetInnerHTML`.
 *
 * Strips `<script>`, event-handler attributes (`onerror`, `onclick`, …) and
 * `javascript:` URLs while preserving the formatting the editors produce
 * (headings, bold/italic, links, images, lists). `isomorphic-dompurify` runs in
 * both the browser and the Next server render, so a sink is safe whether the HTML
 * arrives via SSR or a client-side fetch.
 *
 * Use this at EVERY sink that renders stored or attacker-influenceable HTML —
 * e.g. course lesson bodies (written client-side, unsanitized) and contact notes
 * (also written by the automation engine). Write-time editor sanitization is not
 * a security control: it is bypassable (a direct Firestore write skips it) and
 * non-editor code paths write these fields too.
 */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html)
}
