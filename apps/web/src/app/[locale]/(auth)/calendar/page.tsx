'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, limit, getDocs, Timestamp,
  deleteDoc, doc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { SESSIONS_COLLECTION, ACTIVITIES_COLLECTION } from '@lineup/shared'
import type { Session, Activity, Event } from '@lineup/shared'
import { CalendarPlus } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-picker'
import { addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'

const SessionsCalendar = dynamic(() => import('../sessions/SessionsCalendar'), { ssr: false })

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(ts: { toDate(): Date } | null | undefined): { date: string; time: string } {
  if (!ts) return { date: '—', time: '' }
  const d = ts.toDate()
  return {
    date: d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
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

function useAllSessions(teamId: string | null) {
  return useQuery<Session[]>({
    queryKey: ['sessions', 'all', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        orderBy('start', 'asc'),
        limit(500),
      ))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)
    },
  })
}

function useActivities(teamId: string | null) {
  return useQuery<Activity[]>({
    queryKey: ['activities', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(query(
        collection(db, ACTIVITIES_COLLECTION),
        where('teamId', '==', teamId),
        orderBy('name', 'asc'),
      ))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Activity)
    },
  })
}

function useEvents(teamId: string | null) {
  return useQuery<Event[]>({
    queryKey: ['events', 'calendar', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(query(
        collection(db, 'events'),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        orderBy('start', 'asc'),
      ))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Event)
    },
  })
}

// ─── session form dialog (shared with sessions page) ─────────────────────────

function SessionFormDialog({
  open,
  editing,
  activities,
  teamId,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: Session | null
  activities: Activity[]
  teamId: string
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('Sessions')
  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: editing
      ? {
          activityId: editing.activityId ?? undefined,
          activityType: (editing.activityType as typeof SESSION_TYPES[number]) ?? 'group_class',
          start: (editing.start as { toDate(): Date }).toDate(),
          end: editing.end ? (editing.end as { toDate(): Date }).toDate() : undefined,
          location: editing.location ?? '',
          notes: editing.notes ?? '',
        }
      : { activityType: 'group_class' },
  })

  const onSubmit = async (values: SessionFormValues) => {
    const activityName = activities.find((a) => a.id === values.activityId)?.name ?? null
    const payload = {
      activityId: values.activityId ?? null,
      activityName,
      activityType: values.activityType,
      start: Timestamp.fromDate(values.start),
      end: Timestamp.fromDate(values.end),
      location: values.location ?? null,
      notes: values.notes ?? null,
      allowBooking: values.allowBooking ?? false,
    }
    if (editing) {
      await updateDoc(doc(db, SESSIONS_COLLECTION, editing.id), { ...payload, updatedAt: serverTimestamp() })
    } else {
      await addDoc(collection(db, SESSIONS_COLLECTION), {
        ...payload, teamId, createdBy: userId,
        status: 'open', participants_count: 0,
        created_at: serverTimestamp(),
      })
    }
    onSaved()
    onClose()
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('editSession') : t('newSession')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldActivity')}</label>
            <Controller name="activityId" control={control} render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder={t('fieldActivityPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {activities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldType')}</label>
            <Controller name="activityType" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="group_class">{t('typeGroupClass')}</SelectItem>
                  <SelectItem value="coaching">{t('typeCoaching')}</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldStart')}</label>
              <Controller name="start" control={control} render={({ field }) => (
                <DateTimePicker value={field.value} onChange={field.onChange} />
              )} />
              {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldEnd')}</label>
              <Controller name="end" control={control} render={({ field }) => (
                <DateTimePicker value={field.value} onChange={field.onChange} />
              )} />
              {errors.end && <p className="text-xs text-destructive">{errors.end.message}</p>}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldLocation')}</label>
            <input {...register('location')} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder={t('fieldLocationPlaceholder')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { onClose(); reset() }}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {isSubmitting ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { currentTeamId, user } = useAuth()
  const t = useTranslations('Sessions')
  const qc = useQueryClient()

  const sessions = useAllSessions(currentTeamId)
  const activities = useActivities(currentTeamId)
  const events = useEvents(currentTeamId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Session | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sessions'] })

  const handleEdit = (s: Session) => { setEditing(s); setDialogOpen(true) }
  const handleDelete = async (s: Session) => {
    const label = s.activityName
      ? `${s.activityName} – ${formatDateTime(s.start).date}`
      : formatDateTime(s.start).date
    if (!window.confirm(t('deleteConfirm', { label }))) return
    await deleteDoc(doc(db, SESSIONS_COLLECTION, s.id))
    invalidate()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sessions, coaching &amp; events</p>
        </div>
        <button
          onClick={() => { setEditing(null); setDialogOpen(true) }}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <CalendarPlus className="h-4 w-4" />
          {t('newSession')}
        </button>
      </div>

      <SessionsCalendar
        sessions={sessions.data ?? []}
        activities={activities.data ?? []}
        events={events.data ?? []}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <button
        onClick={() => { setEditing(null); setDialogOpen(true) }}
        className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
        aria-label={t('newSession')}
      >
        <CalendarPlus className="h-6 w-6" />
      </button>

      {currentTeamId && user && (
        <SessionFormDialog
          open={dialogOpen}
          editing={editing}
          activities={activities.data ?? []}
          teamId={currentTeamId}
          userId={user.uid}
          onClose={() => setDialogOpen(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
