'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collectionGroup, query, where, orderBy, limit, getDocs,
  doc, getDoc, writeBatch, serverTimestamp, increment,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Booking } from '@lineup/shared'
import { Search, MoreHorizontal, Check, X, UserX } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initials(b: Booking) {
  return `${b.firstname?.[0] ?? ''}${b.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-red-500', 'bg-indigo-500',
]
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
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
        limit(200),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking)
    },
  })
}

function useSessionMap(bookings: Booking[]) {
  const sessionIds = useMemo(
    () => [...new Set(bookings.map((b) => b.session).filter((s): s is string => !!s))],
    [bookings],
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
            start: (data.start as { toDate(): Date } | undefined)?.toDate().toISOString(),
            end: (data.end as { toDate(): Date } | undefined)?.toDate().toISOString(),
          }
        }
      }
      return map
    },
  })
}

// ─── admin actions ────────────────────────────────────────────────────────────

function useBookingAction(teamId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ booking, action }: { booking: Booking; action: 'confirm' | 'no_show' | 'cancel' }) => {
      if (!booking.session) throw new Error('Missing session ID on booking')
      const bookingRef = doc(db, 'sessions', booking.session, 'bookings', booking.id)
      const batch = writeBatch(db)

      if (action === 'confirm') {
        batch.update(bookingRef, { status: 'confirmed', confirmed_at: serverTimestamp() })
      } else if (action === 'no_show') {
        batch.update(bookingRef, { status: 'no_show', no_show_at: serverTimestamp() })
      } else {
        batch.update(bookingRef, { status: 'cancelled', cancelled_at: serverTimestamp(), cancelled_by: 'admin' })
        const wasPending = !booking.status || booking.status === 'pending'
        if (wasPending) {
          batch.update(doc(db, 'sessions', booking.session), { portal_bookings_count: increment(-1) })
          if (booking.contact) {
            batch.update(doc(db, 'contacts', booking.contact), { pending_bookings_count: increment(-1) })
          }
        }
      }
      await batch.commit()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings', 'all', teamId] }),
  })
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type StatusFilter = BookingStatus | 'all'

// ─── booking row ──────────────────────────────────────────────────────────────

function BookingRow({
  booking,
  sessionInfo,
  statusLabel,
  onAction,
}: {
  booking: Booking
  sessionInfo?: SessionInfo
  statusLabel: Record<BookingStatus, string>
  onAction: (booking: Booking, action: 'confirm' | 'no_show' | 'cancel') => void
}) {
  const status: BookingStatus = (booking.status as BookingStatus) ?? 'pending'
  const sessionDate = sessionInfo?.start ? formatIso(sessionInfo.start) : null
  const activityName = sessionInfo?.activityName

  const canConfirm = status === 'pending'
  const canNoShow = status === 'confirmed' || status === 'pending'
  const canCancel = status !== 'cancelled' && status !== 'rebooked'

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-0 group">
      <div className={`h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold ${avatarColor(booking.id)}`}>
        {initials(booking)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="font-medium text-sm truncate">{booking.firstname} {booking.lastname}</p>
          {booking.is_new_contact && (
            <Badge variant="outline" className="text-xs shrink-0">Trial</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{booking.email ?? '—'}</p>
        {(activityName || sessionDate) && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {activityName && <span className="font-medium">{activityName}</span>}
            {activityName && sessionDate && ' · '}
            {sessionDate}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">{statusLabel[status]}</Badge>
          <p className="text-xs text-muted-foreground">
            {formatDate(booking.joinedAt as Parameters<typeof formatDate>[0])}
            {formatTime(booking.joinedAt as Parameters<typeof formatTime>[0]) && (
              <> · {formatTime(booking.joinedAt as Parameters<typeof formatTime>[0])}</>
            )}
          </p>
        </div>
        <div className="flex sm:hidden">
          <Badge variant={STATUS_VARIANT[status]} className="text-xs">{statusLabel[status]}</Badge>
        </div>

        {(canConfirm || canNoShow || canCancel) && (
          <DropdownMenu>
            <DropdownMenuTrigger className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canConfirm && (
                <DropdownMenuItem onClick={() => onAction(booking, 'confirm')} className="gap-2">
                  <Check className="h-3.5 w-3.5 text-green-600" /> Confirm attendance
                </DropdownMenuItem>
              )}
              {canNoShow && (
                <DropdownMenuItem onClick={() => onAction(booking, 'no_show')} className="gap-2">
                  <UserX className="h-3.5 w-3.5 text-orange-500" /> Mark as no-show
                </DropdownMenuItem>
              )}
              {(canConfirm || canNoShow) && canCancel && <DropdownMenuSeparator />}
              {canCancel && (
                <DropdownMenuItem onClick={() => onAction(booking, 'cancel')} className="gap-2 text-destructive focus:text-destructive">
                  <X className="h-3.5 w-3.5" /> Cancel booking
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

export default function BookingsPage() {
  const { currentTeamId } = useAuth()
  const { data: bookings = [], isLoading } = useBookings(currentTeamId)
  const { data: sessionMap = {} } = useSessionMap(bookings)
  const { mutate: doAction } = useBookingAction(currentTeamId)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const t = useTranslations('Bookings')

  const statusLabel: Record<BookingStatus, string> = {
    pending: t('statusPending'),
    confirmed: t('statusConfirmed'),
    cancelled: t('statusCancelled'),
    no_show: t('statusNoShow'),
    rebooked: t('statusRebooked'),
  }

  const handleAction = useCallback(
    (booking: Booking, action: 'confirm' | 'no_show' | 'cancel') => doAction({ booking, action }),
    [doAction],
  )

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
        const ts = b.joinedAt as { toDate(): Date } | undefined
        return ts ? ts.toDate() >= from : false
      })
    }
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
      result = result.filter((b) => {
        const ts = b.joinedAt as { toDate(): Date } | undefined
        return ts ? ts.toDate() <= to : false
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
    () => statusFilter === 'all' ? searchFiltered : searchFiltered.filter((b) => (b.status ?? 'pending') === statusFilter),
    [searchFiltered, statusFilter],
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
    <div className="space-y-4">
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterFrom')}</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 text-sm" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{t('filterTo')}</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 text-sm" />
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
              <span className={`text-xs rounded-full px-1.5 py-0.5 leading-none ${
                statusFilter === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
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

        {!isLoading && filtered.map((b) => (
          <BookingRow
            key={b.id}
            booking={b}
            sessionInfo={b.session ? sessionMap[b.session] : undefined}
            statusLabel={statusLabel}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  )
}
