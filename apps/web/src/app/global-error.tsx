'use client'

import { useEffect } from 'react'
import { posthog } from '@/lib/posthog'

// Global error boundary — catches errors in the root layout itself.
// Cannot use i18n here because NextIntlClientProvider is part of the layout that crashed.
//
// This is the WORST failure class in the app — the root layout crashing
// white-screens every page for every user — and until now it reported nowhere
// but the visitor's own console. The sibling `[locale]/error.tsx` has captured
// to PostHog for a while; this one was missed precisely because it is the
// boundary that fires when everything else is already broken.
//
// `posthog` is imported rather than the `initPostHog()` provider because that
// provider lives in the layout that just crashed. If the key is unset (local
// dev) posthog-js no-ops, and the capture is wrapped so a reporting failure can
// never replace the error screen with a blank one.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      posthog.captureException(error, { digest: error.digest, boundary: 'global' })
    } catch {
      // Reporting must never be the reason the user sees nothing at all.
    }
    console.error('[global error boundary]', error)
  }, [error])

  return (
    <html>
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#6b7280' }}>
            A critical error occurred. Please reload the page.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
