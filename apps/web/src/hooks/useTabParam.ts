'use client'

/**
 * THE active tab of a multi-tab surface — held in the URL, never in component
 * state alone.
 *
 * The bug this exists to remove (UX-22): a tab kept only in `useState` is lost
 * by everything that re-enters the page from outside React — a refresh, a
 * pasted link, the browser Back button, a restored open-tab. The user lands on
 * the default tab and has to find their place again, every time. It read as
 * "the app forgot", because it had.
 *
 * The convention is `?tab=` — already what `/settings/team`, `/offer/plans` and
 * the contact detail page used, so this generalises the existing shape rather
 * than inventing a second one. Two consequences worth knowing:
 *
 *  - The URL is kept TRUTHFUL: whatever tab is showing is in the address bar,
 *    including the default one. That is what makes "copy the URL" work at any
 *    moment, and what lets one page deep-link a specific tab of another (UX-71
 *    builds on exactly this).
 *  - The sync is a `history.replaceState`, NOT a router navigation. A tab click
 *    is not a new history entry — Back should leave the page, not walk back
 *    through the tabs the user clicked on the way in. It also means no re-render
 *    of the route tree, and `usePathname()` is query-agnostic so sidebar/tab-strip
 *    active detection is unaffected.
 *
 * An unknown or missing value falls back, so a stale link (a tab that has since
 * been renamed, or one gated off for this user) opens the page rather than an
 * empty pane.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'next/navigation'

export function useTabParam<T extends string>(
  ids: readonly T[],
  fallback: T,
  key = 'tab'
): [T, Dispatch<SetStateAction<T>>] {
  const searchParams = useSearchParams()
  // Read ONCE, at mount. After that the state is the source of truth and the URL
  // follows it — reading `searchParams` on every render would fight the
  // replaceState below (which Next does not observe) and could snap the tab back.
  const [tab, setTab] = useState<T>(() => {
    const p = searchParams.get(key)
    return p && (ids as readonly string[]).includes(p) ? (p as T) : fallback
  })

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get(key) === tab) return
    p.set(key, tab)
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
  }, [key, tab])

  return [tab, setTab]
}
