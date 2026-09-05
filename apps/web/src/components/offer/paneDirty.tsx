'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * "Unsaved changes", said WHERE THE THING IS NAMED.
 *
 * The pane is tall — prices, then the plan table, then a footer. The marker
 * that a save is outstanding lived only next to the button at the bottom, so a
 * studio reading the top of a plan had nothing telling them the pane was
 * holding an edit (Franco, 2026-09-02).
 *
 * The state belongs to the forms and the heading belongs to the pane, so the
 * forms report upward: each editor registers under a key and the pane shows the
 * marker while any key is true. Keys make it idempotent — two editors under one
 * pane cannot clear each other, and an unmounting editor withdraws its own.
 */
const PaneDirtyContext = createContext<((key: string, dirty: boolean) => void) | null>(null)

export function usePaneDirtyState() {
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const report = useCallback((key: string, dirty: boolean) => {
    setKeys((prev) => (prev[key] === dirty ? prev : { ...prev, [key]: dirty }))
  }, [])
  const dirty = useMemo(() => Object.values(keys).some(Boolean), [keys])
  return { dirty, report }
}

export function PaneDirtyProvider({
  report,
  children,
}: {
  report: (key: string, dirty: boolean) => void
  children: React.ReactNode
}) {
  return <PaneDirtyContext.Provider value={report}>{children}</PaneDirtyContext.Provider>
}

/** Report this editor's unsaved state to the surrounding pane. A no-op outside
 *  one, so the same form still works on its own page. */
export function useReportPaneDirty(key: string, dirty: boolean) {
  const report = useContext(PaneDirtyContext)
  useEffect(() => {
    report?.(key, dirty)
    return () => report?.(key, false)
  }, [report, key, dirty])
}
