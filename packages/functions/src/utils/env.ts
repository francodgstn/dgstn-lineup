import { defineString } from 'firebase-functions/params'

export const HOSTING_URL = defineString('HOSTING_URL', {
  description: 'Base URL for hosting (used in links)',
  default: 'https://linyup.com',
})

export function getHostingUrl(): string {
  return HOSTING_URL.value()
}

// Vertex AI serving location for the assistant. Gemini supports the 'global'
// endpoint (no per-region availability concerns); set a specific region in
// .env.{sandbox,staging,production} only if a region-locked model is chosen.
export const VERTEX_LOCATION = defineString('VERTEX_LOCATION', {
  description: 'Vertex AI location (e.g. "global", "europe-west1")',
  default: 'global',
})

export function getVertexLocation(): string {
  return VERTEX_LOCATION.value() || 'global'
}

// Origins we trust to receive a SAME-SESSION return redirect: any linyup.com
// (sub)domain + localhost. Anything else falls back to the env-configured
// HOSTING_URL, so deploys (incl. *.web.app previews) are unaffected.
const TRUSTED_ORIGIN_RE =
  /^(https:\/\/([a-z0-9-]+\.)*linyup\.com|http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/i

/**
 * Base URL for a SAME-SESSION redirect target — Stripe Checkout success/cancel,
 * Connect Account Link return/refresh. Prefers the caller's own origin when it is
 * a trusted Linyup/localhost origin (so local dev returns to localhost) and falls
 * back to the env-configured hosting URL otherwise.
 *
 * Do NOT use this for EMAILED links — those must always use getHostingUrl(), the
 * canonical public URL, since the recipient's browser has no relevant origin.
 */
export function resolveBaseUrl(origin?: string | null): string {
  if (origin) {
    const trimmed = origin.trim().replace(/\/+$/, '')
    if (TRUSTED_ORIGIN_RE.test(trimmed)) return trimmed
  }
  return getHostingUrl()
}
