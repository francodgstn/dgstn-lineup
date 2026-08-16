'use client'

// Per-browser sidebar personalisation: which nav items are pinned and which were
// recently visited. Both feed the sidebar's "Shortcuts" group (pinned first, then
// recents) — Firebase-console style. ANY nav destination can be pinned (main nav,
// settings, plugin items), keyed by a stable id. Unpinning demotes an item to a
// recent (it stays in Shortcuts); removeShortcut drops it entirely. Shared via
// context so the sidebar and the /settings rail stay in sync within a tab
// (localStorage's `storage` event only fires across tabs). One-time migration
// from the legacy settings-only key.
//
// Default pins precedence (highest wins): (1) the user's own localStorage pins,
// if the STORAGE_KEY exists at all — even `[]`, an explicit "I unpinned
// everything" — (2) legacy-key migration, which counts as a user pin too, (3)
// the team's seeded `settings.defaultNavPins` (TeamNavDefaults, see
// packages/shared/src/types/team.ts), (4) the hardcoded DEFAULT_PINNED_IDS.
// The team default reuses AuthContext's existing team subscription — no new
// Firestore listener — and is applied in-memory only (never written to
// localStorage) so it can never be mistaken for a deliberate user choice and
// so it keeps tracking the team doc until the user actually makes a choice.
// The instant the user pins/unpins/reorders anything, that choice is
// persisted and wins permanently — see `hasUserPinsRef`.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { DEFAULT_PINNED_IDS } from '@/lib/settings-nav'
import { useAuth } from '@/contexts/AuthContext'
import type { TeamNavDefaults } from '@linyup/shared'

const STORAGE_KEY = 'linyup_nav_pins'
const LEGACY_KEY = 'linyup_settings_pins'
const RECENTS_KEY = 'linyup_nav_recents'
const RECENTS_MAX = 10

