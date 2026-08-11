'use client'

// Appointment AVAILABILITY for the kiosk — when a private lesson could still be
// booked, as opposed to `useKioskSessions`, which returns what is already
// scheduled (classes + already-booked appointment slots).
//
// Same two-step shape as the website's schedule block: check the cheap,
// SDK-cached activity mirrors for an appointment offering first, and only invoke
// the `listAvailability` callable for teams that actually have one. A tablet left
// open for hours in a classes-only studio then costs nothing.

import { useEffect, useState } from 'react'
import { collectionGroup, query, where, getDocs, Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { browseDurationMinutes, mergeAvailabilitySlots } from '@linyup/shared'
import { db, functions } from '@/lib/firebase'
import type { KioskSession } from './useKioskSessions'

interface AvailCoachLite {
  providerId: string
  providerName: string | null
  activities: {
    activityId: string
    activityName: string
    durations: { minutes: number }[]
    location: string | null
    days: { dayMs: number; slotsByDuration: Record<string, number[]> }[]
  }[]
}

const REFRESH_MS = 5 * 60 * 1000 // matches useKioskSessions

/**
 * Merged availability windows, shaped as KioskSessions so the existing schedule
 * views render them with no new code. `enabled` gates the whole thing: the kiosk
 * only asks for availability while the front desk has it switched on.
 */
export function useKioskAvailability(teamId: string, enabled: boolean, days = 7) {
  const [windows, setWindows] = useState<KioskSession[]>([])

  useEffect(() => {
    if (!enabled || !teamId) {
      setWindows([])
      return
    }
    let alive = true

    async function load() {
      const offerings = await getDocs(
        query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('type', '==', 'activity'),
          where('activityType', '==', 'appointment')
        )
      )
      if (!alive || offerings.empty) return

      const fn = httpsCallable<{ teamId: string; days?: number }, { coaches: AvailCoachLite[] }>(
        functions,
        'listAvailability'
      )
      const res = await fn({ teamId, days })
      if (!alive) return

      const out: KioskSession[] = []
      for (const coach of res.data.coaches ?? []) {
        for (const activity of coach.activities ?? []) {
          const minutes = browseDurationMinutes(activity.durations)
          if (!minutes) continue
          const starts = (activity.days ?? []).flatMap(
            (d) => d.slotsByDuration?.[String(minutes)] ?? []
          )
          for (const w of mergeAvailabilitySlots(starts, minutes)) {
            out.push({
              id: `avail-${coach.providerId}-${activity.activityId}-${w.startMs}`,
              type: 'availability',
              activityId: activity.activityId,
              activityName: activity.activityName,
              providerName: coach.providerName ?? undefined,
              location: activity.location ?? undefined,
              start: Timestamp.fromMillis(w.startMs),
              end: Timestamp.fromMillis(w.endMs),
            })
          }
        }
      }
      if (alive) setWindows(out)
    }

    load().catch(() => {
      // Additive — a failure must leave the real schedule untouched.
      if (alive) setWindows([])
    })
    const id = setInterval(() => void load().catch(() => {}), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [teamId, enabled, days])

  return windows
}
