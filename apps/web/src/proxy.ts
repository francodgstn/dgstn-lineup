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

  // Fix locale redirects behind Firebase App Hosting / Cloud Run.
  //
  // The app runs on Cloud Run, which serves the container on :8080. next-intl
  // builds its locale redirect (e.g. /preview → /de/preview for a non-default
  // locale) from the internal request URL, so the container port leaks into the
  // Location header and the browser is sent to `demo.linyup.com:8080`, which is
  // not publicly reachable — the request hangs and fails. The default locale
  // (English, `localePrefix: 'as-needed'`) needs no redirect, which is why only
  // the other languages break. Restore the public authority from the forwarded
  // headers. Gated on their presence so local dev (no proxy → redirects to
  // localhost:3000) is left untouched.
  const location = response.headers.get('location')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (location && (forwardedHost || forwardedProto)) {
    try {
      const url = new URL(location)
      if (url.port) {
        if (forwardedProto) url.protocol = `${forwardedProto}:`
        // A forwarded host carries the public authority (no internal port);
        // otherwise just drop the leaked port off the leaked hostname.
        url.host = forwardedHost ?? url.hostname
        response.headers.set('location', url.toString())
      }
    } catch {
      // Relative Location — no authority/port to correct.
    }
  }

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
