'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-picker'
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
} from '@linyup/shared'
import type { Session, Activity } from '@linyup/shared'
import { CalendarPlus, MapPin, Pencil, Trash2, Users, List } from 'lucide-react'

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


// ─── schema ───────────────────────────────────────────────────────────────────

const SESSION_TYPES = ['group_class', 'coaching'] as const

const sessionSchema = z.object({
  activityId: z.string().optional(),
  activityType: z.enum(SESSION_TYPES).default('group_class'),
  start: z.date({ required_error: 'Required' }),
  end: z.date({ required_error: 'Required' }),
  location: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  allowBooking: z.boolean().optional(),
}).refine(
  (d) => !d.start || !d.end || d.end > d.start,
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
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      activityId: editing?.activityId ?? '',
      activityType: (editing?.activityType as typeof SESSION_TYPES[number]) ?? 'group_class',
      start: editing?.start?.toDate() ?? undefined,
      end: editing?.end?.toDate() ?? undefined,
      location: editing?.location ?? '',
      notes: editing?.notes ?? '',
      allowBooking: editing?.allowBooking ?? false,
    },
  })

  // Auto-fill activityType from the selected activity's type
  const watchedActivityId = watch('activityId')
  useEffect(() => {
    const activity = activities.find((a) => a.id === watchedActivityId)
    if (activity?.type) setValue('activityType', activity.type)
  }, [watchedActivityId, activities, setValue])

  const onSubmit = async (values: SessionFormValues) => {
    const activityEntry = activities.find((a) => a.id === values.activityId)
    const startTs = Timestamp.fromDate(values.start)
    const endTs = Timestamp.fromDate(values.end)

    const payload = {
      teamId,
      activityId: values.activityId || null,
      activityName: activityEntry?.name ?? null,
      activityType: values.activityType,
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
            <Controller
              name="activityId"
              control={control}
              render={({ field }) => (
                <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value && field.value !== '__none__'
                        ? activities.find((a) => a.id === field.value)?.name ?? field.value
                        : tCommon('all')}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{tCommon('all')}</SelectItem>
                    {activities.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Session type */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldType')}</label>
            <Controller
              name="activityType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value ? t(`type_${field.value}` as const) : '—'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>{t(`type_${tp}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {watchedActivityId && activities.find((a) => a.id === watchedActivityId)?.type && (
              <p className="text-xs text-muted-foreground">{t('typeAutoSet')}</p>
            )}
          </div>

          {/* Start */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldStart')}</label>
            <Controller
              name="start"
              control={control}
              render={({ field }) => (
                <DateTimePicker value={field.value} onChange={field.onChange} />
              )}
            />
            {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
          </div>

          {/* End */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldEnd')}</label>
            <Controller
              name="end"
              control={control}
              render={({ field }) => (
                <DateTimePicker value={field.value} onChange={field.onChange} />
              )}
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
    { key: 'past',     label: t('tabPast') },
  ]

  const listTab = tab === 'upcoming' ? upcoming : past

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
        onDelete={handleDelete}
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
