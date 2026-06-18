'use client'

import { useState, useTransition } from 'react'
import { setPublicSignup } from './actions'

export function PublicSignupToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onToggle() {
    const next = !enabled
    // Opening signups to the public is significant — confirm it.
    if (next && !window.confirm('Open public signup to anyone? New accounts will be allowed.')) {
      return
    }
    setError(null)
    setEnabled(next) // optimistic
    startTransition(async () => {
      const res = await setPublicSignup(next)
      if (!res.ok) {
        setEnabled(!next) // revert
        setError(res.error ?? 'Failed to update.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-background shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-sm font-medium">
          {enabled ? 'Public signup is OPEN' : 'Public signup is CLOSED'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {enabled
          ? 'Anyone can create a Linyup account.'
          : 'Only allowlisted emails (below) can create an account. Existing users can still log in.'}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
