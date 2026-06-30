import createMiddleware from 'next-intl/middleware'
import type { NextRequest } from 'next/server'
import { routing } from './i18n/routing'

const handleI18n = createMiddleware(routing)

// Framing policy is owned here (not in next.config headers) so it can branch on
// the path: the public /embed/* widget routes must be framable by any studio's
// own website, while every other route stays frame-denied. next.config headers
// merge rather than override and apply after middleware, so a single path-aware
// place is the only reliable spot to make this distinction.
//
// Demo builds (sandbox) are themselves embedded as a live preview on the landing
// page, so the whole app allows framing from our own origins there.
const isDemoBuild = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
const APP_FRAME_CSP =
  "frame-ancestors 'self' https://linyup.com https://*.linyup.com https://*.web.app http://localhost:* http://127.0.0.1:*"

// Matches /embed/… with or without an as-needed locale prefix (/de/embed/…).
const EMBED_PATH = /^\/(?:(?:de|fr|it)\/)?embed\//

export default function proxy(request: NextRequest) {
  const response = handleI18n(request)
  if (EMBED_PATH.test(request.nextUrl.pathname)) {
    response.headers.set('Content-Security-Policy', 'frame-ancestors *')
  } else if (isDemoBuild) {
    response.headers.set('Content-Security-Policy', APP_FRAME_CSP)
  } else {
    response.headers.set('X-Frame-Options', 'DENY')
  }
  return response
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
}
