/**
 * The path mapping between a tenant's own domain and the app's public route
 * tree. Pure functions, no Worker globals — so `scripts/check-paths.ts` can
 * exercise them directly rather than restating them and drifting.
 */

/**
 * Locale prefixes the app emits. `en` is absent on purpose — next-intl runs
 * `localePrefix: 'as-needed'`, so English paths carry no prefix and adding one
 * here would rewrite `/en/shop` into a route that does not exist.
 */
export const LOCALES = new Set(['de', 'fr', 'it'])

/**
 * Paths that are NOT tenant-scoped and must reach the app untouched.
 *
 * `/pay/` is the Stripe return and lives at the app root, not under a surface —
 * rewriting it would strand every payment. `/embed/` is the framable widget
 * endpoint, which carries its own slug already. `/api/` and `/_next/` are
 * framework-owned.
 */
export const PASSTHROUGH_PREFIXES = ['/_next/', '/api/', '/pay/', '/embed/', '/__/']

/** Root files the app serves directly. */
export const PASSTHROUGH_EXACT = new Set([
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/icon.svg',
  '/apple-icon.png',
  '/embed.js',
])

/** Splits a leading locale segment off a path. `/de/shop` → `['de', '/shop']`. */
export function splitLocale(pathname: string): [locale: string, rest: string] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length && LOCALES.has(segments[0])) {
    return [segments[0], '/' + segments.slice(1).join('/')]
  }
  return ['', pathname]
}

export function isPassthrough(pathname: string): boolean {
  const [, rest] = splitLocale(pathname)
  for (const candidate of [pathname, rest]) {
    if (PASSTHROUGH_EXACT.has(candidate)) return true
    if (PASSTHROUGH_PREFIXES.some((p) => candidate.startsWith(p))) return true
  }
  // Anything with a file extension in the last segment — mirrors the app's own
  // middleware matcher, which excludes `.*\..*` for the same reason.
  return /\/[^/]*\.[^/]*$/.test(pathname)
}

/** `/de/shop` → `/de/public/{slug}/shop`; `/` → `/public/{slug}`. */
export function toInternalPath(pathname: string, slug: string): string {
  const [locale, rest] = splitLocale(pathname)
  const prefix = locale ? `/${locale}` : ''
  const tail = rest === '/' ? '' : rest.replace(/\/$/, '')
  return `${prefix}/public/${slug}${tail}`
}

/**
 * The inverse, for redirect `Location` headers coming back from the app:
 * `/de/public/{slug}/shop` → `/de/shop`.
 *
 * Without this, next-intl's locale redirect (`/shop` → `/de/shop`) would send
 * the visitor to a `/public/{slug}/…` URL on their own domain — which this
 * Worker would then rewrite a second time, into `/public/{slug}/public/{slug}/…`.
 */
export function toPublicPath(pathname: string, slug: string): string {
  const [locale, rest] = splitLocale(pathname)
  const marker = `/public/${slug}`
  if (!rest.startsWith(marker)) return pathname
  const tail = rest.slice(marker.length) || '/'
  return locale ? `/${locale}${tail}` : tail
}
