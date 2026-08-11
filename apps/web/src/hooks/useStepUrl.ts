'use client'

import { useCallback, useEffect, useRef } from 'react'
import { publicQuery } from '@linyup/shared'

// ─── Wizard step ↔ URL ────────────────────────────────────────────────────────
//
// Gives the public booking funnels a browser history that matches the funnel:
// Back walks one step instead of ejecting the visitor from the flow entirely.
//
// Deliberately raw `history.pushState`, NOT next-intl's `router.push`:
//
//   1. Both booking routes are `force-dynamic`, so a router push would make every
//      step tap an RSC round-trip on a mobile conversion funnel.
//   2. `pushState` re-renders in place — no remount — so the loaded
//      activities/sessions/coaches arrays survive Back and Forward. A router
//      navigation would refetch all of it.
//   3. It is locale-safe by construction: the URL is built from
//      `window.location.pathname`, so whatever prefix the document was served
//      with is preserved. There is no way to drop `/de` here.
//
// Next supports pushState for shallow URL updates in the App Router and keeps
// `useSearchParams()` in sync with it.
//
// INVARIANT: push exactly one entry per step, pop exactly one. Never reason from
// `history.length` — it counts entries this app did not create (the next-intl
// locale redirect, the team root's client redirect), so it cannot tell you
// whether going back stays inside the flow.

export interface UseStepUrlOptions {
  /**
   * Called on `popstate` with the restored query. Re-derive the step from these
   * params; do NOT push from inside it (the hook guards, but don't rely on it).
   */
  onRestore: (params: URLSearchParams) => void
  /**
   * Params that ride along on every entry regardless of step — `from`, `referral`.
   * Losing these on Back would strand the visitor with no return path.
   */
  sticky?: Record<string, string | number | undefined>
  /** Skip all history work (e.g. the flow is running inside an overlay host). */
  disabled?: boolean
}

export interface StepUrl {
  /** New history entry — a forward step. Back returns to the previous one. */
  push: (params: Record<string, string | number | undefined>) => void
  /** Rewrite the current entry — for a step that must not be re-enterable. */
  replace: (params: Record<string, string | number | undefined>) => void
  /**
   * How many restores have happened. A sync effect compares this against the
   * value it last saw: if it changed, this run is the restore's own re-render
   * and must not write back.
   *
   * A counter, not a time window: the obvious `isRestoring` flag cleared on a
   * timer breaks in a backgrounded tab (requestAnimationFrame never fires, so
   * the flag sticks and every later step silently stops updating the URL).
   */
  restoreCount: () => number
}

/** Marks the entries this hook owns, so foreign popstates are ignored. */
const MARKER = 'linyup:step'

export function useStepUrl({ onRestore, sticky, disabled }: UseStepUrlOptions): StepUrl {
  const restoreCountRef = useRef(0)
  // Kept in a ref so the popstate listener never needs re-subscribing (and so a
  // stale closure can't call an old onRestore after a step change).
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore
  const stickyRef = useRef(sticky)
  stickyRef.current = sticky

  const write = useCallback(
    (params: Record<string, string | number | undefined>, mode: 'push' | 'replace') => {
      if (disabled || typeof window === 'undefined') return
      const query = publicQuery({ ...stickyRef.current, ...params })
      const url = `${window.location.pathname}${query}`
      // Already showing it (a restore just applied this exact URL) — writing
      // would add a duplicate entry that Back would have to walk through twice.
      if (url === `${window.location.pathname}${window.location.search}`) return
      // SPREAD the existing state, never replace it: the App Router keeps its
      // route tree in history.state, and clobbering it breaks the next real
      // router navigation and Back out of the flow.
      const state = { ...(window.history.state ?? {}), [MARKER]: true }
      if (mode === 'replace') {
        window.history.replaceState(state, '', url)
      } else {
        window.history.pushState(state, '', url)
      }
    },
    [disabled]
  )

  const push = useCallback(
    (params: Record<string, string | number | undefined>) => write(params, 'push'),
    [write]
  )
  const replace = useCallback(
    (params: Record<string, string | number | undefined>) => write(params, 'replace'),
    [write]
  )

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return
    // Tag the entry the flow was entered on, so the first Back out of step 2
    // restores the entry state rather than being ignored as foreign.
    if (!window.history.state?.[MARKER]) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), [MARKER]: true },
        '',
        `${window.location.pathname}${window.location.search}`
      )
    }

    const handler = (event: PopStateEvent) => {
      // Not ours (a locale redirect, an unrelated router entry) — let it be.
      if (!event.state?.[MARKER]) return
      restoreCountRef.current += 1
      onRestoreRef.current(new URLSearchParams(window.location.search))
    }

    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [disabled])

  const restoreCount = useCallback(() => restoreCountRef.current, [])

  return { push, replace, restoreCount }
}
