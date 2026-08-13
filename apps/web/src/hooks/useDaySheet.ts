'use client'

// Day-sheet data: every session on one calendar day, each with its roster
// (bookings + checked-in participants) resolved. Backs the printable manifest
// (/manifest) — the sheet a coach carries to the door.
//
// One query for the day's sessions (reusing the existing (teamId, start)
// composite index — same shape as the dashboard agenda), then one bookings +
// one participants read per session. That fan-out is fine at day scale (a
// studio runs single-digit-to-~20 sessions a day) and keeps the hook honest:
// the roster shown is the roster stored, with no denormalised counter to drift.

import { useQuery } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  SESSIONS_COLLECTION,
  PARTICIPANTS_SUBCOLLECTION,
  type Booking,
  type Session,
} from '@linyup/shared'

const BOOKINGS_SUB = 'bookings'

export interface DaySheetParticipant {
  contactId: string
  checked_in_at?: { toDate(): Date } | null
}

export interface DaySheetEntry {
  session: Session
  /** Every booking doc on the session, cancelled/rebooked included — the sheet
   *  filters for display so the counts here stay auditable. */
  bookings: Booking[]
  /** Check-in records; a booking whose contact appears here has arrived. */
  participants: DaySheetParticipant[]
}

/** Bookings that still hold a seat — the ones worth printing on a door sheet. */
export function activeBookings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'rebooked')
}

export function useDaySheet(teamId: string | null, day: Date) {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  return useQuery<DaySheetEntry[]>({
    queryKey: ['day-sheet', teamId, dayStart.toISOString()],
    enabled: !!teamId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const sessionsSnap = await getDocs(
        query(
          collection(db, SESSIONS_COLLECTION),
          where('teamId', '==', teamId),
          where('start', '>=', Timestamp.fromDate(dayStart)),
          where('start', '<', Timestamp.fromDate(dayEnd)),
          orderBy('start', 'asc')
        )
      )
      const sessions = sessionsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)

      return Promise.all(
        sessions.map(async (session) => {
          const [bookingsSnap, participantsSnap] = await Promise.all([
            getDocs(collection(db, SESSIONS_COLLECTION, session.id, BOOKINGS_SUB)),
            getDocs(collection(db, SESSIONS_COLLECTION, session.id, PARTICIPANTS_SUBCOLLECTION)),
          ])
          return {
            session,
            bookings: bookingsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Booking),
            participants: participantsSnap.docs.map(
              (d) => ({ contactId: d.id, ...d.data() }) as DaySheetParticipant
            ),
          }
        })
      )
    },
  })
}
