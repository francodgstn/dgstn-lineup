'use client'

import { useState, useTransition } from 'react'
import { disconnectConnectAccount } from './actions'

/**
 * Sever a team's link to its Stripe connected account.
 *
 * Distinct from the kill-switch above it, and the difference is worth showing:
 * the toggle STOPS charges and is reversible with a click; this REMOVES the
 * link, and the studio would have to onboard again. It is the missing half of
 * tenant teardown — `purgeTeam` cannot do it, which is why its runbook ends in
 * a manual step in the Stripe dashboard.
 *
 * Typed confirmation rather than a `window.confirm`, matching every other
 * irreversible operator action in this console.
 */
export function DisconnectConnect({
  teamId,
  accountId,
}: {
  teamId: string
  accountId: string
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  if (done) {
    return <p className="text-xs text-green-700">Disconnected. The account still exists at Stripe.</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
      >
        Disconnect this account…
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-xs">
        Removes the link between this team and <code className="font-mono">{accountId}</code>. The
        studio would have to onboard again. The account itself is not deleted at Stripe — decide
        what happens to it there separately.
      </p>
      <p className="text-xs text-muted-foreground">
        Type <code className="font-mono">{teamId}</code> to confirm.
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={teamId}
        className="w-64 rounded-md border px-2 py-1 font-mono text-xs"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || confirm.trim() !== teamId}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const res = await disconnectConnectAccount(teamId)
              if (res.ok) setDone(true)
              else setError(res.error ?? 'Failed.')
            })
          }}
          className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50"
        >
          {pending ? 'Disconnecting…' : 'Disconnect'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setConfirm('')
            setError(null)
          }}
          className="rounded-md border px-3 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
