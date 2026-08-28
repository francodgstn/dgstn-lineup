'use client'

import { Fragment, useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
  increment,
  deleteField,
  collection,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  bookingContactId,
  confirmClearedHoldFields,
  buildParticipantDoc,
  type Booking,
} from '@linyup/shared'
import { QueryErrorState } from '@/components/ui/query-error'
import {
  MAX_RANGE_DAYS,
  MAX_WINDOW_SESSIONS,
  parseBookingReference,
  useBookingReference,
  useBookingsWindow,
  useContactBookedSessions,
  type BookingDateAxis,
  type SessionInfo,
} from '@/hooks/useBookingsWindow'
import {
  Search,
  MoreHorizontal,
  Check,
  X,
  UserX,
  Undo,
  Repeat,
  ExternalLink,
  User,
  Hash,
  AlertTriangle,
} from 'lucide-react'
import { Link, useRouter } from '@/i18n/navigation'
import { QuickLinks } from '@/components/layout/QuickLinks'
import type { Route } from 'next'
import { PublicSurfaceLink } from '@/components/layout/PublicSurfaceLink'

// ─── helpers ──────────────────────────────────────────────────────────────────

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function')
    return (ts as { toDate(): Date }).toDate()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number')
    return new Date((ts as { seconds: number }).seconds * 1000)
  return null
}

