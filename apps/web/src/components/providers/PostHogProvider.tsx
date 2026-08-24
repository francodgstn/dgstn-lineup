'use client'

import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { initPostHog, posthog, scrubUrl } from '@/lib/posthog'

// ─── Pageview tracker ────────────────────────────────────────────────────────
// Must be inside Suspense because useSearchParams suspends in App Router.

function PostHogPageView() {
  const pathname  = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (!ph) return
    // Scrubbed here as well as in `sanitize_properties`: this is the one place
    // that BUILDS a URL for analytics rather than reading one PostHog captured,
    // and the scrub reads better next to the concatenation it protects.
    const url = scrubUrl(pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ''))
    ph.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, ph])

  return null
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return (
    <PHProvider client={posthog}>
      <Suspense>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
