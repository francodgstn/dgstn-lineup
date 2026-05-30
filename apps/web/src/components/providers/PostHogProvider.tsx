'use client'

import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { initPostHog, posthog } from '@/lib/posthog'

// ─── Pageview tracker ────────────────────────────────────────────────────────
// Must be inside Suspense because useSearchParams suspends in App Router.

function PostHogPageView() {
  const pathname  = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (!ph) return
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
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
