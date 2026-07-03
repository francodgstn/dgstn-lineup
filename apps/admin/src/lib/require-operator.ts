import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase-admin'
import { isOperatorToken } from '@/lib/operators'
import { SESSION_COOKIE } from '@/lib/session'

export interface Operator {
  uid: string
  email: string
}

// Verifies the session cookie cryptographically AND re-checks the allowlist on
// every request (a revoked/removed operator is rejected even with a valid
// cookie). Call at the top of every protected server component / layout.
export async function requireOperator(): Promise<Operator> {
  const jar = await cookies()
  const cookie = jar.get(SESSION_COOKIE)?.value
  if (!cookie) redirect('/login')

  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true)
    if (!decoded.email || !isOperatorToken(decoded)) redirect('/login')
    return { uid: decoded.uid, email: decoded.email }
  } catch {
    redirect('/login')
  }
}
