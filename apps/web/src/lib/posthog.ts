// PostHog browser client — singleton initialised once on the client side.
// Import this only from client components or the PostHogProvider.
// Server Components and API routes should not import this file.

import posthog from 'posthog-js'

export function initPostHog() {
  if (typeof window === 'undefined') return
  if (posthog.__loaded) return

  const key  = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

  if (!key) {
    // Telemetry disabled — key not set (expected in local dev without a PostHog project)
    return
  }

  posthog.init(key, {
    api_host: host,
    // We track pageviews manually via PostHogPageView so the locale route prefix
    // is included in every path before sending.
    capture_pageview: false,
    // Session replay — helps debug UX issues; can be restricted later if needed
    session_recording: {
      maskAllInputs: true,        // never capture passwords or form data
      maskTextSelector: '[data-private]', // opt-in masking for sensitive text nodes
    },
    persistence: 'localStorage+cookie',
    autocapture: true,
  })
}

export { posthog }
