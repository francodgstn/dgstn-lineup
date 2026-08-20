'use client'

/**
 * WHICH quick actions this person keeps on their dashboard.
 *
 * Stored in localStorage, per device, exactly like the nav's pins and head tile
 * (`NavPinsContext`) — and for the same reason: it is a preference about how
 * one person likes their own screen, not a fact about the studio. No Firestore
 * write, no schema, nothing for a second manager to fight over.
 *
 * `JSON.parse` on the raw string rather than a bare read, so an EMPTY list
 * (somebody deliberately cleared the bar) is telling apart from an ABSENT key
 * (never chosen, so show the defaults). Getting that wrong is how a cleared bar
 * silently refills itself on the next reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_QUICK_ACTION_IDS, QUICK_ACTION_MAX } from '@/lib/quickActions'

const STORAGE_KEY = 'linyup_dashboard_quick_actions'

export function useQuickActions() {
  const [ids, setIds] = useState<string[]>(DEFAULT_QUICK_ACTION_IDS)
  /**
   * THE LIST AS OF THIS INSTANT, not as of the last render.
   *
   * The picker stays open so five things can be ticked in a row, which means
   * several `toggle` calls land in ONE React batch. Reading `ids` from the
   * closure there gives every call the same pre-batch snapshot, so each one
   * computes "the old list plus my id" and the last write wins: three clicks,
   * one change. Measured — ticking three rows added exactly one.
   *
   * The ref is written synchronously inside `toggle`, so the next call in the
   * same tick composes on the real answer.
   */
  const idsRef = useRef<string[]>(DEFAULT_QUICK_ACTION_IDS)
  // Hydrated after mount, never during render: reading localStorage on the
  // server is undefined and reading it during the first client render is the
  // classic SSR mismatch. The bar shows the defaults for one frame.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const stored = JSON.parse(raw) as unknown
        if (Array.isArray(stored)) {
          const clean = stored.filter((v): v is string => typeof v === 'string')
          idsRef.current = clean
          setIds(clean)
        }
      }
    } catch {
      /* malformed storage is the same as none */
    }
    setHydrated(true)
  }, [])

  const persist = useCallback((next: string[]) => {
    idsRef.current = next
    setIds(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* private mode, quota — the choice just does not survive the session */
    }
  }, [])

  /** Add or remove one. Adding past the cap is REFUSED rather than silently
   *  dropping the oldest: the picker disables the unticked rows at the cap, so
   *  a click that got here anyway is a race, not an instruction. */
  const toggle = useCallback(
    (id: string) => {
      const prev = idsRef.current
      const has = prev.includes(id)
      if (!has && prev.length >= QUICK_ACTION_MAX) return
      persist(has ? prev.filter((v) => v !== id) : [...prev, id])
    },
    [persist]
  )

  return { ids, toggle, hydrated, atMax: ids.length >= QUICK_ACTION_MAX }
}
