'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SESSIONS_COLLECTION } from '@lineup/shared'
import type { Session } from '@lineup/shared'
import { CalendarPlus, Users } from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(ts: { toDate(): Date } | null | undefined): { date: string; time: string } {
  if (!ts) return { date: '—', time: '' }
  const d = ts.toDate()
  return {
    date: d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
}

function sessionDuration(s: Session): string {
  if (!s.start || !s.end) return ''
  const mins = Math.round((s.end.toDate().getTime() - s.start.toDate().getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── data hooks ──────────────────────────────────────────────────────────────

function useUpcomingSessions(teamId: string | null) {
  return useQuery<Session[]>({
    queryKey: ['sessions', 'upcoming', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        where('start', '>=', Timestamp.now()),
        orderBy('start', 'asc'),
        limit(50),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)
    },
  })
}

function usePastSessions(teamId: string | null) {
  return useQuery<Session[]>({
    queryKey: ['sessions', 'past', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        where('start', '<', Timestamp.now()),
        orderBy('start', 'desc'),
        limit(50),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)
    },
  })
}

// ─── table ────────────────────────────────────────────────────────────────────

function SessionTable({ sessions, isLoading, emptyText }: {
  sessions: Session[]
  isLoading: boolean
  emptyText: string
}) {
  const t = useTranslations('Sessions')
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colDate')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colTime')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colActivity')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colLocation')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colDuration')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              <Users className="h-4 w-4" />
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-14" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
              </tr>
            ))}

          {!isLoading && sessions.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          )}

          {!isLoading &&
            sessions.map((s) => {
              const { date, time } = formatDateTime(s.start)
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{time}</td>
                  <td className="px-4 py-3">
                    {s.activityName ? (
                      <Badge variant="secondary">{s.activityName}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.location ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{sessionDuration(s)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.participants_count ?? 0}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'upcoming' | 'past'

export default function SessionsPage() {
  const { currentTeamId } = useAuth()
  const [tab, setTab] = useState<Tab>('upcoming')
  const t = useTranslations('Sessions')

  const upcoming = useUpcomingSessions(currentTeamId)
  const past = usePastSessions(currentTeamId)

  const current = tab === 'upcoming' ? upcoming : past
  const upcomingCount = upcoming.data?.length ?? 0

  const tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: t('tabUpcoming') },
    { key: 'past', label: t('tabPast') },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!upcoming.isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { count: upcomingCount })}
            </p>
          )}
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          disabled
          title={useTranslations('Common')('comingSoon')}
        >
          <CalendarPlus className="h-4 w-4" />
          {t('newSession')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <SessionTable
        sessions={current.data ?? []}
        isLoading={current.isLoading}
        emptyText={tab === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
      />
    </div>
  )
}
