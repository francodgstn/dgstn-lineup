'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  collectionGroup, query, where, orderBy, limit, getDocs, doc, getDoc, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { CalendarClock, MapPin, X, LogIn } from 'lucide-react'
import { useSpaceAuth } from '../SpaceAuthProvider'
import { useSpaceTheme } from '../useSpaceTheme'

type TsLike = { toDate?: () => Date; seconds?: number }

interface BookedSession {
  id: string
  activityName?: string
  start?: TsLike
  end?: TsLike
  location?: string
  bookingToken?: string
}

function toDate(v?: TsLike): Date | null {
  if (!v) return null
  if (typeof v.toDate === 'function') return v.toDate()
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000)
  return null
}

// "My bookings": there's no contact-readable collection-group of bookings, so we
// list the team's upcoming sessions (world-readable public_profile) and keep the
// ones the contact has a booking doc for (sessions/{id}/bookings/{contactId} —
// permitted by isSelfContact). Bounded fan-out; a getMyBookings callable is a
// future optimization.
export default function BookingsHome() {
  const t = useTranslations('Space')
  const { teamId, contact, isAuthenticated, openSignIn } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const contactId = contact?.id ?? null
  const [cancelling, setCancelling] = useState<string | null>(null)

  const { data: bookings = [], isLoading, refetch } = useQuery<BookedSession[]>({
    queryKey: ['space-bookings', teamId, contactId],
    enabled: isAuthenticated && !!teamId && !!contactId,
    queryFn: async () => {
      const sessQ = query(
        collectionGroup(db, 'public_profile'),
        where('teamId', '==', teamId),
        where('type', '==', 'session'),
        where('start', '>=', Timestamp.now()),
        orderBy('start', 'asc'),
        limit(80)
      )
      const snap = await getDocs(sessQ)
      const sessions = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      const probes = await Promise.all(
        sessions.map(async (s) => {
          const bSnap = await getDoc(doc(db, 'sessions', s.id, 'bookings', contactId!))
          if (!bSnap.exists()) return null
          const b = bSnap.data()
          if (b.status === 'cancelled') return null
          return {
            id: s.id,
            activityName: (s as { activityName?: string }).activityName,
            start: (s as { start?: TsLike }).start,
            end: (s as { end?: TsLike }).end,
            location: (s as { location?: string }).location,
            bookingToken: b.booking_token as string | undefined,
          } as BookedSession
        })
      )
      return probes.filter((x): x is BookedSession => x !== null)
    },
  })

  async function cancel(b: BookedSession) {
    if (!b.bookingToken) return
    setCancelling(b.id)
    try {
      const fn = httpsCallable(functions, 'cancelBooking')
      await fn({ token: b.bookingToken })
      await refetch()
    } catch {
      /* refetch keeps the list honest even if cancel errored */
    } finally {
      setCancelling(null)
    }
  }

  const cardStyle = { background: cardBg, border: `1px solid ${cardBorder}` }

  if (!isAuthenticated) {
    return (
      <div className="mt-10 rounded-2xl p-8 text-center" style={cardStyle}>
        <LogIn className="mx-auto h-7 w-7" style={{ color: accent }} />
        <p className="mt-3 text-sm" style={{ color: textMuted }}>{t('bookingsSignInPrompt')}</p>
        <button
          onClick={() => openSignIn()}
          className="mt-4 text-sm font-medium px-4 py-2 rounded-full"
          style={{ background: accent, color: '#fff' }}
        >
          {t('signIn')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: textMuted }}>
        {t('bookingsTitle')}
      </h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accent, borderTopColor: 'transparent' }} />
        </div>
      ) : bookings.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: textMuted }}>{t('bookingsEmpty')}</p>
      ) : (
        <div className="space-y-2.5">
          {bookings.map((b) => {
            const start = toDate(b.start)
            const end = toDate(b.end)
            return (
              <div key={b.id} className="flex items-center gap-3 rounded-2xl p-3.5" style={cardStyle}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}>
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: textMain }}>
                    {b.activityName ?? t('bookingsSession')}
                  </p>
                  <p className="text-xs" style={{ color: textMuted }}>
                    {start ? start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
                    {start ? ` · ${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                    {end ? `–${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                  {b.location && (
                    <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: textMuted }}>
                      <MapPin className="h-3 w-3" /> <span className="truncate">{b.location}</span>
                    </p>
                  )}
                </div>
                {b.bookingToken && (
                  <button
                    onClick={() => cancel(b)}
                    disabled={cancelling === b.id}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ border: `1px solid ${cardBorder}`, color: textMuted }}
                  >
                    <X className="h-3.5 w-3.5" /> {cancelling === b.id ? t('cancelling') : t('bookingsCancel')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
