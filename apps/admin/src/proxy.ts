import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

// Presence check only (no crypto — that happens server-side in requireOperator).
// Redirects unauthenticated requests to /login. Renamed from middleware.ts per
// the Next.js 16 proxy convention (runs on the nodejs runtime).
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE)
  if (!hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // Protect everything except the login page, the auth API, Next internals,
  // and static assets.
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
}
