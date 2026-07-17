'use client'

import { useState, useTransition } from 'react'
import type { FeedbackStatus } from '@linyup/shared'
import { Button } from '@/components/ui/button'
import { setFeedbackStatus } from './actions'

// Per-status action buttons on the feedback detail page: only the transitions
// away from the current status are offered.
export function StatusActions({ id, status }: { id: string; status: FeedbackStatus }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function apply(next: FeedbackStatus) {
    setError(null)
    startTransition(async () => {
      const res = await setFeedbackStatus(id, next)
      if (!res.ok) setError(res.error ?? 'Failed to update.')
    })
  }

  return (
    <div className="flex items-center gap-2">
      {status !== 'reviewed' && (
        <Button size="sm" disabled={pending} onClick={() => apply('reviewed')}>
          Mark reviewed
        </Button>
      )}
      {status !== 'archived' && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => apply('archived')}>
          Archive
        </Button>
      )}
      {status !== 'new' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => apply('new')}>
          Mark as new
        </Button>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  )
}
