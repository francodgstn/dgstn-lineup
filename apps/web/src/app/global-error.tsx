'use client'

import { useEffect } from 'react'

// Global error boundary — catches errors in the root layout itself.
// Cannot use i18n here because NextIntlClientProvider is part of the layout that crashed.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
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
