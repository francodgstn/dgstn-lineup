'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-picker'
import { Slider } from '@/components/ui/slider'
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
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  SESSIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
} from '@linyup/shared'
import type { Session, Activity } from '@linyup/shared'
import { CalendarPlus, Loader2, MapPin, Pencil, Repeat2, Trash2, Users } from 'lucide-react'

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


// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly'
type EndCondition = 'never' | 'date' | 'count'

interface RecurrencePattern {
  frequency: RecurrenceFrequency
  interval: number
  daysOfWeek: number[]      // 0=Sun … 6=Sat (matches date-fns getDay)
  endCondition: EndCondition
  endDate: Date | null
  maxOccurrences: number
}

const DEFAULT_RECURRENCE: RecurrencePattern = {
  frequency: 'weekly',
  interval: 1,
  daysOfWeek: [],
  endCondition: 'never',
  endDate: null,
  maxOccurrences: 10,
}

function getPreviewDates(pattern: RecurrencePattern, startDate: Date, count = 5): Date[] {
  const dates: Date[] = []
  const cursor = new Date(startDate)
  const limit = count * 400

  for (let i = 0; i < limit && dates.length < count; i++) {
    const dow = cursor.getDay()
    const include =
      pattern.frequency === 'daily' ? true :
      pattern.frequency === 'weekly' ? pattern.daysOfWeek.includes(dow) :
      /* monthly */ cursor.getDate() === startDate.getDate()

    if (include && (dates.length === 0 || cursor.getTime() !== startDate.getTime())) {
      dates.push(new Date(cursor))
      if (pattern.endCondition === 'count' && dates.length >= pattern.maxOccurrences) break
      if (pattern.endCondition === 'date' && pattern.endDate && cursor >= pattern.endDate) break
    }

    if (pattern.frequency === 'daily') {
      cursor.setDate(cursor.getDate() + (include ? pattern.interval : 1))
    } else if (pattern.frequency === 'weekly') {
      cursor.setDate(cursor.getDate() + 1)
      // After iterating through a full week, jump interval-1 extra weeks
      if (cursor.getDay() === (startDate.getDay() + 1) % 7 && dates.length > 0 && pattern.interval > 1) {
        cursor.setDate(cursor.getDate() + (pattern.interval - 1) * 7)
      }
    } else {
      cursor.setMonth(cursor.getMonth() + pattern.interval)
    }
  }

  return dates
}

// ─── schema ───────────────────────────────────────────────────────────────────

const SESSION_TYPES = ['group_class', 'coaching'] as const

const sessionSchema = z.object({
  activityId: z.string().optional(),
  activityType: z.enum(SESSION_TYPES).default('group_class'),
  start: z.date({ required_error: 'Required' }),
  duration: z.number().min(15).max(480),
  location: z.string().max(120).optional(),
  instructorName: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  allowBooking: z.boolean().optional(),
})

type SessionFormValues = z.infer<typeof sessionSchema>

// ─── recurrence panel ─────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 0] as const

