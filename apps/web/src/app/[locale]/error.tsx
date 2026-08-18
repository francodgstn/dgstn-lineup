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
    posthog.captureException(error, { digest: error.digest, boundary: 'locale' })
    console.error('[error boundary]', error)
  }, [error])

  // COPY NOTE: this used to say "Our team has been notified." It is captured
  // above, but into a dashboard with no alerting attached — nobody is notified,
  // and telling a paying customer otherwise is how a bug goes unreported for a
  // week because they assumed we already knew. Say what is true, and ask.
  //
  // Still hardcoded English on a four-locale app: an error inside the layout can
  // leave NextIntlClientProvider unmounted, so `useTranslations` here would throw
  // inside the boundary that exists to catch throwing. Worth revisiting only with
  // a provider-independent way to read messages.
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. Try again — and if it keeps happening, please tell us what you
        were doing.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
