'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { posthog } from '@/lib/posthog'

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Report to PostHog so errors surface in the Issues dashboard
    posthog.captureException(error, { digest: error.digest })
    console.error('[error boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. Our team has been notified.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
