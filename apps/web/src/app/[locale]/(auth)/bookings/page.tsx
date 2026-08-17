'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collectionGroup,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { confirmClearedHoldFields, type Booking } from '@linyup/shared'
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
} from 'lucide-react'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'

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

type QuickRange =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisWeek'
  | 'thisMonth'
  | 'custom'

const QUICK_RANGES: Exclude<QuickRange, 'custom'>[] = [
  'all',
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisWeek',
  'thisMonth',
]

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Returns local-calendar from/to dates (yyyy-mm-dd) for a preset, or empty strings.
function rangeForPreset(preset: QuickRange): { from: string; to: string } {
  if (preset === 'all' || preset === 'custom') return { from: '', to: '' }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let from = new Date(today)
  const to = new Date(today)
  switch (preset) {
    case 'today':
      break
    case 'yesterday':
      from.setDate(today.getDate() - 1)
      to.setDate(today.getDate() - 1)
      break
    case 'last7':
      from.setDate(today.getDate() - 6)
      break
    case 'last30':
      from.setDate(today.getDate() - 29)
      break
    case 'thisWeek': {
      const mondayOffset = (today.getDay() + 6) % 7 // Mon = 0
      from.setDate(today.getDate() - mondayOffset)
      break
    }
    case 'thisMonth':
      from = new Date(today.getFullYear(), today.getMonth(), 1)
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

interface SessionInfo {
  activityName?: string
  start?: string
  end?: string
  allowBooking?: boolean
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useBookings(teamId: string | null) {
  return useQuery<Booking[]>({
    queryKey: ['bookings', 'all', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collectionGroup(db, 'bookings'),
        where('teamId', '==', teamId),
        orderBy('joinedAt', 'desc'),
        limit(200)
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Booking)
    },
  })
}

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

// Future sessions available for rebooking
function useFutureSessions(teamId: string | null) {
  return useQuery<{ id: string; activityName?: string; start?: string; end?: string }[]>({
    queryKey: ['future-sessions', teamId],
    enabled: !!teamId,
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
        // Add participant from booking data
        const participantRef = doc(db, 'sessions', booking.session, 'participants', booking.id)
        batch.set(participantRef, {
          fullname: `${booking.firstname ?? ''} ${booking.lastname ?? ''}`.trim(),
          firstname: booking.firstname ?? '',
          lastname: booking.lastname ?? '',
          avatar_url: null,
          contact: booking.contact ?? booking.id,
          session: booking.session,
          confirmedFromBooking: true,
        })
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
        // Remove participant doc
        const participantRef = doc(db, 'sessions', booking.session, 'participants', booking.id)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings', 'all', teamId] }),
  })
}

function useRebookAction(teamId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ token, newSessionId }: { token: string; newSessionId: string }) => {
      const fn = httpsCallable(functions, 'rebookSession')
      await fn({ token, newSessionId })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings', 'all', teamId] }),
  })
}

// ─── rebook dialog ────────────────────────────────────────────────────────────

