'use client'

import { useEffect } from 'react'

/**
 * Wires Ctrl+S (Cmd+S on macOS) to a save action and suppresses the browser's
 * native "Save page" dialog. This is the standard mechanism for making any save
 * button reachable via the keyboard — call it next to the page's save handler.
 *
 * @param onSave   the save handler to invoke
 * @param enabled  set false to disable (e.g. while nothing is dirty); default true
 */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onSave, enabled])
}
