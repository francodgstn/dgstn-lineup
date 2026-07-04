// Shared HTML-escaping helper for outbound email bodies.
//
// Email HTML is assembled by string interpolation across many call sites, and
// some of the interpolated values are user-controlled (public form answers,
// contact names, submitter emails). Brevo takes `to`/`subject` as separate API
// fields so there is no SMTP header-injection risk, but unescaped values still
// allow HTML/anchor/style injection into staff-read mail. Escape every
// user-controlled value with this before placing it inside an HTML template.
export function escapeHtml(input: unknown): string {
  if (input == null) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
