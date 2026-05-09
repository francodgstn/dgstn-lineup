'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { collectionGroup, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { Booking } from '@lineup/shared'
import { Search } from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type BookingStatus = 'pending' | 'confirmed' | 'cancelled'

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  confirmed: 'default',
  cancelled: 'destructive',
}

// ─── data hook ───────────────────────────────────────────────────────────────

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

// ─── status tabs ─────────────────────────────────────────────────────────────

type StatusFilter = BookingStatus | 'all'

function StatusTabs({
  active,
  counts,
  onChange,
}: {
  active: StatusFilter
  counts: Record<StatusFilter, number>
  onChange: (s: StatusFilter) => void
}) {
  const t = useTranslations('Bookings')
  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('tabAll') },
    { key: 'pending', label: t('statusPending') },
    { key: 'confirmed', label: t('statusConfirmed') },
    { key: 'cancelled', label: t('statusCancelled') },
  ]

  return (
    <div className="flex gap-1 border-b">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            active === key
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {label}
          {counts[key] > 0 && (
            <span className={`text-xs rounded-full px-1.5 py-0.5 leading-none ${
              active === key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}>
              {counts[key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const { currentTeamId } = useAuth()
  const { data: bookings = [], isLoading } = useBookings(currentTeamId)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const t = useTranslations('Bookings')

  const statusLabel: Record<BookingStatus, string> = {
    pending: t('statusPending'),
    confirmed: t('statusConfirmed'),
    cancelled: t('statusCancelled'),
  }

  // Counts per tab (after search, before status filter)
  const searchFiltered = search.trim()
    ? bookings.filter((b) => {
        const q = search.toLowerCase()
        const name = `${b.firstname} ${b.lastname}`.toLowerCase()
        return name.includes(q) || (b.email ?? '').toLowerCase().includes(q)
      })
    : bookings

  const counts: Record<StatusFilter, number> = {
    all: searchFiltered.length,
    pending: searchFiltered.filter((b) => (b.status ?? 'pending') === 'pending').length,
    confirmed: searchFiltered.filter((b) => b.status === 'confirmed').length,
    cancelled: searchFiltered.filter((b) => b.status === 'cancelled').length,
  }

  const filtered =
    statusFilter === 'all'
      ? searchFiltered
      : searchFiltered.filter((b) => (b.status ?? 'pending') === statusFilter)

  const trials = bookings.filter((b) => b.is_new_contact).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { total: bookings.length, trials })}
            </p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status tabs */}
      <StatusTabs active={statusFilter} counts={counts} onChange={setStatusFilter} />

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colName')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colEmail')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colStatus')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colDate')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-36" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-14" /></td>
                </tr>
              ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  {search ? t('emptySearch') : t('empty')}
                </td>
              </tr>
            )}

            {!isLoading &&
              filtered.map((b) => {
                const status: BookingStatus = b.status ?? 'pending'
                return (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {(b.firstname?.[0] ?? '?').toUpperCase()}
                          </span>
                        </div>
                        <span className="font-medium">
                          {b.firstname} {b.lastname}
                        </span>
                        {b.is_new_contact && (
                          <Badge variant="outline" className="text-xs">{t('trialBadge')}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{b.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[status]}>{statusLabel[status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(b.joinedAt as Parameters<typeof formatDate>[0])}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatTime(b.joinedAt as Parameters<typeof formatTime>[0])}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