function RebookDialog({
  booking,
  futureSessions,
  bookedSessionIds,
  onConfirm,
  onClose,
  loading,
}: {
  booking: Booking
  futureSessions: { id: string; activityName?: string; start?: string; end?: string }[]
  bookedSessionIds: Set<string>
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
        {options.length === 0 ? (
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
                  <SelectItem key={s.id} value={s.id}>
                    <span className="font-medium">{s.activityName ?? '—'}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{label}</span>
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
  const sessionDate = sessionInfo?.start ? formatIso(sessionInfo.start) : null
  const sessionTime = sessionInfo?.start
    ? formatTime(sessionInfo.start as unknown as { toDate(): Date })
    : null
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
        <p className="text-xs text-muted-foreground truncate">{booking.email ?? '—'}</p>
        {(activityName || sessionDate) &&
          (() => {
            const sessionLine = (
              <>
                {activityName && <span>{activityName}</span>}
                {activityName && sessionDate && (
                  <span className="text-muted-foreground font-normal"> · </span>
                )}
                {sessionDate && <span>{sessionDate}</span>}
                {sessionTime && (
                  <span className="text-muted-foreground font-normal"> {sessionTime}</span>
                )}
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
              <p className="text-sm text-foreground/80 truncate mt-0.5 font-medium">{sessionLine}</p>
            )
          })()}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">
            {statusLabel[status]}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {formatDate(booking.joinedAt as Parameters<typeof formatDate>[0])}
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

export default function BookingsPage() {
  const { currentTeamId } = useAuth()
  const { data: bookings = [], isLoading } = useBookings(currentTeamId)
  const { data: sessionMap = {} } = useSessionMap(bookings)
  const { data: futureSessions = [] } = useFutureSessions(currentTeamId)
  const { mutate: doAction } = useBookingAction(currentTeamId)
  const { mutate: doRebook, isPending: rebooking } = useRebookAction(currentTeamId)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [quickRange, setQuickRange] = useState<QuickRange>('all')
  const [rebookTarget, setRebookTarget] = useState<Booking | null>(null)
  const t = useTranslations('Bookings')

  // Apply a predefined window: fills From/To and (re)applies the date filter.
  const applyQuickRange = useCallback((preset: QuickRange) => {
    setQuickRange(preset)
    if (preset === 'custom') return
    const { from, to } = rangeForPreset(preset)
    setDateFrom(from)
    setDateTo(to)
  }, [])

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

  // Session IDs already booked by the rebookTarget contact (exclude from picker)
  const bookedSessionIds = useMemo(() => {
    if (!rebookTarget) return new Set<string>()
    return new Set(
      bookings
        .filter((b) => b.contact === rebookTarget.contact && b.session)
        .map((b) => b.session as string)
    )
  }, [rebookTarget, bookings])

  const searchFiltered = useMemo(() => {
    let result = bookings
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter((b) => {
        const name = `${b.firstname} ${b.lastname}`.toLowerCase()
        return name.includes(q) || (b.email ?? '').toLowerCase().includes(q)
      })
    }
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((b) => {
        const d = tsToDate(b.joinedAt)
        return d ? d >= from : false
      })
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter((b) => {
        const d = tsToDate(b.joinedAt)
        return d ? d <= to : false
      })
    }
    return result
  }, [bookings, search, dateFrom, dateTo])

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

  const trials = bookings.filter((b) => b.is_new_contact).length

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
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        {!isLoading && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('subtitle', { total: bookings.length, trials })}
          </p>
        )}
      </div>

      {/* Search + date range */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={quickRange} onValueChange={(v) => applyQuickRange(v as QuickRange)}>
          <SelectTrigger className="h-9 w-[10rem] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUICK_RANGES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`range_${r}` as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
            {quickRange === 'custom' && (
              <SelectItem value="custom">{t('range_custom')}</SelectItem>
            )}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterFrom')}</span>
          <DatePicker
            value={dateFrom ? new Date(dateFrom) : undefined}
            onChange={(d) => {
              setDateFrom(d ? d.toISOString().split('T')[0] : '')
              setQuickRange('custom')
            }}
            placeholder="—"
            className="w-[9rem]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterTo')}</span>
          <DatePicker
            value={dateTo ? new Date(dateTo) : undefined}
            onChange={(d) => {
              setDateTo(d ? d.toISOString().split('T')[0] : '')
              setQuickRange('custom')
            }}
            placeholder="—"
            className="w-[9rem]"
          />
        </div>
      </div>

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

      {/* List */}
      <div className="rounded-xl border overflow-hidden bg-card">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}

        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-16 text-center text-muted-foreground text-sm">
            {search ? t('emptySearch') : t('empty')}
          </div>
        )}

        {!isLoading &&
          filtered.map((b) => (
            <BookingRow
              key={b.session ? `${b.session}_${b.id}` : b.id}
              booking={b}
              sessionInfo={b.session ? sessionMap[b.session] : undefined}
              statusLabel={statusLabel}
              onAction={handleAction}
              onRebook={setRebookTarget}
            />
          ))}
      </div>

      {/* Rebook dialog */}
      {rebookTarget && (
        <RebookDialog
          booking={rebookTarget}
          futureSessions={futureSessions}
          bookedSessionIds={bookedSessionIds}
          onConfirm={handleRebookConfirm}
          onClose={() => setRebookTarget(null)}
          loading={rebooking}
        />
      )}
    </div>
  )
}
