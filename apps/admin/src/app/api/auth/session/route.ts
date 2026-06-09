import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebase-admin'
import { isOperatorEmail } from '@/lib/operators'
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from '@/lib/session'

// Exchange a Firebase ID token (from client Google sign-in) for an httpOnly
// session cookie — but only for allowlisted operator emails. This is the single
// authorization gate; everything server-side trusts the verified cookie.
export async function POST(request: Request) {
  let idToken: string | undefined
  try {
    const body = (await request.json()) as { idToken?: string }
    idToken = body.idToken
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!idToken) {
    return NextResponse.json({ error: 'missing idToken' }, { status: 400 })
  }

  let decoded
  try {
    decoded = await adminAuth.verifyIdToken(idToken)
  } catch {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  if (!decoded.email || !decoded.email_verified) {
    return NextResponse.json({ error: 'email not verified' }, { status: 403 })
  }
  if (!isOperatorEmail(decoded.email)) {
    return NextResponse.json({ error: 'not an operator' }, { status: 403 })
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  })

  return NextResponse.json({ ok: true })
}

// Sign out — clear the cookie.
export async function DELETE() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}
