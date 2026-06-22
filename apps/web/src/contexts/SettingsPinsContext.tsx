'use client'

// Per-browser preference for which Settings items are pinned to the sidebar.
// Shared via context so the sidebar and the /settings hub stay in sync within a tab
// (localStorage's `storage` event only fires across tabs). Defaults to the
// most-useful-while-setting-up set; users add/remove pins from the hub.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { DEFAULT_PINNED_IDS } from '@/lib/settings-nav'

const STORAGE_KEY = 'linyup_settings_pins'

interface SettingsPinsValue {
  pinnedIds: string[]
  isPinned: (id: string) => boolean
  togglePin: (id: string) => void
}

const SettingsPinsContext = createContext<SettingsPinsValue | null>(null)

export function SettingsPinsProvider({ children }: { children: React.ReactNode }) {
  // Start from defaults; hydrate from localStorage after mount (avoids SSR mismatch).
  const [pinnedIds, setPinnedIds] = useState<string[]>(DEFAULT_PINNED_IDS)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setPinnedIds(JSON.parse(raw) as string[])
    } catch {
      /* ignore malformed storage */
    }
  }, [])

  const togglePin = useCallback(
    (id: string) => {
      setPinnedIds((prev) => {
        const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    []
  )

  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds])

  return (
    <SettingsPinsContext.Provider value={{ pinnedIds, isPinned, togglePin }}>
      {children}
    </SettingsPinsContext.Provider>
  )
}

export function useSettingsPins(): SettingsPinsValue {
  const ctx = useContext(SettingsPinsContext)
  if (!ctx) throw new Error('useSettingsPins must be used within SettingsPinsProvider')
  return ctx
}
