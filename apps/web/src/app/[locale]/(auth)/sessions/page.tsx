'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  SESSIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
} from '@lineup/shared'
import type { Session, Activity } from '@lineup/shared'
import { CalendarPlus, MapPin, Pencil, Trash2, Users } from 'lucide-react'

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

function tsToInputValue(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  const d = ts.toDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── schema ───────────────────────────────────────────────────────────────────

const sessionSchema = z.object({
  activityId: z.string().optional(),
  start: z.string().min(1, 'Required'),
  end: z.string().min(1, 'Required'),
  location: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  allowBooking: z.boolean().optional(),
}).refine(
  (d) => !d.start || !d.end || new Date(d.end) > new Date(d.start),
  { message: 'End must be after start', path: ['end'] },
)

type SessionFormValues = z.infer<typeof sessionSchema>

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
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Activity)
    },
  })
}

// ─── session dialog ───────────────────────────────────────────────────────────

function SessionDialog({
  open,
  onOpenChange,
  editing,
  activities,
  teamId,
  userId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: Session | null
  activities: Activity[]
  teamId: string
  userId: string
  onSaved: () => void
}) {
  const t = useTranslations('Sessions')
  const tCommon = useTranslations('Common')

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      activityId: editing?.activityId ?? '',
      start: tsToInputValue(editing?.start),
      end: tsToInputValue(editing?.end),
      location: editing?.location ?? '',
      notes: editing?.notes ?? '',
      allowBooking: editing?.allowBooking ?? false,
    },
  })

  const onSubmit = async (values: SessionFormValues) => {
    const activityEntry = activities.find((a) => a.id === values.activityId)
    const startTs = Timestamp.fromDate(new Date(values.start))
    const endTs = Timestamp.fromDate(new Date(values.end))

    const payload = {
      teamId,
      activityId: values.activityId || null,
      activityName: activityEntry?.name ?? null,
      start: startTs,
      end: endTs,
      location: values.location || null,
      notes: values.notes || null,
      allowBooking: values.allowBooking ?? false,
    }

    if (editing) {
      await updateDoc(doc(db, SESSIONS_COLLECTION, editing.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
    } else {
      await addDoc(collection(db, SESSIONS_COLLECTION), {
        ...payload,
        createdBy: userId,
        created_at: serverTimestamp(),
      })
    }

    reset()
    onSaved()
    onOpenChange(false)
  }

  const title = editing ? t('editSession') : t('newSession')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          {/* Activity */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('colActivity')}</label>
            <select
              {...register('activityId')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">{tCommon('all')}</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Start */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldStart')}</label>
            <input
              type="datetime-local"
              {...register('start')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
          </div>

          {/* End */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldEnd')}</label>
            <input
              type="datetime-local"
              {...register('end')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {errors.end && <p className="text-xs text-destructive">{errors.end.message}</p>}
          </div>

          {/* Location */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('colLocation')}</label>
            <input
              type="text"
              {...register('location')}
              placeholder={t('locationPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldNotes')}</label>
            <textarea
              {...register('notes')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Allow booking */}
          <div className="flex items-center gap-3">
            <Controller
              name="allowBooking"
              control={control}
              render={({ field }) => (
                <input
                  type="checkbox"
                  id="allowBooking"
                  checked={field.value ?? false}
                  onChange={field.onChange}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              )}
            />
            <label htmlFor="allowBooking" className="text-sm">{t('fieldAllowBooking')}</label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? tCommon('loading') : editing ? t('saveChanges') : t('createSession')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
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
                  <td className="px-4 py-3 font-medium">{date}</td>
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
  const t = useTranslations('Sessions')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()

  const upcoming = useUpcomingSessions(currentTeamId)
  const past = usePastSessions(currentTeamId)
  const activitiesQuery = useActivities(currentTeamId)

  const current = tab === 'upcoming' ? upcoming : past
  const upcomingCount = upcoming.data?.length ?? 0

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const handleNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (s: Session) => {
    setEditing(s)
    setDialogOpen(true)
  }

  const handleDelete = async (s: Session) => {
    const label = s.activityName
      ? `${s.activityName} – ${formatDateTime(s.start).date}`
      : formatDateTime(s.start).date
    if (!window.confirm(t('deleteConfirm', { label }))) return
    await deleteDoc(doc(db, SESSIONS_COLLECTION, s.id))
    invalidate()
  }

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
          onClick={handleNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
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
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {currentTeamId && user && (
        <SessionDialog
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
    </div>
  )
}
