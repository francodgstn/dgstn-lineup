'use client'

import { useEffect, useState } from 'react'

/**
 * SSR-safe media query hook. Returns `false` on the server and during the first
 * client render, then updates after mount. Used to switch between a centered
 * dialog (desktop) and a bottom sheet (mobile) at runtime.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
