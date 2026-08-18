'use client'

/**
 * THE NAV-MEMORY CENSUS — the owner. Add to this list; never copy it.
 *
 * The admin shell remembers where you have been in more than one way, and until
 * 2026-08-18 all of them were called "pin" (UX-23). Two of them still are, in
 * storage; NONE of them is any more, on screen. What exists, and what each one
 * is called where a user can read it:
 *
 * 1. SHORTCUTS — this file. A per-browser list of NAV DESTINATIONS (a page, a
 *    settings screen, a plugin item), keyed by a stable nav id, rendered as the
 *    sidebar's "Shortcuts" group. It has two halves and they are ONE mechanism,
 *    not two:
 *      · ALWAYS SHOWN (`alwaysShownIds`) — hand-curated, drag-ordered, never
 *        truncated, never ages out. Added from a sidebar row, a settings-rail
 *        row or a search result. UI verb: "Always show in shortcuts".
 *      · RECENT (`recentIds`) — an automatic rolling history of the last
 *        RECENTS_MAX destinations visited, the top few listed under the
 *        always-shown ones. No verb: it fills itself.
 *    The control on a row PROMOTES a recent to always-shown (and back); the ×
 *    REMOVES the row from Shortcuts entirely. Icon: a star.
 *
 * 2. OPEN TABS — `contexts/OpenTabsContext.tsx`. The Notion-style strip of
 *    pages you currently have OPEN, including individual records (a contact, a
 *    session). Different question: Shortcuts answers "where do I go often",
 *    Open tabs answers "what am I in the middle of". They are deliberately NOT
 *    merged. A tab may be PINNED, which protects it from Close-others and cap
 *    eviction — the same word every browser uses, and now the only thing in the
 *    app that word means. Icon: a pin.
 *
 * 3. SAVED FILTERS ON THE CONTACTS PAGE — `app/[locale]/(auth)/contacts/page.tsx`.
 *    Not a destination at all: a stored ContactFilter, per TEAM (Firestore, not
 *    localStorage), which may be shown as a chip in the filter bar. It used to
 *    say "Pin to filter bar"; it now says "Show in filter bar".
 *
 * STORED NAMES KEEP THE OLD WORD, deliberately — same policy as plan IDs vs
 * plan display names (see CLAUDE.md): `linyup_nav_pins`, `linyup_settings_pins`
 * and `TeamNavDefaults.defaultNavPins` are machine identifiers written by
 * seeds and by browsers in the wild, and renaming them buys nothing a user can
 * see. The vocabulary a user reads is "shortcuts" / "always show", everywhere.
 *
 * ── Default precedence for the always-shown list (highest wins) ──
 * (1) the user's own localStorage list, if STORAGE_KEY exists at all — even
 * `[]`, an explicit "I cleared everything" — (2) legacy-key migration, which
 * counts as a user choice too, (3) the team's seeded `settings.defaultNavPins`
 * (TeamNavDefaults, see packages/shared/src/types/team.ts), (4) the hardcoded
 * DEFAULT_SHORTCUT_IDS. The team default reuses AuthContext's existing team
 * subscription — no new Firestore listener — and is applied in-memory only
 * (never written to localStorage) so it can never be mistaken for a deliberate
 * user choice and so it keeps tracking the team doc until the user actually
 * makes one. The instant the user adds/removes/reorders anything, that choice
 * is persisted and wins permanently — see `hasUserChoiceRef`.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { DEFAULT_SHORTCUT_IDS } from '@/lib/settings-nav'
import { useAuth } from '@/contexts/AuthContext'
import type { TeamNavDefaults } from '@linyup/shared'

const STORAGE_KEY = 'linyup_nav_pins'
const LEGACY_KEY = 'linyup_settings_pins'
const RECENTS_KEY = 'linyup_nav_recents'
const RECENTS_MAX = 10

function persistAlwaysShown(ids: string[]) {
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
  alwaysShownIds: string[]
  isAlwaysShown: (id: string) => boolean
  toggleAlwaysShown: (id: string) => void
  /** Replace the always-shown order wholesale (drag-and-drop reordering). */
  setShortcutOrder: (ids: string[]) => void
  /** Most-recently-visited nav ids, newest first (may include always-shown ids). */
  recentIds: string[]
  /** Record a visit to a nav destination (moves it to the front of recents). */
  recordVisit: (id: string) => void
  /** Remove an item from Shortcuts entirely (drop from both halves). */
  removeShortcut: (id: string) => void
  /** Empty Shortcuts: nothing always shown, no recents. */
  clearShortcuts: () => void
}

