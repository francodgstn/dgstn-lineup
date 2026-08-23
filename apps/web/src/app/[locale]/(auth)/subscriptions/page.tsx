'use client'

/**
 * `/subscriptions` — kept as a REDIRECT, not deleted.
 *
 * The member roster that lived here answered "who holds what", and the payments
 * page's own Subscriptions tab answered "who is Stripe billing". Two lists
 * about the same people, on two screens, neither of them complete: this one
 * knew nothing about renewals, freezes or cancellations, and that one showed
 * nothing at all for a studio taking cash. They are one list now, on
 * `/payments`, keyed by the contact and carrying the billing detail wherever it
 * exists (Franco, 2026-08-23).
 *
 * The route survives because URLs outlive page structures: this page had a
 * dashboard figure pointing at it, a nav row, and whatever bookmarks a studio
 * had made. A redirect costs one file and keeps every one of them working.
 *
 * The invalid `<Link className="contents">` wrapping each `<tr>` went with the
 * old table, so the hydration error this page threw on every render is gone
 * too — the merged list uses a stretched link inside the first cell instead.
 */

import { useEffect } from 'react'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'

export default function SubscriptionsRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    // `replace`, not `push`: this page is a signpost, and Back from the payments
    // page should leave for wherever they actually came from rather than
    // bouncing through the redirect again.
    router.replace('/payments?tab=subscriptions' as Route)
  }, [router])

  return null
}
