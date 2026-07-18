'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'ops-theme'

/**
 * Light/dark toggle for the operator console. The dark palette lives in
 * globals.css (.dark). We persist the choice to localStorage and let the
 * inline boot script in the root layout apply it before hydration so night
 * mode never flashes white on load.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  // Sync initial state from whatever the boot script already applied.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
    } catch {
      // Private mode / storage disabled — the class still applies for this session.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
