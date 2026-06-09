'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, limit, getDocs, doc, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SESSIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
} from '@linyup/shared'
import type { Session, Activity } from '@linyup/shared'
import { CalendarPlus, MapPin, Pencil, Repeat2, Trash2, Users } from 'lucide-react'
import { SessionFormDialog } from '@/components/sessions/SessionFormDialog'
import { SessionDeleteDialog } from '@/components/sessions/SessionDeleteDialog'

// ─── helpers ──────────────────────────────────────────────────────────────────

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

// ─── data hooks ───────────────────────────────────────────────────────────────

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
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
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
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
    },
  })
}

function useActivities(teamId: string | null) {
  return useQuery<Activity[]>({
    queryKey: ['activities', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, ACTIVITIES_COLLECTION),
        where('teamId', '==', teamId),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Activity)
    },
  })
}

// ─── table ────────────────────────────────────────────────────────────────────

function SessionTable({
  sessions,
  isLoading,
  emptyText,
  onEdit,
  onDelete,
}: {
  sessions: Session[]
  isLoading: boolean
  emptyText: string
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
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
            <th className="text-left px-4 py-3 font-medium text-muted-foreground w-16" />
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
                <td className="px-4 py-3" />
              </tr>
            ))}

          {!isLoading && sessions.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          )}

          {!isLoading &&
            sessions.map((s) => {
              const { date, time } = formatDateTime(s.start)
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {date}
                      {s.seriesId && <Repeat2 className="h-3 w-3 text-muted-foreground" />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{time}</td>
                  <td className="px-4 py-3">
                    {s.activityName ? (
                      <Badge variant="secondary">{s.activityName}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{s.location}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{sessionDuration(s)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.participants_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onEdit(s)}
                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(s)}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
  const { currentTeamId, user } = useAuth()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const t = useTranslations('Sessions')
  const qc = useQueryClient()

  const upcoming = useUpcomingSessions(currentTeamId)
  const past = usePastSessions(currentTeamId)
  const activitiesQuery = useActivities(currentTeamId)

  const upcomingCount = upcoming.data?.length ?? 0

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sessions'] })

  const handleNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (s: Session) => {
    setEditing(s)
    setDialogOpen(true)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: t('tabUpcoming') },
    { key: 'past',     label: t('tabPast') },
  ]

  const listTab = tab === 'upcoming' ? upcoming : past

  const deleteLabel = deleting
    ? (deleting.activityName
        ? `${deleting.activityName} – ${formatDateTime(deleting.start).date}`
        : formatDateTime(deleting.start).date)
    : ''

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
          onClick={handleNew}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
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
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <SessionTable
        sessions={listTab.data ?? []}
        isLoading={listTab.isLoading}
        emptyText={tab === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
        onEdit={handleEdit}
        onDelete={setDeleting}
      />

      {/* Mobile FAB */}
      <button
        onClick={handleNew}
        className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
        aria-label={t('newSession')}
      >
        <CalendarPlus className="h-6 w-6" />
      </button>

      {currentTeamId && user && (
        <SessionFormDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
          activities={activitiesQuery.data ?? []}
          teamId={currentTeamId}
          userId={user.uid}
          onSaved={invalidate}
        />
      )}

      <SessionDeleteDialog
        open={!!deleting}
        onOpenChange={(v) => { if (!v) setDeleting(null) }}
        session={deleting}
        label={deleteLabel}
        onDeleted={invalidate}
      />
    </div>
  )
}
