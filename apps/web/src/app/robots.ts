import type { MetadataRoute } from 'next'

// Crawler policy, the counterpart to the `robots` metadata in layout.tsx. The
// meta tag only takes effect once a crawler has fetched the page; this stops it
// fetching non-production hosts at all.
//
// Same production test as the layout, and for the same reason — derived from the
// Firebase project so it cannot disagree with which backend the app serves.
//
// Production stays permissive but still hides the authenticated app and the
// per-tenant token URLs: none of it is useful in search, and the invitation and
// contact-update links are effectively capability URLs.
export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'linyup-prod'

  if (!isProduction) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/dashboard',
          '/settings',
          '/contacts',
          '/schedule',
          '/bookings',
          '/payments',
          '/public/event-invitation',
          '/public/team-invitation',
        ],
      },
    ],
  }
}