function RecurrencePanel({
  value,
  onChange,
  startDate,
}: {
  value: RecurrencePattern
  onChange: (p: RecurrencePattern) => void
  startDate: Date | undefined
}) {
  const t = useTranslations('Sessions')

  function set<K extends keyof RecurrencePattern>(key: K, val: RecurrencePattern[K]) {
    onChange({ ...value, [key]: val })
  }

  function toggleDay(day: number) {
    const days = value.daysOfWeek.includes(day)
      ? value.daysOfWeek.filter((d) => d !== day)
      : [...value.daysOfWeek, day]
    if (days.length > 0) set('daysOfWeek', days)
  }

  const dayLabels: Record<number, string> = {
    1: t('dayMon'), 2: t('dayTue'), 3: t('dayWed'),
    4: t('dayThu'), 5: t('dayFri'), 6: t('daySat'), 0: t('daySun'),
  }

  const previewDates = useMemo(
    () => startDate ? getPreviewDates(value, startDate, 5) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, startDate?.getTime()],
  )

  return (
    <div className="space-y-4">
      {/* Frequency + interval */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">{t('repeatEvery')}</span>
        <input
          type="number"
          min={1}
          max={52}
          value={value.interval}
          onChange={(e) => set('interval', Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
          className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Select value={value.frequency} onValueChange={(v) => set('frequency', v as RecurrenceFrequency)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">{t('freqDay')}</SelectItem>
            <SelectItem value="weekly">{t('freqWeek')}</SelectItem>
            <SelectItem value="monthly">{t('freqMonth')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Days of week (weekly only) */}
      {value.frequency === 'weekly' && (
        <div className="space-y-1.5">
          <span className="text-sm text-muted-foreground">{t('repeatOnDays')}</span>
          <div className="flex gap-1 flex-wrap">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`h-8 w-10 rounded-md text-xs font-medium transition-colors border ${
                  value.daysOfWeek.includes(day)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:bg-muted'
                }`}
              >
                {dayLabels[day]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* End condition */}
      <div className="space-y-2">
        <span className="text-sm text-muted-foreground">{t('repeatEnds')}</span>
        <div className="space-y-1.5">
          {(['never', 'date', 'count'] as EndCondition[]).map((cond) => (
            <label key={cond} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="endCondition"
                checked={value.endCondition === cond}
                onChange={() => set('endCondition', cond)}
                className="accent-primary"
              />
              <span className="text-sm">
                {cond === 'never' && t('endsNever')}
                {cond === 'date' && (
                  <span className="inline-flex items-center gap-2">
                    {t('endsOnDate')}
                    {value.endCondition === 'date' && (
                      <input
                        type="date"
                        value={value.endDate ? value.endDate.toISOString().slice(0, 10) : ''}
                        min={startDate ? startDate.toISOString().slice(0, 10) : ''}
                        onChange={(e) => set('endDate', e.target.value ? new Date(e.target.value) : null)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </span>
                )}
                {cond === 'count' && (
                  <span className="inline-flex items-center gap-2">
                    {t('endsAfter')}
                    {value.endCondition === 'count' && (
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={value.maxOccurrences}
                        onChange={(e) => set('maxOccurrences', Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {t('endsOccurrences')}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Preview */}
      {previewDates.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">{t('repeatPreview')}</p>
          {previewDates.map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              {' '}
              {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          ))}
        </div>
      )}
    </div>
  )
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

// ─── session dialog ───────────────────────────────────────────────────────────

function deriveDefaultDuration(s: Session | null): number {
  if (!s) return 60
  if (s.duration_minutes) return s.duration_minutes
  if (s.start && s.end) return Math.max(15, Math.round((s.end.toDate().getTime() - s.start.toDate().getTime()) / 60000))
  return 60
}

function defaultStart(): Date {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

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

  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence] = useState<RecurrencePattern>({ ...DEFAULT_RECURRENCE })
  const [generating, setGenerating] = useState(false)
  const [generatedCount, setGeneratedCount] = useState<number | null>(null)

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
      start: editing?.start?.toDate() ?? defaultStart(),
      duration: deriveDefaultDuration(editing),
      location: editing?.location ?? '',
      instructorName: editing?.instructorName ?? '',
      notes: editing?.notes ?? '',
      allowBooking: editing?.allowBooking ?? false,
    },
  })

  const watchedActivityId = watch('activityId')
  const watchedStart = watch('start')
  const watchedDuration = watch('duration')

  useEffect(() => {
    const activity = activities.find((a) => a.id === watchedActivityId)
    if (activity?.type) setValue('activityType', activity.type as typeof SESSION_TYPES[number])
  }, [watchedActivityId, activities, setValue])

  // Seed daysOfWeek from start date when turning recurrence on
  function handleRecurringToggle(on: boolean) {
    setIsRecurring(on)
    if (on && recurrence.daysOfWeek.length === 0 && watchedStart) {
      setRecurrence((p) => ({ ...p, daysOfWeek: [watchedStart.getDay()] }))
    }
  }

  const onSubmit = async (values: SessionFormValues) => {
    const activityEntry = activities.find((a) => a.id === values.activityId)
    const startDate = values.start
    const endDate = new Date(startDate.getTime() + values.duration * 60000)

    const basePayload = {
      teamId,
      activityId: values.activityId || null,
      activityName: activityEntry?.name ?? null,
      activityType: values.activityType,
      location: values.location || null,
      instructorName: values.instructorName || null,
      notes: values.notes || null,
      allowBooking: values.allowBooking ?? false,
      duration_minutes: values.duration,
    }

    if (editing) {
      await updateDoc(doc(db, SESSIONS_COLLECTION, editing.id), {
        ...basePayload,
        start: Timestamp.fromDate(startDate),
        end: Timestamp.fromDate(endDate),
        updatedAt: serverTimestamp(),
      })
      reset()
      onSaved()
      onOpenChange(false)
      return
    }

    if (isRecurring) {
      setGenerating(true)
      try {
        const seriesRef = await addDoc(collection(db, 'session_series'), {
          teamId,
          teacher: userId,
          createdBy: userId,
          template: {
            activityId: values.activityId || null,
            location: values.location || null,
            tags: [],
            notes: values.notes || '',
            duration: values.duration,
            allowBooking: values.allowBooking ?? false,
            instructorName: values.instructorName || null,
            instructorId: null,
          },
          recurrence: {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            daysOfWeek: recurrence.daysOfWeek,
            endCondition: recurrence.endCondition,
            endDate: recurrence.endDate ? Timestamp.fromDate(recurrence.endDate) : null,
            maxOccurrences: recurrence.endCondition === 'count' ? recurrence.maxOccurrences : null,
            duration: values.duration,
            startDate: Timestamp.fromDate(startDate),
          },
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          totalOccurrences: 0,
          lastGeneratedUntil: null,
        })

        const generate = httpsCallable<{ seriesId: string }, { generatedCount: number }>(
          functions, 'generateRecurringSessions',
        )
        const result = await generate({ seriesId: seriesRef.id })
        setGeneratedCount(result.data.generatedCount)
        setTimeout(() => {
          reset()
          onSaved()
          onOpenChange(false)
          setGenerating(false)
          setGeneratedCount(null)
        }, 1400)
      } catch {
        setGenerating(false)
      }
      return
    }

    await addDoc(collection(db, SESSIONS_COLLECTION), {
      ...basePayload,
      start: Timestamp.fromDate(startDate),
      end: Timestamp.fromDate(endDate),
      createdBy: userId,
      teacher: userId,
      created_at: serverTimestamp(),
    })
    reset()
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{editing ? t('editSession') : t('newSession')}</DialogTitle>
        </DialogHeader>

        {generating ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {generatedCount !== null
                ? t('seriesCreated', { count: generatedCount })
                : t('generatingSeries')}
            </p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-1">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 pb-2">
              {/* Activity */}
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldActivity')}</label>
                <Controller
                  name="activityId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                      <SelectTrigger className="w-full">
                        <span className="flex flex-1 text-left text-sm truncate">
                          {field.value && field.value !== '__none__'
                            ? activities.find((a) => a.id === field.value)?.name ?? field.value
                            : <span className="text-muted-foreground">—</span>}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {activities.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {/* Start + duration on same row on md+ */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {t('fieldDuration')}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatDuration(watchedDuration ?? 60)}
                    </span>
                  </label>
                  <Controller
                    name="duration"
                    control={control}
                    render={({ field }) => (
                      <div className="pt-3 px-1">
                        <Slider
                          min={15}
                          max={240}
                          step={15}
                          value={[field.value]}
                          onValueChange={(val) => field.onChange(Array.isArray(val) ? val[0] : val)}
                        />
                        <div className="flex justify-between mt-1">
                          {[30, 60, 90, 120].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => field.onChange(m)}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {formatDuration(m)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  />
                </div>
              </div>

              {/* Location + instructor */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('fieldLocation')}</label>
                  <input
                    type="text"
                    {...register('location')}
                    placeholder={t('locationPlaceholder')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t('fieldInstructor')}</label>
                  <input
                    type="text"
                    {...register('instructorName')}
                    placeholder={t('instructorPlaceholder')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldNotes')}</label>
                <textarea
                  {...register('notes')}
                  rows={2}
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

              {/* Recurrence — new sessions only */}
              {!editing && (
                <>
                  <div className="border-t pt-4">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <div
                        role="checkbox"
                        aria-checked={isRecurring}
                        onClick={() => handleRecurringToggle(!isRecurring)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          isRecurring ? 'bg-primary' : 'bg-input'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            isRecurring ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </div>
                      <span className="text-sm font-medium inline-flex items-center gap-1.5">
                        <Repeat2 className="h-4 w-4 text-muted-foreground" />
                        {t('fieldRepeat')}
                      </span>
                    </label>
                  </div>

                  {isRecurring && (
                    <RecurrencePanel
                      value={recurrence}
                      onChange={setRecurrence}
                      startDate={watchedStart}
                    />
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
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
          </div>
        )}
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
