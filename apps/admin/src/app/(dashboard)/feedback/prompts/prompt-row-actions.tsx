'use client'

import { useState, useTransition } from 'react'
import type { FeedbackPromptStatus } from '@linyup/shared'
import { Button } from '@/components/ui/button'
import { activatePrompt, closePrompt } from './actions'

// Lifecycle buttons per prompt row: draft → push, active → close,
// closed → push again.
export function PromptRowActions({ id, status }: { id: string; status: FeedbackPromptStatus }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action(id)
      if (!res.ok) setError(res.error ?? 'Failed.')
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {status !== 'active' && (
        <Button size="sm" disabled={pending} onClick={() => run(activatePrompt)}>
          {status === 'closed' ? 'Push again' : 'Push'}
        </Button>
      )}
      {status === 'active' && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(closePrompt)}>
          Close
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
