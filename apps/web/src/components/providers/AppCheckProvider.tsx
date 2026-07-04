'use client'

import { useEffect } from 'react'
import { initAppCheck } from '@/lib/app-check'

// Runs App Check initialization once on the client, before any Cloud Function
// call. Renders nothing. Mounted high in the tree so it covers both the authed
// dashboard and the public checkout/booking routes.
export function AppCheckInit() {
  useEffect(() => {
    initAppCheck()
  }, [])
  return null
}