function formatDate(ts: unknown): string {
  const d = tsToDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts: unknown): string {
  const d = tsToDate(ts)
  if (!d) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return (
    d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

function initials(b: Booking) {
  return `${b.firstname?.[0] ?? ''}${b.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

function errorMessage(err: unknown): string | null {
  if (err instanceof Error && err.message) return err.message
  return null
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-red-500',
  'bg-indigo-500',
]
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// ─── quick date ranges ──────────────────────────────────────────────────────────
// Predefined windows for the bookings date filter. Selecting one fills the From/To
// fields (yyyy-mm-dd, the format the DatePicker + filter already use); editing either
// field manually flips the dropdown back to "custom".
//
// Every preset is BOUNDED — the old 'All time' option is gone. It read as a free
// search and was neither: the query took the newest 200 bookings whatever was
// picked, so "All time" meant "the last 200, silently". The window is now the
// query, so it has to be one.
//
// Some of them reach FORWARD, because the class-date axis can: a studio asking
// "who is booked into next week" is the common question, and no window built off
// `joinedAt` alone could ever answer it. `FORWARD_RANGES` below is the list of
// those, and the booking axis is offered the rest.

type QuickRange =
  | 'today'
  | 'tomorrow'
  | 'thisWeek'
  | 'next7'
  | 'next30'
  | 'nextMonth'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'custom'

// THE DROPDOWN IS SCANNED, NOT READ, so the presets are sectioned by the one
// axis a studio actually filters on: direction in time. The flat list this
// replaced ran present -> future -> past -> present, which stranded "This month"
// eight rows below "This week" and gave the eye nothing to anchor on (Franco,
// 2026-08-28). Order within a section is nearest-first.
const RANGE_GROUPS = [
  { key: 'current', ranges: ['today', 'thisWeek', 'thisMonth'] },
  { key: 'upcoming', ranges: ['tomorrow', 'next7', 'next30', 'nextMonth'] },
  { key: 'past', ranges: ['yesterday', 'last7', 'last30'] },
] as const satisfies ReadonlyArray<{
  key: string
  ranges: ReadonlyArray<Exclude<QuickRange, 'custom'>>
}>

// Presets whose label promises the future — tomorrow, next 7 days, next 30 days,
// next month. They belong to the CLASS axis alone: `joinedAt` is stamped when a
// booking is taken and so is never later than now, which makes "Tomorrow" on the
// booking axis a guaranteed-empty list and "Next 30 days" a window that quietly
// means "today". Offering them there is a dead end with no explanation, so the
// axis toggle removes them and snaps a selected one back to the default.
const FORWARD_RANGES: ReadonlySet<QuickRange> = new Set<QuickRange>([
  'tomorrow',
  'next7',
  'next30',
  'nextMonth',
])

// Sections for the current axis, with EMPTIED ONES DROPPED. The booking axis
// removes every forward preset (see FORWARD_RANGES), which empties 'upcoming'
// entirely — and a group with a label and no items renders a heading floating
// over nothing.
function rangeGroupsForAxis(
  axis: BookingDateAxis
): { key: string; ranges: Exclude<QuickRange, 'custom'>[] }[] {
  return RANGE_GROUPS.map((g) => ({
    key: g.key,
    ranges: (axis === 'class'
      ? [...g.ranges]
      : g.ranges.filter((r) => !FORWARD_RANGES.has(r))) as Exclude<QuickRange, 'custom'>[],
  })).filter((g) => g.ranges.length > 0)
}

const DEFAULT_RANGE: Exclude<QuickRange, 'custom'> = 'thisWeek'

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// A yyyy-mm-dd field as a LOCAL calendar day. `new Date('2026-08-24')` is UTC
// midnight, which lands on the 23rd for anyone west of Greenwich — fine while the
// filter ran in the browser over already-loaded rows, wrong now that both ends
// become Timestamps in the query.
function startOfDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function endOfDay(value: string): Date | null {
  const d = startOfDay(value)
  if (!d) return null
  d.setHours(23, 59, 59, 999)
  return d
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

// Returns local-calendar from/to dates (yyyy-mm-dd) for a preset. 'custom' keeps
// whatever the pickers hold, so it has no range of its own.
function rangeForPreset(preset: Exclude<QuickRange, 'custom'>): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let from = new Date(today)
  let to = new Date(today)
  switch (preset) {
    case 'today':
      break
    case 'tomorrow':
      from = addDays(today, 1)
      to = addDays(today, 1)
      break
    case 'yesterday':
      from = addDays(today, -1)
      to = addDays(today, -1)
      break
    case 'last7':
      from = addDays(today, -6)
      break
    case 'last30':
      from = addDays(today, -29)
      break
    case 'next7':
      to = addDays(today, 6)
      break
    case 'next30':
      to = addDays(today, 29)
      break
    case 'thisWeek': {
      // Mon–Sun, the WHOLE week: the default window, and the class axis reaches
      // the end of it, so it opens on the classes still to come as well as the
      // ones already run.
      const mondayOffset = (today.getDay() + 6) % 7 // Mon = 0
      from = addDays(today, -mondayOffset)
      to = addDays(from, 6)
      break
    }
    case 'thisMonth':
      from = new Date(today.getFullYear(), today.getMonth(), 1)
      to = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      break
    case 'nextMonth':
      from = new Date(today.getFullYear(), today.getMonth() + 1, 1)
      to = new Date(today.getFullYear(), today.getMonth() + 2, 0)
      break
  }
  return { from: ymd(from), to: ymd(to) }
}

type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'rebooked'

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  confirmed: 'default',
  cancelled: 'destructive',
  no_show: 'secondary',
  rebooked: 'secondary',
}

// ─── data hooks ───────────────────────────────────────────────────────────────
// The list itself is `useBookingsWindow` (@/hooks/useBookingsWindow), which owns
// both date axes. What is left here is what only this page needs: the sessions
// behind an already-loaded page of bookings, and the rebook picker's shortlist.

// Sessions for bookings loaded on the BOOKING-date axis. The class-date axis
// queries the sessions first, so it hands its own map back and this stays idle.
function useSessionMap(bookings: Booking[]) {
  const sessionIds = useMemo(
    () => [...new Set(bookings.map((b) => b.session).filter((s): s is string => !!s))],
    [bookings]
  )

  return useQuery<Record<string, SessionInfo>>({
    queryKey: ['sessions-for-bookings', sessionIds],
    enabled: sessionIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const docs = await Promise.all(sessionIds.map((id) => getDoc(doc(db, 'sessions', id))))
      const map: Record<string, SessionInfo> = {}
      for (const d of docs) {
        if (d.exists()) {
          const data = d.data()
          map[d.id] = {
            activityName: data.activityName as string | undefined,
            start: tsToDate(data.start)?.toISOString(),
            end: tsToDate(data.end)?.toISOString(),
            allowBooking: data.allowBooking as boolean | undefined,
          }
        }
      }
      return map
    },
  })
}

// Future sessions available for rebooking — read only once the rebook dialog is
// actually open, since nothing else on the page looks at them.
function useFutureSessions(teamId: string | null, enabled: boolean) {
  return useQuery<{ id: string; activityName?: string; start?: string; end?: string }[]>({
    queryKey: ['future-sessions', teamId],
    enabled: !!teamId && enabled,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const now = new Date()
      const q = query(
        collection(db, 'sessions'),
        where('teamId', '==', teamId),
        where('allowBooking', '==', true),
        orderBy('start', 'asc'),
        limit(50)
      )
      const snap = await getDocs(q)
      return snap.docs
        .map((d) => {
          const data = d.data()
          const start = tsToDate(data.start)
          return {
            id: d.id,
            activityName: data.activityName as string | undefined,
            start: start?.toISOString(),
            end: tsToDate(data.end)?.toISOString(),
          }
        })
        .filter((s) => s.start && new Date(s.start) > now)
    },
  })
}

// ─── booking actions ──────────────────────────────────────────────────────────

type BookingAction = 'confirm' | 'no_show' | 'cancel' | 'revert'

// The windowed list, the reference band and the rebook picker's exclusion set
// all read the same booking documents, so an action taken on any of them has to
// refresh the others — a cancelled seat that stays in the exclusion set keeps a
// class out of the picker it is now free for.
function invalidateBookings(qc: QueryClient, teamId: string | null) {
  qc.invalidateQueries({ queryKey: ['bookings', 'window', teamId] })
  qc.invalidateQueries({ queryKey: ['bookings', 'reference', teamId] })
  qc.invalidateQueries({ queryKey: ['bookings', 'contact-sessions', teamId] })
}

function useBookingAction(teamId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ booking, action }: { booking: Booking; action: BookingAction }) => {
      if (!booking.session) throw new Error('Missing session ID on booking')
      const bookingRef = doc(db, 'sessions', booking.session, 'bookings', booking.id)
      const sessionRef = doc(db, 'sessions', booking.session)
      const batch = writeBatch(db)

      if (action === 'confirm') {
        // Mark booking confirmed. The hold markers go with the same write: a
        // confirmed seat is an ordinary booking, and a leftover `waitlist_claim`
        // would keep this person out of `sendBookingReminders` forever. For a
        // claim that was mid-payment the drop-in hold's own markers have to go
        // too, or the confirmed booking loses its seat at `expires_at` and
        // `releaseExpiredBookingHolds` deletes it at 02:00 — see
        // `confirmClearedHoldFields`, which all four confirm surfaces share.
        batch.update(bookingRef, {
          status: 'confirmed',
          confirmed_at: serverTimestamp(),
          ...confirmClearedHoldFields(booking, deleteField()),
        })
        // The attendance row — ONE builder, shared with session detail and the
        // two check-in callables. This page used to key the row by the BOOKING
        // id, spell `fullname` "firstname lastname" against everyone else's
        // "lastname firstname", and write neither `checkedInAt` nor
        // `checkedInBy` — so the same act produced a different document here
        // than it did one click away on the session.
        const contactId = bookingContactId(booking)
        const participantRef = doc(db, 'sessions', booking.session, 'participants', contactId)
        batch.set(
          participantRef,
          buildParticipantDoc({
            contactId,
            sessionId: booking.session,
            who: booking,
            checkedInBy: 'booking-confirm',
            checkedInAt: serverTimestamp(),
            fromBooking: true,
          })
        )
        // Conversion only. `bookings_count` is never written from a client:
        // it has one writing style (an absolute value from a server read set,
        // or trackBookings' recount, which this status flip fires) and a blind
        // increment from here would fight the booking transactions for it.
        batch.update(sessionRef, {
          conversions_count: increment(1),
        })
        if (booking.contact) {
          batch.update(doc(db, 'contacts', booking.contact), {
            pending_bookings_count: increment(-1),
          })
        }
      } else if (action === 'revert') {
        // Revert confirmed → pending
        batch.update(bookingRef, {
          status: 'pending',
          confirmed_at: null,
        })
        // Remove participant doc — same id the confirm above wrote it under.
        const participantRef = doc(
          db,
          'sessions',
          booking.session,
          'participants',
          bookingContactId(booking)
        )
        batch.delete(participantRef)
        // Undo the conversion only — see the note above.
        batch.update(sessionRef, {
          conversions_count: increment(-1),
        })
        if (booking.contact) {
          batch.update(doc(db, 'contacts', booking.contact), {
            pending_bookings_count: increment(1),
          })
        }
      } else if (action === 'no_show') {
        batch.update(bookingRef, { status: 'no_show', no_show_at: serverTimestamp() })
        const wasPending = !booking.status || booking.status === 'pending'
        if (wasPending) {
          // The freed seat is trackBookings' recount to write — see above.
          if (booking.contact) {
            batch.update(doc(db, 'contacts', booking.contact), {
              pending_bookings_count: increment(-1),
            })
          }
        }
      } else if (action === 'cancel') {
        batch.update(bookingRef, {
          status: 'cancelled',
          cancelled_at: serverTimestamp(),
          cancelled_by: 'admin',
        })
        const wasPending = !booking.status || booking.status === 'pending'
        if (wasPending) {
          // The freed seat is trackBookings' recount to write — see above.
          if (booking.contact) {
            batch.update(doc(db, 'contacts', booking.contact), {
              pending_bookings_count: increment(-1),
            })
          }
        }
      }

      await batch.commit()
    },
    onSuccess: () => invalidateBookings(qc, teamId),
  })
}

function useRebookAction(teamId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ token, newSessionId }: { token: string; newSessionId: string }) => {
      const fn = httpsCallable(functions, 'rebookSession')
      await fn({ token, newSessionId })
    },
    onSuccess: () => invalidateBookings(qc, teamId),
  })
}

// ─── rebook dialog ────────────────────────────────────────────────────────────

function RebookDialog({
  booking,
  futureSessions,
  bookedSessionIds,
  loadingOptions,
  onConfirm,
  onClose,
  loading,
}: {
  booking: Booking
  futureSessions: { id: string; activityName?: string; start?: string; end?: string }[]
  bookedSessionIds: ReadonlySet<string>
  /** The picker's two queries are fired by this dialog OPENING, so it draws
   *  first with nothing. Without this it announces "no other bookable sessions"
   *  for the length of a round trip and then silently repopulates under the
   *  manager — a false negative on the one screen that has to be trusted. */
  loadingOptions: boolean
  onConfirm: (newSessionId: string) => void
  onClose: () => void
  loading: boolean
}) {
  const t = useTranslations('Bookings')
  const [selectedId, setSelectedId] = useState('')

  const options = futureSessions.filter(
    (s) => s.start && new Date(s.start) > new Date() && !bookedSessionIds.has(s.id)
  )

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('rebookTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('rebookDesc', { name: `${booking.firstname} ${booking.lastname}` })}
        </p>
        {loadingOptions ? (
          <Skeleton className="h-9 w-full rounded-md" />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rebookNoSessions')}</p>
        ) : (
          <Select value={selectedId} onValueChange={(v) => setSelectedId(v ?? '')}>
            <SelectTrigger>
              <span className="flex flex-1 text-left text-sm truncate">
                {(() => {
                  const selected = options.find((s) => s.id === selectedId)
                  if (!selected)
                    return <span className="text-muted-foreground">{t('rebookPickSession')}</span>
                  const start = selected.start ? new Date(selected.start) : null
                  return start
                    ? `${selected.activityName ?? '—'} · ${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : (selected.activityName ?? selected.id)
                })()}
              </span>
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => {
                const start = s.start ? new Date(s.start) : null
                const end = s.end ? new Date(s.end) : null
                const label = start
                  ? start.toLocaleDateString([], {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    }) +
                    ' ' +
                    start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                    (end
                      ? ' – ' + end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '')
                  : s.id
                return (
                  <SelectItem key={s.id} value={s.id} label={s.activityName ?? '—'}>
                    {label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t('rebookCancel')}
          </Button>
          <Button
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={loading || !selectedId}
          >
            {loading ? t('rebookInProgress') : t('rebookConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── booking row ──────────────────────────────────────────────────────────────

function BookingRow({
  booking,
  sessionInfo,
  statusLabel,
  onAction,
  onRebook,
}: {
  booking: Booking
  sessionInfo?: SessionInfo
  statusLabel: Record<BookingStatus, string>
  onAction: (booking: Booking, action: BookingAction) => void
  onRebook: (booking: Booking) => void
}) {
  const t = useTranslations('Bookings')
  const router = useRouter()
  const status: BookingStatus = (booking.status as BookingStatus) ?? 'pending'
  // `formatIso` already renders the day AND the start time. A second
  // `formatTime` call sat here casting the ISO string to a Timestamp shape it
  // never had, so it returned '' and printed nothing; spelled honestly it would
  // print the time twice.
  const sessionDate = sessionInfo?.start ? formatIso(sessionInfo.start) : null
  const activityName = sessionInfo?.activityName

  const isPending = status === 'pending'
  const isConfirmed = status === 'confirmed'
  const isNoShow = status === 'no_show'
  const isActive = isPending || isConfirmed || isNoShow

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-0 group">
      <div
        className={`h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold ${avatarColor(booking.id)}`}
      >
        {initials(booking)}
      </div>

      <div className="flex-1 min-w-0">
        {/* The two entities a booking row is ABOUT are its contact and its
            session, and both used to be reachable only through the row's action
            menu — so the most common thing to do with a row cost a menu open.
            They are links now; the menu keeps the actions. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {booking.contact ? (
            <Link
              href={`/contacts/${booking.contact}` as Route}
              className="font-medium text-sm truncate hover:underline"
            >
              {booking.firstname} {booking.lastname}
            </Link>
          ) : (
            <p className="font-medium text-sm truncate">
              {booking.firstname} {booking.lastname}
            </p>
          )}
          {booking.is_new_contact && (
            <Badge variant="outline" className="text-xs shrink-0">
              {t('trialBadge')}
            </Badge>
          )}
        </div>
        {/* The reference rides with the email because it is the other thing a
            caller can read out. Until now it was minted, mailed to the contact
            and never shown to the studio, so a phone call about "booking
            BK-7F3K9Q" had nowhere to land. */}
        <p className="text-xs text-muted-foreground truncate">
          {booking.email ?? '—'}
          {booking.booking_reference && (
            <span className="ml-1.5">
              · {t('labelReference')} <span className="font-mono">{booking.booking_reference}</span>
            </span>
          )}
        </p>
        {(activityName || sessionDate) &&
          (() => {
            const sessionLine = (
              <>
                <span className="text-muted-foreground font-normal">{t('labelClassDate')} </span>
                {activityName && <span>{activityName}</span>}
                {activityName && sessionDate && (
                  <span className="text-muted-foreground font-normal"> · </span>
                )}
                {sessionDate && <span>{sessionDate}</span>}
              </>
            )
            return booking.session ? (
              <Link
                href={`/sessions/${booking.session}` as Route}
                className="block text-sm text-foreground/80 truncate mt-0.5 font-medium hover:underline"
              >
                {sessionLine}
              </Link>
            ) : (
              <p className="text-sm text-foreground/80 truncate mt-0.5 font-medium">
                {sessionLine}
              </p>
            )
          })()}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">
            {statusLabel[status]}
          </Badge>
          {/* Two dates show on a row and only one of them is the one the filter
              is ranging on, so both say which they are. */}
          <p className="text-xs text-muted-foreground">
            {t('labelBookedOn')} {formatDate(booking.joinedAt as Parameters<typeof formatDate>[0])}
            {formatTime(booking.joinedAt as Parameters<typeof formatTime>[0]) && (
              <> · {formatTime(booking.joinedAt as Parameters<typeof formatTime>[0])}</>
            )}
          </p>
        </div>
        <div className="flex sm:hidden">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">
            {statusLabel[status]}
          </Badge>
        </div>

        {isActive && (
          <DropdownMenu>
            <DropdownMenuTrigger className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isPending && (
                <DropdownMenuItem onClick={() => onAction(booking, 'confirm')} className="gap-2">
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  {t('actionConfirm')}
                </DropdownMenuItem>
              )}
              {isConfirmed && (
                <DropdownMenuItem onClick={() => onAction(booking, 'revert')} className="gap-2">
                  <Undo className="h-3.5 w-3.5 text-orange-500" />
                  {t('actionRevert')}
                </DropdownMenuItem>
              )}
              {(isPending || isNoShow) && (
                <DropdownMenuItem onClick={() => onAction(booking, 'no_show')} className="gap-2">
                  <UserX className="h-3.5 w-3.5 text-orange-500" />
                  {t('actionNoShow')}
                </DropdownMenuItem>
              )}
              {isPending && booking.booking_token && (
                <DropdownMenuItem onClick={() => onRebook(booking)} className="gap-2">
                  <Repeat className="h-3.5 w-3.5" />
                  {t('actionRebook')}
                </DropdownMenuItem>
              )}
              {(isPending || isNoShow) && <DropdownMenuSeparator />}
              {(isPending || isNoShow) && (
                <DropdownMenuItem
                  onClick={() => onAction(booking, 'cancel')}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('actionCancel')}
                </DropdownMenuItem>
              )}
              {(booking.session || booking.contact) && <DropdownMenuSeparator />}
              {booking.session && (
                <DropdownMenuItem
                  onClick={() => router.push(`/sessions/${booking.session}` as Route)}
                  className="gap-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('viewSession')}
                </DropdownMenuItem>
              )}
              {booking.contact && (
                <DropdownMenuItem
                  onClick={() => router.push(`/contacts/${booking.contact}` as Route)}
                  className="gap-2"
                >
                  <User className="h-3.5 w-3.5" />
                  {t('viewContact')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type StatusFilter = BookingStatus | 'all'

/** Stable identity for the idle branch of `useSessionMap`. */
const NO_BOOKINGS: Booking[] = []

/** Stable identity for the rebook picker before its exclusion set has loaded. */
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set<string>()

export default function BookingsPage() {
  const { currentTeamId } = useAuth()
  const t = useTranslations('Bookings')
  const tNav = useTranslations('Nav')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateAxis, setDateAxis] = useState<BookingDateAxis>('class')
  const [dateFrom, setDateFrom] = useState(() => rangeForPreset(DEFAULT_RANGE).from)
  const [dateTo, setDateTo] = useState(() => rangeForPreset(DEFAULT_RANGE).to)
  const [quickRange, setQuickRange] = useState<QuickRange>(DEFAULT_RANGE)
  const [rebookTarget, setRebookTarget] = useState<Booking | null>(null)

  const windowFrom = useMemo(() => startOfDay(dateFrom), [dateFrom])
  const windowTo = useMemo(() => endOfDay(dateTo), [dateTo])

  const {
    data: windowData,
    isLoading,
    isError,
    error,
    refetch,
  } = useBookingsWindow(currentTeamId, dateAxis, windowFrom, windowTo)
  const bookings = useMemo(() => windowData?.bookings ?? [], [windowData])
  const tooWide = windowData?.tooWide ?? false
  const truncated = windowData?.truncated ?? false

  // On the class axis the fan-out already read the session docs; on the booking
  // axis they have to be resolved for the rows.
  const { data: fetchedSessions = {} } = useSessionMap(
    dateAxis === 'booking' ? bookings : NO_BOOKINGS
  )
  const sessionMap: Record<string, SessionInfo> =
    dateAxis === 'class' ? (windowData?.sessions ?? {}) : fetchedSessions

  // Both of the rebook picker's inputs are fetched only once the dialog opens,
  // so both pending states have to reach it — see `loadingOptions` there.
  const { data: futureSessions = [], isLoading: futureLoading } = useFutureSessions(
    currentTeamId,
    !!rebookTarget
  )
  const { data: bookedSessionIds, isLoading: bookedLoading } = useContactBookedSessions(
    currentTeamId,
    rebookTarget?.contact ?? null
  )
  const { mutate: doAction } = useBookingAction(currentTeamId)
  const { mutate: doRebook, isPending: rebooking } = useRebookAction(currentTeamId)

  // A `BK-…` code is looked up across the tenant rather than filtered out of the
  // window — the booking a caller is asking about is precisely the one the window
  // does not hold. A bare six-character word may be a code or a name, so a miss is
  // only REPORTED when the prefix was typed; otherwise the list below just filters.
  const searchTrimmed = search.trim()
  const referenceCode = parseBookingReference(searchTrimmed)
  const referenceExplicit = /^bk-/i.test(searchTrimmed)
  const {
    data: referenceMatches,
    isLoading: referenceLoading,
    isError: referenceErrored,
    error: referenceError,
    refetch: refetchReference,
  } = useBookingReference(currentTeamId, referenceCode)
  const referenceHits = referenceMatches?.bookings ?? []
  const showReferenceBand = !!referenceCode && (referenceExplicit || referenceHits.length > 0)

  // Apply a predefined window: fills From/To and (re)applies the date filter.
  const applyQuickRange = useCallback((preset: QuickRange) => {
    setQuickRange(preset)
    if (preset === 'custom') return
    const { from, to } = rangeForPreset(preset)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  // Switching to the booking date drops any window that lies ahead of today,
  // because `joinedAt` never does. Both shapes are caught: a forward PRESET, and
  // a custom From the manager typed past today — either would otherwise answer a
  // deliberate question with an empty list and no reason for it.
  const handleAxisChange = useCallback(
    (axis: BookingDateAxis) => {
      setDateAxis(axis)
      if (axis === 'class') return
      const from = startOfDay(dateFrom)
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (FORWARD_RANGES.has(quickRange) || (from && from > today)) applyQuickRange(DEFAULT_RANGE)
    },
    [applyQuickRange, dateFrom, quickRange]
  )

  // Manual picker edits are clamped rather than refused: the window is the query
  // now, and a browser fanning out over a year of classes is the cost the cap
  // exists to stop. Clearing a field falls back to the default window — there is
  // no half-open range to fall back to.
  const handleFromChange = useCallback(
    (d: Date | undefined) => {
      if (!d) return applyQuickRange(DEFAULT_RANGE)
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      setQuickRange('custom')
      setDateFrom(ymd(from))
      setDateTo((prev) => {
        const to = startOfDay(prev)
        if (!to || to < from) return ymd(from)
        return daysBetween(from, to) > MAX_RANGE_DAYS
          ? ymd(addDays(from, MAX_RANGE_DAYS - 1))
          : prev
      })
    },
    [applyQuickRange]
  )

  const handleToChange = useCallback(
    (d: Date | undefined) => {
      if (!d) return applyQuickRange(DEFAULT_RANGE)
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      setQuickRange('custom')
      setDateTo(ymd(to))
      setDateFrom((prev) => {
        const from = startOfDay(prev)
        if (!from || from > to) return ymd(to)
        return daysBetween(from, to) > MAX_RANGE_DAYS
          ? ymd(addDays(to, -(MAX_RANGE_DAYS - 1)))
          : prev
      })
    },
    [applyQuickRange]
  )

  const visibleGroups = useMemo(() => rangeGroupsForAxis(dateAxis), [dateAxis])

  // Measured midnight-to-midnight, not against `windowTo` (end of day).
  const spanAtCap = useMemo(() => {
    const from = startOfDay(dateFrom)
    const to = startOfDay(dateTo)
    return !!from && !!to && daysBetween(from, to) >= MAX_RANGE_DAYS
  }, [dateFrom, dateTo])

  const statusLabel: Record<BookingStatus, string> = {
    pending: t('statusPending'),
    confirmed: t('statusConfirmed'),
    cancelled: t('statusCancelled'),
    no_show: t('statusNoShow'),
    rebooked: t('statusRebooked'),
  }

  const handleAction = useCallback(
    (booking: Booking, action: BookingAction) => doAction({ booking, action }),
    [doAction]
  )

  const handleRebookConfirm = useCallback(
    (newSessionId: string) => {
      if (!rebookTarget?.booking_token) return
      doRebook(
        { token: rebookTarget.booking_token, newSessionId },
        { onSuccess: () => setRebookTarget(null) }
      )
    },
    [rebookTarget, doRebook]
  )

  // Text only — the date window is the QUERY now, so filtering the loaded rows by
  // date again would just hide part of what was asked for.
  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bookings
    return bookings.filter((b) => {
      const name = `${b.firstname} ${b.lastname}`.toLowerCase()
      return (
        name.includes(q) ||
        (b.email ?? '').toLowerCase().includes(q) ||
        (b.booking_reference ?? '').toLowerCase().includes(q)
      )
    })
  }, [bookings, search])

  const counts: Record<StatusFilter, number> = {
    all: searchFiltered.length,
    pending: searchFiltered.filter((b) => (b.status ?? 'pending') === 'pending').length,
    confirmed: searchFiltered.filter((b) => b.status === 'confirmed').length,
    cancelled: searchFiltered.filter((b) => b.status === 'cancelled').length,
    no_show: searchFiltered.filter((b) => b.status === 'no_show').length,
    rebooked: searchFiltered.filter((b) => b.status === 'rebooked').length,
  }

  const filtered = useMemo(
    () =>
      statusFilter === 'all'
        ? searchFiltered
        : searchFiltered.filter((b) => (b.status ?? 'pending') === statusFilter),
    [searchFiltered, statusFilter]
  )

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('tabAll') },
    { key: 'pending', label: t('statusPending') },
    { key: 'confirmed', label: t('statusConfirmed') },
    { key: 'no_show', label: t('statusNoShow') },
    { key: 'cancelled', label: t('statusCancelled') },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {/* WHERE THESE BOOKINGS COME FROM. Every row in this list arrived
              through the public booking page, and there was no way to open it
              from here — the studio had to know the URL, or go looking for it in
              Settings (Franco, 2026-08-28). */}
          <PublicSurfaceLink subPath="booking" label={tNav('bookingPage')} />
        </div>
        {/* The window COUNT used to sit here. It is already visible in the rows
            themselves, and the two surfaces a studio moves to from a booking
            list — the grid it sits on, and the sheet it gets printed onto — had
            no pointer at all. */}
        <QuickLinks
          links={[
            { href: '/schedule' as Route, label: tNav('calendar') },
            { href: '/manifest' as Route, label: tNav('manifest') },
            { href: '/settings/booking' as Route, label: tNav('bookingPage') },
          ]}
        />
        {/* The truncation warning STAYS, and is not a description: without it a
            capped list looks like a complete one. The count is what was actually
            loaded, not the ceiling — the class axis stops on a class boundary,
            so it can hold a few more rows than the cap. */}
        {!isLoading && !isError && !tooWide && truncated && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('windowTruncated', { count: bookings.length })}
          </p>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={t('searchPlaceholderWithReference')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Which date, then the window on it. The axis is a stated choice rather
          than a relabelled filter: a row carries a class date AND a booking date,
          and the old From/To said nothing about which one it ranged on. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t('dateAxisLabel')}</span>
        <div
          className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5"
          role="group"
          aria-label={t('dateAxisLabel')}
        >
          {(['class', 'booking'] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => handleAxisChange(axis)}
              aria-pressed={dateAxis === axis}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                dateAxis === axis
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {axis === 'class' ? t('axisClassDate') : t('axisBookingDate')}
            </button>
          ))}
        </div>
        <Select value={quickRange} onValueChange={(v) => applyQuickRange(v as QuickRange)}>
          <SelectTrigger className="h-9 w-[10rem] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleGroups.map((g, gi) => (
              <Fragment key={g.key}>
                {gi > 0 && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>{t(`rangeGroup_${g.key}` as Parameters<typeof t>[0])}</SelectLabel>
                  {g.ranges.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`range_${r}` as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </Fragment>
            ))}
            {/* Only while it IS the value — a custom range is something the date
                pickers produced, never something you pick from this list. */}
            {quickRange === 'custom' && (
              <Fragment key="custom">
                <SelectSeparator />
                <SelectGroup>
                  <SelectItem value="custom">{t('range_custom')}</SelectItem>
                </SelectGroup>
              </Fragment>
            )}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterFrom')}</span>
          <DatePicker
            value={windowFrom ?? undefined}
            onChange={handleFromChange}
            placeholder="—"
            className="w-[9rem]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterTo')}</span>
          <DatePicker
            value={startOfDay(dateTo) ?? undefined}
            onChange={handleToChange}
            placeholder="—"
            className="w-[9rem]"
          />
        </div>
        {spanAtCap && (
          <span className="text-xs text-muted-foreground">
            {t('rangeMaxSpan', { days: MAX_RANGE_DAYS })}
          </span>
        )}
      </div>

      {/* Reference lookup — pinned above the list, because a hit is normally
          OUTSIDE the window the studio is looking at. */}
      {showReferenceBand && (
        <div className="rounded-xl border overflow-hidden bg-card">
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/40">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium">
              {t('referenceMatchHeading', { code: referenceCode ?? '' })}
            </p>
          </div>
          {referenceErrored ? (
            <QueryErrorState
              onRetry={() => refetchReference()}
              detail={errorMessage(referenceError)}
            />
          ) : referenceLoading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('referenceSearching')}
            </p>
          ) : referenceHits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('referenceNotFound', { code: referenceCode ?? '' })}
            </p>
          ) : (
            <>
              {/* Codes are minted without a collision check, so more than one
                  booking can answer to the same one. */}
              {referenceHits.length > 1 && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-b">
                  {t('referenceMultipleMatches', { count: referenceHits.length })}
                </p>
              )}
              {referenceHits.map((b) => (
                <BookingRow
                  key={b.session ? `${b.session}_${b.id}` : b.id}
                  booking={b}
                  sessionInfo={b.session ? referenceMatches?.sessions[b.session] : undefined}
                  statusLabel={statusLabel}
                  onAction={handleAction}
                  onRebook={setRebookTarget}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              statusFilter === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {counts[key] > 0 && (
              <span
                className={`text-xs rounded-full px-1.5 py-0.5 leading-none ${
                  statusFilter === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List. A FAILED query renders as a failure — it used to render as "no
          bookings yet", which turns a missing index or a rules change into a
          studio believing its bookings are gone. */}
      <div className="rounded-xl border overflow-hidden bg-card">
        {isError ? (
          <QueryErrorState onRetry={() => refetch()} detail={errorMessage(error)} />
        ) : isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))
        ) : tooWide ? (
          // Said out loud rather than trimmed to the first N classes: a list
          // quietly missing half its window is the defect this page had.
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t('windowTooWideTitle')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('windowTooWide', { count: MAX_WINDOW_SESSIONS })}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center text-muted-foreground text-sm">
            {/* Scoped to the window, not to the tenant. "No bookings yet." was
                true of an all-time page; against a one-week window it tells a
                studio with thousands of bookings that it has none — and
                contradicts the header, which already says "0 in this range". */}
            {search ? t('emptySearch') : t('emptyWindow')}
          </div>
        ) : (
          filtered.map((b) => (
            <BookingRow
              key={b.session ? `${b.session}_${b.id}` : b.id}
              booking={b}
              sessionInfo={b.session ? sessionMap[b.session] : undefined}
              statusLabel={statusLabel}
              onAction={handleAction}
              onRebook={setRebookTarget}
            />
          ))
        )}
      </div>

      {/* Rebook dialog */}
      {rebookTarget && (
        <RebookDialog
          booking={rebookTarget}
          futureSessions={futureSessions}
          bookedSessionIds={bookedSessionIds ?? EMPTY_SESSION_IDS}
          loadingOptions={futureLoading || bookedLoading}
          onConfirm={handleRebookConfirm}
          onClose={() => setRebookTarget(null)}
          loading={rebooking}
        />
      )}
    </div>
  )
}