const NavPinsContext = createContext<NavPinsValue | null>(null)

export function NavPinsProvider({ children }: { children: React.ReactNode }) {
  // Start from defaults; hydrate from localStorage after mount (avoids SSR mismatch).
  const [alwaysShownIds, setAlwaysShownIds] = useState<string[]>(DEFAULT_SHORTCUT_IDS)
  const [recentIds, setRecentIds] = useState<string[]>([])
  // recordVisit can fire (from the sidebar's pathname effect) before the hydration
  // effect below has loaded stored recents — merge from storage in that window so
  // the first visit of a session never clobbers the history.
  const recentsHydrated = useRef(false)
  // True once we know the user has (or just got, via legacy migration) their own
  // stored pin preference — set either by the localStorage hydration below or by
  // any pin mutation (toggleAlwaysShown/setShortcutOrder/removeShortcut). While false, the
  // team-default effect is allowed to keep syncing `alwaysShownIds`; once true, it
  // never touches alwaysShownIds again, satisfying "user choice wins permanently".
  const hasUserChoiceRef = useRef(false)
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
        setAlwaysShownIds(JSON.parse(raw) as string[])
        hasUserChoiceRef.current = true
      } else {
        // One-time migration from the settings-only pin key.
        const legacy = localStorage.getItem(LEGACY_KEY)
        if (legacy) {
          const ids = JSON.parse(legacy) as string[]
          setAlwaysShownIds(ids)
          persistAlwaysShown(ids)
          hasUserChoiceRef.current = true
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
  // which point hasUserChoiceRef flips true and this effect becomes a no-op.
  useEffect(() => {
    if (!localHydrated || hasUserChoiceRef.current || !team) return
    const teamDefault = (team.settings as TeamNavDefaults | undefined)?.defaultNavPins
    if (!teamDefault || !teamDefault.length) return
    setAlwaysShownIds((prev) => {
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

  const toggleAlwaysShown = useCallback(
    (id: string) => {
      const removing = alwaysShownIds.includes(id)
      const next = removing ? alwaysShownIds.filter((p) => p !== id) : [...alwaysShownIds, id]
      setAlwaysShownIds(next)
      persistAlwaysShown(next)
      // A deliberate user choice — the team default (if any) never applies again.
      hasUserChoiceRef.current = true
      // Turning "always show" off DEMOTES the row to a recent rather than
      // dropping it from the Shortcuts group (removeShortcut does that).
      if (removing) pushRecent(id)
    },
    [alwaysShownIds, pushRecent]
  )

  const setShortcutOrder = useCallback((ids: string[]) => {
    setAlwaysShownIds(ids)
    persistAlwaysShown(ids)
    hasUserChoiceRef.current = true
  }, [])

  /**
   * Clear the whole block.
   *
   * Persists an EMPTY always-shown list and marks it user-authored, so this
   * reads as "I want none" rather than "I have not chosen yet" — otherwise the
   * team's `settings.defaultNavPins` (or DEFAULT_SHORTCUT_IDS) would flow straight
   * back in and the button would look broken. That precedence is documented at
   * the top of this file; this is the case it exists for.
   */
  const clearShortcuts = useCallback(() => {
    setAlwaysShownIds([])
    persistAlwaysShown([])
    hasUserChoiceRef.current = true
    setRecentIds([])
    persistRecents([])
  }, [])

  const removeShortcut = useCallback(
    (id: string) => {
      if (alwaysShownIds.includes(id)) {
        const next = alwaysShownIds.filter((p) => p !== id)
        setAlwaysShownIds(next)
        persistAlwaysShown(next)
        hasUserChoiceRef.current = true
      }
      setRecentIds((prev) => {
        const next = prev.filter((p) => p !== id)
        if (next.length !== prev.length) persistRecents(next)
        return next
      })
    },
    [alwaysShownIds]
  )

  const isAlwaysShown = useCallback((id: string) => alwaysShownIds.includes(id), [alwaysShownIds])

  return (
    <NavPinsContext.Provider
      value={{
        alwaysShownIds,
        isAlwaysShown,
        toggleAlwaysShown,
        setShortcutOrder,
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
