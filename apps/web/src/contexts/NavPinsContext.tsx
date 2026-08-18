'use client'

/**
 * THE NAV-MEMORY CENSUS — the owner. Add to this list; never copy it.
 *
 * The admin shell remembers where you have been in more than one way, and until
 * 2026-08-18 all of them were called "pin" (UX-23). Two of them still are, in
 * storage. On screen the word survives on open tabs alone, and the pin GLYPH on
 * exactly ONE model — "keep this within reach" — worn by open tabs and by the
 * Shortcuts group's curated half; the saved-filter sense is gone entirely. What
 * exists, and what each one is called where a user can read it:
 *
 * 1. SHORTCUTS — this file. A per-browser list of NAV DESTINATIONS (a page, a
 *    settings screen, a plugin item), keyed by a stable nav id, rendered as the
 *    sidebar's "Shortcuts" group. It has two halves and they are ONE mechanism,
 *    not two:
 *      · ALWAYS SHOWN (`alwaysShownIds`) — hand-curated, drag-ordered, never
 *        truncated, never ages out. Added from a sidebar row, a settings-rail
 *        row or a search result. UI verb: "Always show in shortcuts". The row
 *        wears its pin FILLED and at rest — which, with no heading and no divider
 *        anywhere in the group, is the ONLY thing that marks a row as belonging to
 *        this run (see the vocabulary note at the end of this item).
 *      · RECENT (`recentIds`) — an automatic rolling history of the last
 *        RECENTS_MAX destinations visited, listed under the always-shown ones
 *        and truncated behind "Show more". No verb: it fills itself.
 *    The control on a row PROMOTES a recent to always-shown (and back); the ×
 *    REMOVES the row from Shortcuts entirely. Icon: a pin, filled while on.
 *
 *    TWO RUNS, ORDERED, MARKED AS ONE REGION BY A LEFT RULE (2026-08-18):
 *    always-shown first, recent after, under the one "Shortcuts" heading, with a
 *    thin flat brand-violet rule down the left edge of the whole area — heading,
 *    both runs and the empty-state hint. NOTHING HARD SEPARATES THE RUNS: no
 *    sub-headings, no divider. Both were built here first, on the same day, and
 *    both were removed:
 *      · sub-headings ("Pinned" / "Recent") — they restate what the rows already
 *        say, and they put a noun in front of a verb that disagrees with it (see
 *        the vocabulary note below).
 *      · a hairline between the runs — it competed with the region marker for the
 *        one job of marking this area out, and lost.
 *    THE RULE IS NOT THE ORIGINAL RULE, and the difference is the entire point of
 *    this pass. The original was a `before:` pseudo-element on a padded wrapper:
 *    it reserved layout width, so every shortcut row sat 12px right of every other
 *    nav row, and it carried a vertical gradient that read as noise. The
 *    replacement is absolutely positioned, flat and a hairline wide — same signal,
 *    no indent, no ramp. (A horizontal background wash over the whole area was
 *    tried in between and rejected: it grew with the list and read as a highlight
 *    rather than a boundary.) It sits in `nav`'s own left padding, NOT at the
 *    content edge the rows start from, so an active row's background has a few px
 *    of air rather than butting against it. If anything here is ever re-styled,
 *    THOSE are the two constraints to preserve: the marker must not consume width,
 *    and any breathing room it needs comes out of the gutter, never out of the
 *    rows — which is also the only thing keeping every nav link in the sidebar on
 *    one 8px left offset (verified live across all 19).
 *
 *    What carries the split now that no line does — all three already existed:
 *      1. ORDER. Pinned first, always.
 *      2. THE PIN. Filled and visible at rest on a pinned row; hover-only on a
 *         recent one. Two adjacent rows are tellable apart without reading.
 *      3. THE MOVE. Pinning re-renders the row at the end of the pinned run, so
 *         the promotion is SEEN. With no line to cross this motion is the whole
 *         story, which is why the two runs are derived from `alwaysShownIds` on
 *         every render and never snapshotted. Unpinning moves it back rather than
 *         dropping it (that is the ×).
 *    Other consequences worth keeping:
 *      · ONE heading level, which "Clear all" needs — it empties both halves in
 *        one action, so it belongs to the group, not to either run.
 *      · The empty state is ruled too. A region that stopped being marked exactly
 *        when the hint explaining it appears would be marking the wrong thing.
 *      · DRAG REORDERS WITHIN THE PINNED RUN ONLY. Recent is ordered by last
 *        visit, so a manual placement there could not be stored and the next
 *        navigation would undo it; and dragging from one run to the other is not
 *        offered because promotion already has one visible, reversible affordance
 *        (the pin), and an accidental drop is a poor second one. A reorder is
 *        applied to the STORED list, so a pinned destination that is currently
 *        gated off (and therefore not rendered) survives it.
 *      · The collapsed icon rail is unchanged: the same rows in the same order,
 *        no rule (a hairline beside a 40px column marks nothing) and no eraser.
 *    Rendered by `ShortcutsNav` in `app/[locale]/(auth)/layout.tsx`; the rule's
 *    measured contrast values, per theme, are on `SHORTCUTS_RULE` there.
 *
 *    VOCABULARY, recorded: the only words the user reads are still the verbs on
 *    the control — "Always show in shortcuts" / "Stop always showing"
 *    (`Nav.shortcutAlwaysShow`, `shortcutStopAlwaysShowing`, shared with the
 *    sidebar rows and the search dropdown) — while the glyph is a pin. Splitting
 *    the group added NO new copy, deliberately: naming the runs "Pinned" and
 *    "Recent" would have put a noun in front of a verb that disagrees with it,
 *    and reconciling the two is a separate four-locale decision that should move
 *    in one pass or not at all.
 *
 * 2. OPEN TABS — `contexts/OpenTabsContext.tsx`. The Notion-style strip of
 *    pages you currently have OPEN, including individual records (a contact, a
 *    session). Different question: Shortcuts answers "where do I go often",
 *    Open tabs answers "what am I in the middle of". They are deliberately NOT
 *    merged. A tab may be PINNED, which protects it from Close-others and cap
 *    eviction — the same word every browser uses. Icon: a pin. It is still the
 *    only thing that WORD means on screen, but no longer the only thing that
 *    GLYPH means: Shortcuts wears the same pin on its curated half (item 1),
 *    unlabelled. That is deliberate — one mental model, "keep this within reach",
 *    over two different objects on two different surfaces — and it is what UX-23
 *    was NOT: back then "pin" also meant a saved contact filter, a third,
 *    unrelated object, which now says "show in filter bar".
 *
 * 3. SAVED FILTERS ON THE CONTACTS PAGE — `app/[locale]/(auth)/contacts/page.tsx`.
 *    Not a destination at all: a stored ContactFilter, per TEAM (Firestore, not
 *    localStorage), which may be shown as a chip in the filter bar. It used to
 *    say "Pin to filter bar"; it now says "Show in filter bar".
 *
 * 4. RECENTLY VIEWED CONTACTS — `contexts/RecentContactsContext.tsx`. The last
 *    few PEOPLE whose detail page you opened, ids only, per TEAM, in
 *    localStorage. Surfaced in exactly one place: the sidebar search panel
 *    BEFORE anything is typed (typing replaces it with results). A third
 *    question again — Shortcuts answers "where do I go often", Open tabs "what
 *    am I in the middle of", this one "who was I just looking at" — and neither
 *    of the other two can answer it: a contact page records the "contacts" PAGE
 *    into Shortcuts' recents, and Open tabs rewrites its active tab in place (so
 *    ten contacts leave one tab) and only when the strip is switched on. Names
 *    are resolved live from the roster query, never stored; an id that no longer
 *    resolves is dropped from the rendering, not from storage. UI label:
 *    "Recently viewed contacts". No verb and no control: it fills itself.
 *    VOCABULARY: in code it is `recentContact*`, never `recent*` bare — that
 *    word is spent on the recents half of Shortcuts above (item 1).
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
