'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// The operator console had NO error boundary at all, which is a bad property for
// the one tool you would reach for while diagnosing a customer incident: a throw
// anywhere in it produced a raw Next.js error page and no record.
//
// There is no client-side telemetry here on purpose — this console is internal,
// behind an operator login, and adding a product-analytics SDK to it would put a
// third-party script next to tenant data for no benefit. SERVER-side throws are
// already covered: the console is SSR on Cloud Run, so they land in Cloud Logging
// and group in Error Reporting like everything else. The console.error below is
// what a CLIENT-side throw leaves behind, and the digest is what ties it to the
// server-side group when the two are the same failure.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ops error boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong in the console</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        This is the ops console, not the customer app — a failure here does not mean studios are
        affected. Check Health for the customer-facing picture.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Error digest <code className="rounded bg-muted px-1 py-0.5">{error.digest}</code> — search
          this in Cloud Logging to find the server-side stack.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <a href="/health" className="text-sm text-muted-foreground underline underline-offset-4">
          Open Health
        </a>
      </div>
    </div>
  )
}
