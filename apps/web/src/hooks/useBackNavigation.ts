'use client'

// "Back" that actually goes back.
//
// Detail pages used to hardcode their parent list (`router.push('/contacts')`),
// which silently CHANGES CONTEXT: open a contact from the groups page and
// "back" dumps you in the contacts list, losing the group you were working in.
// The same applies to a contact opened from a session, a booking, or search.
//
// So: step back through history when there is in-app history to step back to,
// and fall back to the parent list only when there isn't (a link opened in a
// new tab, a refresh, an inbound deep link) — where `router.back()` would leave
// the app entirely.
//
// Depth is tracked in a module-level counter rather than `window.history.length`
// (which counts entries from before the app was even loaded, so "back" could
// walk out to whatever page linked here) and rather than sessionStorage (which
// survives reloads and would go stale). A full page load resets this module,
// which is exactly right: after a reload there is no in-app history left.

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'

let depth = 0

/** Mount ONCE, high in the authenticated tree. Counts client-side navigations
 *  so `useBack` can tell "there's somewhere to go back to" from "this is where
 *  the session started". */
export function useTrackNavigationDepth() {
  const pathname = usePathname()
  const isFirst = useRef(true)
  useEffect(() => {
    // The first run is the initial render, not a navigation.
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    depth += 1
  }, [pathname])
}

/**
 * @param fallback where to go when there is no in-app history (the page's
 *   natural parent — the list it belongs to).
 * @returns `goBack` and `isHistoryBack`, the latter so a caller can label the
 *   control honestly: "Back" when it steps back, the parent's name when it
 *   navigates there instead.
 */
export function useBack(fallback: Route) {
  const router = useRouter()
  // Read once per render rather than at click time so the LABEL is stable while
  // the page is open — it would otherwise be able to change under the user.
  const isHistoryBack = depth > 0

  const goBack = useCallback(() => {
    if (depth > 0) {
      depth -= 1
      router.back()
    } else {
      router.push(fallback)
    }
  }, [router, fallback])

  return { goBack, isHistoryBack }
}
