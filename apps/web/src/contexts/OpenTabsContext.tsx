'use client'

// Per-browser "open pages" model backing the desktop tab strip (OpenTabsStrip).
// Unlike NavPinsContext — which tracks stable nav-destination *ids* and collapses
// /contacts/123 down to "contacts" — this tracks the *full entity route* so a
// specific contact/session/event can be reopened. Kept as a separate context on
// purpose: incompatible identity model, different persisted shape, and "pinned"
// here means protect-from-auto-close (not a sidebar shortcut). State lives in
// localStorage; hydrated after mount to avoid an SSR mismatch.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { EntityKind } from '@/lib/tab-routes'

export interface OpenTab {
  /** Stable id + dnd id = normalized path (no query), e.g. "/contacts/123". */
  id: string
  /** Full route to navigate to; may carry ?tab=payments etc. */
  href: string
  label: string
  entityKind: EntityKind
  /** Protected from Close-others and cap eviction. */
  pinned: boolean
}

const STORAGE_KEY = 'linyup_open_tabs'
const MAX_TABS = 12

function persist(tabs: OpenTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
  } catch {
    /* ignore */
  }
}

function readStored(): OpenTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as OpenTab[]
  } catch {
    /* ignore malformed storage */
  }
  return []
}

// Evict the oldest unpinned tab (never `keepId`, never a pinned tab) until under
// the cap. If everything is pinned/kept, the list is allowed to exceed the cap.
function enforceCap(tabs: OpenTab[], keepId?: string): OpenTab[] {
  if (tabs.length <= MAX_TABS) return tabs
  const next = [...tabs]
  while (next.length > MAX_TABS) {
    const idx = next.findIndex((t) => !t.pinned && t.id !== keepId)
    if (idx === -1) break
    next.splice(idx, 1)
  }
  return next
}

type NewTab = { id: string; href: string; label: string; entityKind: EntityKind }

interface OpenTabsValue {
  tabs: OpenTab[]
  /** Insert if missing, or update href/label in place (used by useRegisterTab). */
  openTab: (tab: NewTab) => void
  /** Insert only if missing — never overwrites an existing (richer) label. */
  ensureTab: (tab: NewTab) => void
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  pinTab: (id: string) => void
  reorderTabs: (from: number, to: number) => void
}

const OpenTabsContext = createContext<OpenTabsValue | null>(null)

// Merge tabs registered before hydration in front-stable order with stored tabs.
function mergeStored(prev: OpenTab[], stored: OpenTab[]): OpenTab[] {
  if (!prev.length) return stored
  const merged = [...stored]
  for (const t of prev) if (!merged.some((m) => m.id === t.id)) merged.push(t)
  return merged
}

export function OpenTabsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<OpenTab[]>([])
  // ensureTab/openTab (from the strip's auto-open effect and page registration)
  // can fire before the hydration effect below runs — merge from storage in that
  // window so the first render of a session never clobbers stored tabs.
  const hydrated = useRef(false)

  useEffect(() => {
    const stored = readStored()
    if (stored.length) setTabs((prev) => mergeStored(prev, stored))
    hydrated.current = true
  }, [])

  const commit = useCallback((updater: (prev: OpenTab[]) => OpenTab[]) => {
    setTabs((prev) => {
      const base = hydrated.current ? prev : mergeStored(prev, readStored())
      const next = updater(base)
      if (next === base) return prev
      persist(next)
      return next
    })
  }, [])

  const openTab = useCallback(
    (tab: NewTab) => {
      commit((prev) => {
        const existing = prev.find((t) => t.id === tab.id)
        if (existing) {
          if (existing.href === tab.href && existing.label === tab.label) return prev
          return prev.map((t) =>
            t.id === tab.id ? { ...t, href: tab.href, label: tab.label } : t
          )
        }
        return enforceCap([...prev, { ...tab, pinned: false }], tab.id)
      })
    },
    [commit]
  )

  const ensureTab = useCallback(
    (tab: NewTab) => {
      commit((prev) =>
        prev.some((t) => t.id === tab.id)
          ? prev
          : enforceCap([...prev, { ...tab, pinned: false }], tab.id)
      )
    },
    [commit]
  )

  const closeTab = useCallback(
    (id: string) => commit((prev) => prev.filter((t) => t.id !== id)),
    [commit]
  )

  const closeOthers = useCallback(
    (id: string) => commit((prev) => prev.filter((t) => t.id === id || t.pinned)),
    [commit]
  )

  const pinTab = useCallback(
    (id: string) =>
      commit((prev) => prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))),
    [commit]
  )

  const reorderTabs = useCallback(
    (from: number, to: number) =>
      commit((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
          return prev
        }
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      }),
    [commit]
  )

  return (
    <OpenTabsContext.Provider
      value={{ tabs, openTab, ensureTab, closeTab, closeOthers, pinTab, reorderTabs }}
    >
      {children}
    </OpenTabsContext.Provider>
  )
}

export function useOpenTabs(): OpenTabsValue {
  const ctx = useContext(OpenTabsContext)
  if (!ctx) throw new Error('useOpenTabs must be used within OpenTabsProvider')
  return ctx
}

/**
 * Register the current detail page as an open tab with a real label once its
 * entity has loaded. `openTab` upserts by id, so this both creates the tab (if
 * the user deep-linked in) and upgrades the generic label the strip's auto-open
 * inserted. Pass `enabled: false` while loading to avoid registering a
 * placeholder label.
 */
export function useRegisterTab(reg: {
  id: string
  href: string
  label: string
  entityKind: EntityKind
  enabled?: boolean
}) {
  const { openTab } = useOpenTabs()
  const { id, href, label, entityKind, enabled = true } = reg
  useEffect(() => {
    if (!enabled || !label) return
    openTab({ id, href, label, entityKind })
  }, [openTab, id, href, label, entityKind, enabled])
}
