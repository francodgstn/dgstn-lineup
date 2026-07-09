'use client'

// Ticking wall-clock — used by KioskHeader (top-bar clock) and Standby (the
// branded screensaver shown when there's no configured slideshow media).
import { useEffect, useState } from 'react'

export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
