'use client'

// Shared session feed for the kiosk (KioskSchedule + NowNext + WalkIn's session
// picker) — one collection-group query, refetched periodically since the tablet
// stays open for hours. Adapted from the ScheduleBlock query in
// components/site/sections.tsx: same collectionGroup('public_profile') filter on
// teamId/type/allowBooking, but the lower bound on `start` is the START OF TODAY
// rather than "now" — the literal "now" bound (used by the website's schedule
// section, which never needs to know about sessions already in progress) would
// make it impossible for NowNext to ever find an "ongoing" class, since a session
// that started a few minutes ago would already be excluded from the feed.
import { useEffect, useState } from 'react'
import {
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface KioskSession {
  id: string
  /** Public-mirror kind: 'session' (group class) or 'appointment_session'. */
  type?: string
  activityId?: string
  activityName?: string
  activityColor?: string
  start: Timestamp
  end: Timestamp
  location?: string
  coachName?: string
  /** Appointment slots only: 'open' | 'full' | 'cancelled' — walk-in offers open ones. */
  status?: string
}

const REFRESH_MS = 5 * 60 * 1000 // 5 minutes — plenty fresh for a wall display

export function useKioskSessions(teamId: string) {
  const [sessions, setSessions] = useState<KioskSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    function load() {
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      // Group classes AND appointment slots — the front desk sees private lessons
      // too. `in` runs on the same (teamId,type,allowBooking,start) index.
      const q = query(
        collectionGroup(db, 'public_profile'),
        where('teamId', '==', teamId),
        where('type', 'in', ['session', 'appointment_session']),
        where('allowBooking', '==', true),
        where('start', '>=', Timestamp.fromDate(startOfToday)),
        orderBy('start', 'asc'),
        limit(100)
      )
      getDocs(q)
        .then((snap) => {
          if (!alive) return
          const list = snap.docs.map(
            (d) => ({ ...(d.data() as Omit<KioskSession, 'id'>), id: d.id }) as KioskSession
          )
          setSessions(list)
        })
        .catch(() => {
          if (alive) setSessions([])
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }

    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [teamId])

  return { sessions, loading }
}
