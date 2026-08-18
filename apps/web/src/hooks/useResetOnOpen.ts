'use client'

import { useEffect, useRef } from 'react'

/**
 * Seed a dialog's form when it OPENS, and only then.
 *
 * THE TRAP THIS EXISTS FOR: dialogs here are seeded from TanStack Query data,
 * and query results hand back FRESH OBJECT IDENTITIES on every refetch — a
 * window-focus refetch, or an invalidation fired by a mutation the dialog itself
 * triggered. Listing any of them (`event.start`, `config.days`, the item being
 * edited) in an effect's dependency array therefore re-runs the seed at an
 * arbitrary moment and DISCARDS whatever the user was halfway through typing.
 *
 * The callback is held in a ref so it always sees current values without being a
 * dependency, which is what lets the effect depend on `open` alone.
 */
export function useResetOnOpen(open: boolean, seed: () => void): void {
  const seedRef = useRef(seed)
  seedRef.current = seed

  useEffect(() => {
    if (open) seedRef.current()
  }, [open])
}