function persistPins(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

function persistRecents(ids: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

interface NavPinsValue {
  pinnedIds: string[]
  isPinned: (id: string) => boolean
  togglePin: (id: string) => void
  /** Replace the pin order wholesale (drag-and-drop reordering). */
  setPinOrder: (ids: string[]) => void
  /** Most-recently-visited nav ids, newest first (may include pinned ids). */
  recentIds: string[]
  /** Record a visit to a nav destination (moves it to the front of recents). */
  recordVisit: (id: string) => void
  /** Remove an item from Shortcuts entirely (unpin + drop from recents). */
  removeShortcut: (id: string) => void
  /** Empty Shortcuts: no pins, no recents. */
  clearShortcuts: () => void
}

const NavPinsContext = createContext<NavPinsValue | null>(null)

export function NavPinsProvider({ children }: { children: React.ReactNode }) {
  // Start from defaults; hydrate from localStorage after mount (avoids SSR mismatch).
  const [pinnedIds, setPinnedIds] = useState<string[]>(DEFAULT_PINNED_IDS)
  const [recentIds, setRecentIds] = useState<string[]>([])
  // recordVisit can fire (from the sidebar's pathname effect) before the hydration
  // effect below has loaded stored recents — merge from storage in that window so
  // the first visit of a session never clobbers the history.
  const recentsHydrated = useRef(false)
  // True once we know the user has (or just got, via legacy migration) their own
  // stored pin preference — set either by the localStorage hydration below or by
  // any pin mutation (togglePin/setPinOrder/removeShortcut). While false, the
  // team-default effect is allowed to keep syncing `pinnedIds`; once true, it
  // never touches pinnedIds again, satisfying "user choice wins permanently".
  const hasUserPinsRef = useRef(false)
  // Gates the team-default effect until the (synchronous, but effect-scheduled)
  // localStorage check above has actually run — otherwise a fast team snapshot
  // could apply the team default before we've confirmed there's no user key.
  const [localHydrated, setLocalHydrated] = useState(false)
  // Reused from AuthContext's existing team subscription — no new Firestore read.
  const { team } = useAuth()

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        setPinnedIds(JSON.parse(raw) as string[])
        hasUserPinsRef.current = true
      } else {
        // One-time migration from the settings-only pin key.
        const legacy = localStorage.getItem(LEGACY_KEY)
        if (legacy) {
          const ids = JSON.parse(legacy) as string[]
          setPinnedIds(ids)
          persistPins(ids)
          hasUserPinsRef.current = true
        }
      }
      const recents = localStorage.getItem(RECENTS_KEY)
      if (recents) {
        const stored = JSON.parse(recents) as string[]
        // Keep anything recorded before hydration in front of the stored history.
        setRecentIds((prev) =>
          prev.length ? Array.from(new Set([...prev, ...stored])).slice(0, RECENTS_MAX) : stored
        )
      }
    } catch {
      /* ignore malformed storage */
    }
    recentsHydrated.current = true
    setLocalHydrated(true)
  }, [])

  // Team-seeded default pins (TeamNavDefaults.defaultNavPins): only takes effect
  // while the user has no stored preference of their own. Applied in-memory only
  // (never persisted to localStorage — see file header) so it keeps tracking the
  // team doc (e.g. an updated seed) until the user makes their own choice, at
  // which point hasUserPinsRef flips true and this effect becomes a no-op.
  useEffect(() => {
    if (!localHydrated || hasUserPinsRef.current || !team) return
    const teamDefault = (team.settings as TeamNavDefaults | undefined)?.defaultNavPins
    if (!teamDefault || !teamDefault.length) return
    setPinnedIds((prev) => {
      const same = prev.length === teamDefault.length && prev.every((id, i) => id === teamDefault[i])
      return same ? prev : teamDefault
    })
  }, [team, localHydrated])

  const pushRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      let base = prev
      if (!recentsHydrated.current) {
        try {
          const raw = localStorage.getItem(RECENTS_KEY)
          if (raw) base = Array.from(new Set([...prev, ...(JSON.parse(raw) as string[])]))
        } catch {
          /* ignore */
        }
      }
      if (base[0] === id) return base
      const next = [id, ...base.filter((p) => p !== id)].slice(0, RECENTS_MAX)
      persistRecents(next)
      return next
    })
  }, [])

  const togglePin = useCallback(
    (id: string) => {
      const removing = pinnedIds.includes(id)
      const next = removing ? pinnedIds.filter((p) => p !== id) : [...pinnedIds, id]
      setPinnedIds(next)
      persistPins(next)
      // A deliberate pin change — the team default (if any) never applies again.
      hasUserPinsRef.current = true
      // Firebase-style: unpinning demotes the item to a recent shortcut rather
      // than dropping it from the Shortcuts group (removeShortcut does that).
      if (removing) pushRecent(id)
    },
    [pinnedIds, pushRecent]
  )

  const setPinOrder = useCallback((ids: string[]) => {
    setPinnedIds(ids)
    persistPins(ids)
    hasUserPinsRef.current = true
  }, [])

  /**
   * Clear the whole block.
   *
   * Persists an EMPTY pin list and marks the pins as user-authored, so this
   * reads as "I want none" rather than "I have not chosen yet" — otherwise the
   * team's `settings.defaultNavPins` (or DEFAULT_PINNED_IDS) would flow straight
   * back in and the button would look broken. That precedence is documented at
   * the top of this file; this is the case it exists for.
   */
  const clearShortcuts = useCallback(() => {
    setPinnedIds([])
    persistPins([])
    hasUserPinsRef.current = true
    setRecentIds([])
    persistRecents([])
  }, [])

  const removeShortcut = useCallback(
    (id: string) => {
      if (pinnedIds.includes(id)) {
        const next = pinnedIds.filter((p) => p !== id)
        setPinnedIds(next)
        persistPins(next)
        hasUserPinsRef.current = true
      }
      setRecentIds((prev) => {
        const next = prev.filter((p) => p !== id)
        if (next.length !== prev.length) persistRecents(next)
        return next
      })
    },
    [pinnedIds]
  )

  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds])

  return (
    <NavPinsContext.Provider
      value={{
        pinnedIds,
        isPinned,
        togglePin,
        setPinOrder,
        recentIds,
        recordVisit: pushRecent,
        removeShortcut,
        clearShortcuts,
      }}
    >
      {children}
    </NavPinsContext.Provider>
  )
}

export function useNavPins(): NavPinsValue {
  const ctx = useContext(NavPinsContext)
  if (!ctx) throw new Error('useNavPins must be used within NavPinsProvider')
  return ctx
}
