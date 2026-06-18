'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { APP_SETTINGS_COLLECTION, PUBLIC_SETTINGS_DOC } from '@linyup/shared'
import { db } from '@/lib/firebase'

// Reads the world-readable signup flag (app_settings/public). This is UX only —
// the real enforcement is the beforeUserCreated blocking function. Defaults to
// CLOSED until the doc loads, so we never flash a signup CTA the server rejects.
export function usePublicSignupEnabled(): { enabled: boolean; loading: boolean } {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ref = doc(db, APP_SETTINGS_COLLECTION, PUBLIC_SETTINGS_DOC)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { public_signup_enabled?: boolean } | undefined
        setEnabled(snap.exists() && data?.public_signup_enabled === true)
        setLoading(false)
      },
      () => {
        // Unreadable → treat as closed (matches the server's fail-closed default).
        setEnabled(false)
        setLoading(false)
      },
    )
    return unsub
  }, [])

  return { enabled, loading }
}

// Recognizes a rejection from the beforeUserCreated blocking function. Firebase
// Auth surfaces a blocked signup as an internal error whose message carries our
// 'signup-closed' sentinel (or a generic BLOCKING_FUNCTION marker). We only have
// one blocking function, so either means "signup is closed".
export function isSignupClosedError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? ''
  return msg.includes('signup-closed') || msg.includes('BLOCKING_FUNCTION')
}
