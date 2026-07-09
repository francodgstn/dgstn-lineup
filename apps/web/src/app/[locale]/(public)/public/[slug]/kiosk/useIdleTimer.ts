'use client'

// Idle-timeout detector for the standby slideshow. Any pointer/touch/keyboard
// activity resets the timer — the SAME window-level listeners double as the
// "dismiss standby" interaction (Standby itself has no listeners of its own; any
// activity anywhere flips `idle` back to false, which unmounts it).
import { useEffect, useState } from 'react'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel'] as const

export function useIdleTimer(idleMs: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), idleMs)
    }

    reset()
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true })
    }
    return () => {
      clearTimeout(timer)
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset)
      }
    }
  }, [idleMs, enabled])

  return idle
}
