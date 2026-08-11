'use client'

import { useEffect, useState } from 'react'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'
import { markBookingConfirmed, takeBookingReturn } from '@/lib/bookingReturn'

/**
 * After a successful booking payment, put the buyer back on the page they were
 * booking from — the studio's website with the overlay reopened — instead of the
 * generic "back to booking" link.
 *
 * Rendered only on success; the static CTA behind it stays the fallback for a
 * cold landing, a different tab, or blocked storage. `replace`, not `push`, so
 * Back doesn't return to this interstitial.
 */
export function RestoreBookingReturn() {
  const router = useRouter()
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    const target = takeBookingReturn()
    if (!target) return
    setRestoring(true)
    // This component only renders on a genuine `status=success`, so this is the
    // one place allowed to vouch for the payment. The `booked=1` query alone is
    // not trusted by the host — see markBookingConfirmed.
    markBookingConfirmed()
    const separator = target.includes('?') ? '&' : '?'
    router.replace(`${target}${separator}booked=1` as Route)
  }, [router])

  if (!restoring) return null
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}
