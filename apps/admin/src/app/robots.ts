import type { MetadataRoute } from 'next'

// Unconditional, unlike apps/web's equivalent: the operator console is internal
// in every environment, so there is no production case to carve out. Pairs with
// the `robots: { index: false, follow: false }` metadata in layout.tsx — that
// only applies once a crawler has fetched a page, this stops it fetching.
//
// Not a security control (the console is gated by the operator allowlist and a
// session cookie); it just keeps an internal tool out of search results.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] }
}
