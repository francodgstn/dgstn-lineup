'use client'

import { useState, useTransition } from 'react'
import { setConnectEnabled } from './actions'

/**
 * Operator toggle for a team's Connect payments kill-switch. ON = the studio may
 * onboard + collect (self-serve default); OFF = blocked. Mirrors the public-signup
 * toggle pattern (optimistic, reverts on error).
 */
export function ConnectToggle({
  teamId,
  initialEnabled,
}: {
  teamId: string
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onToggle() {
    const next = !enabled
    // Disabling an active studio blocks their payments — confirm it.
    if (
      !next &&
      !window.confirm(
        'Disable Connect payments for this studio? They won’t be able to onboard or take new payments.',
      )
    ) {
      return
    }
    setError(null)
    setEnabled(next) // optimistic
    startTransition(async () => {
      const res = await setConnectEnabled(teamId, next)
      if (!res.ok) {
        setEnabled(!next) // revert
        setError(res.error ?? 'Failed to update.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block size-4 transform rounded-full bg-background shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-xs font-medium">{enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
