'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { CalendarClock, MapPin, X, LogIn, UserRound, Loader2 } from 'lucide-react'
import type { MyBooking, MyBookingsResult } from '@linyup/shared'
import { QueryErrorState } from '@/components/ui/query-error'
import {
  loadFailureDetail,
  reportPublicActionFailure,
  reportPublicLoadFailure,
} from '@/lib/publicQueryError'
import { useSpaceAuth } from '../SpaceAuthProvider'
import { useSpaceTheme } from '../useSpaceTheme'

// "My bookings" — one server read of HER bookings, through `getMyBookings`.
//
// It used to be a client fan-out: list the TEAM's next 80 public session
// mirrors, then `getDoc` each one's `bookings/{contactId}`. That was wrong three
// ways (UX-10) and only the first was visible. It filtered on
// `type == 'session'`, and an appointment is mirrored as
// `type == 'appointment_session'` — so a member holding a paid appointment was
// told, flatly, that she had none. It truncated at 80 mirrors of the STUDIO's
// schedule, so her list got shorter as the studio got busier. And a session is
// mirrored at all only while `allowBooking` is true, so a booking the studio
// entered for her had no public document to be found through.
//
// The last of those is why this is a callable and not a widened query: the
// server reads `sessions` directly, so what the studio happens to be selling
// online stops deciding what the member can see she has booked.
//
// Cost: 80 mirror documents + up to 80 `getDoc` per visit, before. One callable
// round trip now.

function formatDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export default function BookingsHome() {
  const t = useTranslations('Space')
  const { teamId, contact, isAuthenticated, openSignIn } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const contactId = contact?.id ?? null
  const [cancelling, setCancelling] = useState<string | null>(null)
  // Which booking's cancel failed, and why — held per booking so the sentence
  // appears on the row whose button was pressed, next to the button.
  const [cancelError, setCancelError] = useState<{ id: string; detail: string | null } | null>(null)

  // `isError` is read, not ignored: a failed read must not render as "you have
  // no bookings" — a member who cannot see her booking assumes it was lost.
  // The visitor-facing state and the developer-facing trace are two separate
  // obligations, so the query also logs (see lib/publicQueryError.ts): without
  // it this is the one Tier-1 public surface a failure leaves no record of.
  //
  // Paged, not capped: the server walks back through HER OWN reservations, and
  // a full page means her history continues rather than that her list ends. In
  // practice page one is the whole answer — a booking for an upcoming session
  // is almost always among the most recently made ones — so the "check for
  // more" control below is an offer, not a chore.
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['space-bookings', teamId, contactId],
    enabled: isAuthenticated && !!teamId && !!contactId,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<MyBookingsResult> => {
      try {
        const fn = httpsCallable<{ teamId: string; cursor: number | null }, MyBookingsResult>(
          functions,
          'getMyBookings'
        )
        const res = await fn({ teamId: teamId ?? '', cursor: pageParam })
        return res.data ?? { bookings: [], cursor: null, scanned: 0 }
      } catch (err: unknown) {
        reportPublicLoadFailure('space/bookings', err)
        throw err
      }
    },
    // Stop when the server stops moving: the cursor is inclusive of its own
    // boundary document, so a page that returns the cursor it was given has
    // nothing further to walk to.
    getNextPageParam: (last, _pages, lastParam) =>
      last.cursor !== null && last.cursor !== lastParam ? last.cursor : undefined,
  })

  // One booking per session per contact, so `sessionId` is a key and not just a
  // grouping — which is what makes the inclusive page boundary harmless.
  const bookings: MyBooking[] = Array.from(
    new Map(
      (data?.pages ?? []).flatMap((page) => page.bookings).map((b) => [b.sessionId, b])
    ).values()
  ).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))

  // The cancel is the one WRITE on this page, and it used to fail into nothing:
  // no sentence for the member, no line in the console. The old note said a
  // refetch kept the list honest anyway — it does not, because the refetch is
  // inside the try, after the call that just threw. So the row stayed exactly as
  // it was, which is precisely how a successful cancel would look mid-refresh:
  // the member reads "nothing happened", presses Cancel again, and the studio
  // gets a person who believes they are out of a class they are still booked
  // into (or a second attempt against a cutoff rule that refused the first).
  async function cancel(b: MyBooking) {
    if (!b.cancelToken) return
    setCancelling(b.sessionId)
    setCancelError(null)
    try {
      const fn = httpsCallable(functions, 'cancelBooking')
      await fn({ token: b.cancelToken })
      await refetch()
    } catch (err: unknown) {
      reportPublicActionFailure('space/cancel-booking', err)
      // Deliberately NO refetch here: the list is unchanged because the cancel
      // did not happen, and re-reading it would only redraw the same row under
      // the message. The booking is still live — which is what the sentence says.
      setCancelError({ id: b.sessionId, detail: loadFailureDetail(err) })
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
      ) : isError ? (
        <QueryErrorState
          onRetry={() => void refetch()}
          title={t('bookingsLoadFailed')}
          detail={loadFailureDetail(error)}
          theme={{ textMain, textMuted, accent, border: cardBorder }}
        />
      ) : (
        <div className="space-y-2.5">
          {/* Empty is stated even when a further page can still be asked for —
              the sentence and the offer to look further back are two different
              things, and hiding the first would leave a bare button. */}
          {bookings.length === 0 && (
            <p className="text-sm text-center py-12" style={{ color: textMuted }}>{t('bookingsEmpty')}</p>
          )}
          {bookings.map((b) => {
            const start = formatDate(b.start)
            const end = formatDate(b.end)
            const isAppointment = b.kind === 'appointment'
            const Icon = isAppointment ? UserRound : CalendarClock
            return (
              <div key={b.sessionId} className="flex items-center gap-3 rounded-2xl p-3.5" style={cardStyle}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: textMain }}>
                    {b.activityName ?? (isAppointment ? t('bookingsAppointment') : t('bookingsSession'))}
                  </p>
                  <p className="text-xs" style={{ color: textMuted }}>
                    {start ? start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
                    {start ? ` · ${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                    {end ? `–${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                  {/* The provider is what tells two otherwise identical
                      appointment slots apart, so it is never dropped from an
                      appointment row. */}
                  {isAppointment && b.providerName && (
                    <p className="text-xs mt-0.5" style={{ color: textMuted }}>
                      {t('bookingsWithProvider', { name: b.providerName })}
                    </p>
                  )}
                  {b.location && (
                    <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: textMuted }}>
                      <MapPin className="h-3 w-3" /> <span className="truncate">{b.location}</span>
                    </p>
                  )}
                  {/* A called-off session stays on the list and says so. A
                      booking that simply disappears is read as a booking that
                      was lost — which is the failure this whole surface is
                      being repaired for. */}
                  {b.sessionCancelled && (
                    <p className="text-xs mt-1 font-medium" style={{ color: '#dc2626' }}>
                      {t('bookingsCancelledByStudio')}
                    </p>
                  )}
                  {cancelError?.id === b.sessionId && (
                    <p
                      role="alert"
                      className="text-xs mt-1"
                      style={{ color: '#dc2626' }}
                      title={cancelError.detail ?? undefined}
                    >
                      {t('bookingsCancelFailed')}
                    </p>
                  )}
                </div>
                {/* Shown only when the server says `cancelBooking` will accept
                    it — the token comes back only in that case, so the button
                    cannot be offered for a call that is going to refuse. */}
                {b.cancellable && b.cancelToken && (
                  <button
                    onClick={() => cancel(b)}
                    disabled={cancelling === b.sessionId}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ border: `1px solid ${cardBorder}`, color: textMuted }}
                  >
                    <X className="h-3.5 w-3.5" /> {cancelling === b.sessionId ? t('cancelling') : t('bookingsCancel')}
                  </button>
                )}
              </div>
            )
          })}

          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl py-2.5 text-xs font-medium disabled:opacity-60"
              style={{ border: `1px solid ${cardBorder}`, color: textMuted }}
            >
              {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('bookingsLoadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
