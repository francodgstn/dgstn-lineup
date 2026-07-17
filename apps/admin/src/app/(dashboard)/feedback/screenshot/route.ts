import { cookies } from 'next/headers'
import { adminAuth, adminBucket } from '@/lib/firebase-admin'
import { isOperatorToken } from '@/lib/operators'
import { SESSION_COOKIE } from '@/lib/session'

// Streams a feedback screenshot from Storage via the Admin SDK. This exists
// because (a) clients have no Storage read access to other users' feedback
// files, and (b) signed URLs need iam.signBlob on ADC and don't work against
// the Storage emulator — a server-side download works identically in both.
//
// Auth: same session-cookie + operator check as requireOperator(), but
// returning 401/403 instead of redirect() — this is fetched by an <img> tag,
// where a redirect to /login would just render a broken image.
export async function GET(request: Request): Promise<Response> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value
  if (!cookie) return new Response('Unauthorized', { status: 401 })
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true)
    if (!decoded.email || !isOperatorToken(decoded)) {
      return new Response('Forbidden', { status: 403 })
    }
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  const path = new URL(request.url).searchParams.get('path') ?? ''
  // Screenshots only — no path traversal / arbitrary bucket reads.
  if (!/^feedback\/[^/]+\/[^/]+\.png$/.test(path)) {
    return new Response('Invalid path', { status: 400 })
  }

  try {
    const [buffer] = await adminBucket.file(path).download()
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
