'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, addDoc, updateDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePlaces } from '@/hooks/usePlaces'
import { useCoaches, coachLabel } from '@/hooks/useCoaches'
import { useAuth } from '@/contexts/AuthContext'
import { SESSIONS_COLLECTION } from '@linyup/shared'
import type { Session, Activity } from '@linyup/shared'
import { Loader2, Repeat2 } from 'lucide-react'

// ─── shared helpers (single source of truth for session forms) ─────────────────

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function deriveDefaultDuration(s: Session | null): number {
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

// ─── duration picker (preset chips + free minutes input) ───────────────────────
// Replaces the old slider — imprecise, and its thumb rendered poorly inside a
// scrolling dialog.

const DURATION_PRESETS = [30, 45, 60, 75, 90, 120]

function DurationPicker({ value, onChange, minutesLabel }: {
  value: number
  onChange: (v: number) => void
  minutesLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DURATION_PRESETS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={`h-9 rounded-md border px-2.5 text-sm transition-colors ${
            value === m
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {formatDuration(m)}
        </button>
      ))}
      <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background pl-2.5 pr-3 focus-within:ring-2 focus-within:ring-ring">
        <input
          type="number"
          min={15}
          max={480}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          onBlur={(e) => onChange(Math.max(15, Math.min(480, Math.round(Number(e.target.value) || 60))))}
          aria-label={minutesLabel}
          className="w-12 bg-transparent text-right text-sm focus:outline-none"
        />
        <span className="text-xs text-muted-foreground">{minutesLabel}</span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly'
type EndCondition        = 'never' | 'date' | 'count'

interface RecurrencePattern {
  frequency:      RecurrenceFrequency
  interval:       number
  daysOfWeek:     number[]
  endCondition:   EndCondition
  endDate:        Date | null
  maxOccurrences: number
}

const DEFAULT_RECURRENCE: RecurrencePattern = {
  frequency: 'weekly', interval: 1, daysOfWeek: [],
  endCondition: 'never', endDate: null, maxOccurrences: 10,
}

function getPreviewDates(pattern: RecurrencePattern, startDate: Date, count = 5): Date[] {
  const dates: Date[] = []
  const cursor = new Date(startDate)
  const max = count * 400
  for (let i = 0; i < max && dates.length < count; i++) {
    const dow = cursor.getDay()
    const include =
      pattern.frequency === 'daily'   ? true :
      pattern.frequency === 'weekly'  ? pattern.daysOfWeek.includes(dow) :
      cursor.getDate() === startDate.getDate()
    if (include && (dates.length === 0 || cursor.getTime() !== startDate.getTime())) {
      dates.push(new Date(cursor))
      if (pattern.endCondition === 'count' && dates.length >= pattern.maxOccurrences) break
      if (pattern.endCondition === 'date'  && pattern.endDate && cursor >= pattern.endDate) break
    }
    if (pattern.frequency === 'daily') {
      cursor.setDate(cursor.getDate() + (include ? pattern.interval : 1))
    } else if (pattern.frequency === 'weekly') {
      cursor.setDate(cursor.getDate() + 1)
      if (cursor.getDay() === (startDate.getDay() + 1) % 7 && dates.length > 0 && pattern.interval > 1)
        cursor.setDate(cursor.getDate() + (pattern.interval - 1) * 7)
    } else {
      cursor.setMonth(cursor.getMonth() + pattern.interval)
    }
  }
  return dates
}

// ─── schema ───────────────────────────────────────────────────────────────────

const SESSION_TYPES = ['class', 'appointment'] as const

const sessionSchema = z.object({
  activityId:      z.string().optional(),
  activityType:    z.enum(SESSION_TYPES).default('class'),
  start:           z.date({ required_error: 'Required' }),
  duration:        z.number().min(15).max(480),
  location:        z.string().max(120).optional(),
  placeId:         z.string().optional(),
  roomId:          z.string().optional(),
  providerId:      z.string().optional(),
  providerName:    z.string().max(120).optional(),
  // Optional cap; kept as text and coerced to a number on save (empty ⇒ no cap).
  maxParticipants: z.string().max(6).optional(),
  notes:           z.string().max(2000).optional(),
  allowBooking:    z.boolean().optional(),
  bookingMandatory: z.boolean().optional(),
})
type SessionFormValues = z.infer<typeof sessionSchema>

// ─── recurrence panel ─────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 0] as const

function RecurrencePanel({ value, onChange, startDate }: {
  value: RecurrencePattern; onChange: (p: RecurrencePattern) => void; startDate: Date | undefined
}) {
  const t = useTranslations('Sessions')

  function set<K extends keyof RecurrencePattern>(key: K, val: RecurrencePattern[K]) {
    onChange({ ...value, [key]: val })
  }
  function toggleDay(day: number) {
    const days = value.daysOfWeek.includes(day)
      ? value.daysOfWeek.filter(d => d !== day)
      : [...value.daysOfWeek, day]
    if (days.length > 0) set('daysOfWeek', days)
  }
  const dayLabels: Record<number, string> = {
    1: t('dayMon'), 2: t('dayTue'), 3: t('dayWed'),
    4: t('dayThu'), 5: t('dayFri'), 6: t('daySat'), 0: t('daySun'),
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previewDates = useMemo(() => startDate ? getPreviewDates(value, startDate, 5) : [], [value, startDate?.getTime()])

  return (
    <div className="space-y-4 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">{t('repeatEvery')}</span>
        <input type="number" min={1} max={52} value={value.interval}
          onChange={e => set('interval', Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
          className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring" />
        <Select value={value.frequency} onValueChange={v => set('frequency', v as RecurrenceFrequency)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">{t('freqDay')}</SelectItem>
            <SelectItem value="weekly">{t('freqWeek')}</SelectItem>
            <SelectItem value="monthly">{t('freqMonth')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {value.frequency === 'weekly' && (
        <div className="space-y-1.5">
          <span className="text-sm text-muted-foreground">{t('repeatOnDays')}</span>
          <div className="flex gap-1 flex-wrap">
            {DAYS_OF_WEEK.map(day => (
              <button key={day} type="button" onClick={() => toggleDay(day)}
                className={`h-8 w-10 rounded-md text-xs font-medium transition-colors border ${
                  value.daysOfWeek.includes(day)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:bg-muted'
                }`}>
                {dayLabels[day]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <span className="text-sm text-muted-foreground">{t('repeatEnds')}</span>
        <div className="space-y-1.5">
          {(['never', 'date', 'count'] as EndCondition[]).map(cond => (
            <label key={cond} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="endCondition" checked={value.endCondition === cond}
                onChange={() => set('endCondition', cond)} className="accent-primary" />
              <span className="text-sm">
                {cond === 'never' && t('endsNever')}
                {cond === 'date' && (
                  <span className="inline-flex items-center gap-2">
                    {t('endsOnDate')}
                    {value.endCondition === 'date' && (
                      <input type="date"
                        value={value.endDate ? value.endDate.toISOString().slice(0, 10) : ''}
                        min={startDate ? startDate.toISOString().slice(0, 10) : ''}
                        onChange={e => set('endDate', e.target.value ? new Date(e.target.value) : null)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={e => e.stopPropagation()} />
                    )}
                  </span>
                )}
                {cond === 'count' && (
                  <span className="inline-flex items-center gap-2">
                    {t('endsAfter')}
                    {value.endCondition === 'count' && (
                      <input type="number" min={1} max={365} value={value.maxOccurrences}
                        onChange={e => set('maxOccurrences', Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={e => e.stopPropagation()} />
                    )}
                    {t('endsOccurrences')}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>
      {previewDates.length > 0 && (
        <div className="rounded-lg bg-background border p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">{t('repeatPreview')}</p>
          {previewDates.map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              {' '}{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── responsive modal shell (dialog on desktop, bottom sheet on mobile) ────────

function ResponsiveModal({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; children: React.ReactNode
}) {
  const isDesktop = useMediaQuery('(min-width: 640px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="p-0 gap-0 max-h-[92vh] flex flex-col rounded-t-2xl overflow-hidden">
        <SheetHeader className="px-5 py-4 border-b flex-shrink-0">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}

// ─── session form dialog ───────────────────────────────────────────────────────

export function SessionFormDialog({
  open, onOpenChange, editing, activities, teamId, userId, onSaved,
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

  const isSeries = !!editing?.seriesId

  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence] = useState<RecurrencePattern>({ ...DEFAULT_RECURRENCE })
  const [busyMsg, setBusyMsg] = useState<string | null>(null)
  // Edit-scope chooser shown when saving a session that belongs to a series.
  const [scopeStep, setScopeStep] = useState(false)
  const [pendingValues, setPendingValues] = useState<SessionFormValues | null>(null)
  const [editScope, setEditScope] = useState<'single' | 'future'>('single')

  const { register, handleSubmit, control, watch, setValue, reset, formState: { errors, isSubmitting } } =
    useForm<SessionFormValues>({
      resolver: zodResolver(sessionSchema),
      defaultValues: {
        activityId:      editing?.activityId ?? '',
        activityType:    (editing?.activityType as typeof SESSION_TYPES[number]) ?? 'class',
        start:           editing?.start?.toDate() ?? defaultStart(),
        duration:        deriveDefaultDuration(editing),
        location:        editing?.location ?? '',
        placeId:         editing?.placeId ?? '',
        roomId:          editing?.roomId ?? '',
        providerId:      editing?.providerId ?? '',
        providerName:    editing?.providerName ?? '',
        maxParticipants: editing?.max_participants != null ? String(editing.max_participants) : '',
        notes:           editing?.notes ?? '',
        allowBooking:    editing?.allowBooking ?? false,
        bookingMandatory: editing?.bookingMandatory ?? false,
      },
    })

  const watchedActivityId  = watch('activityId')
  const watchedStart       = watch('start')
  const watchedPlaceId     = watch('placeId')
  const watchedProviderId  = watch('providerId')
  const watchedAllowBooking = watch('allowBooking')

  const { team } = useAuth()
  const { data: places = [] } = usePlaces(teamId, team?.org_id ?? null)
  const placeRooms = places.find((p) => p.id === watchedPlaceId)?.rooms ?? []
  const { pickable: coaches } = useCoaches(teamId)
  const watchedDuration   = watch('duration')

  // Trigger label for the instructor picker: matched coach → legacy typed name → placeholder.
  const instructorLabel = (() => {
    const c = coaches.find((m) => m.userId === watchedProviderId)
    if (c) return coachLabel(c)
    return watch('providerName') || null
  })()

  useEffect(() => {
    const act = activities.find(a => a.id === watchedActivityId)
    if (act?.type) setValue('activityType', act.type as typeof SESSION_TYPES[number])
  }, [watchedActivityId, activities, setValue])

  function handleRecurringToggle(on: boolean) {
    setIsRecurring(on)
    if (on && recurrence.daysOfWeek.length === 0 && watchedStart) {
      setRecurrence(p => ({ ...p, daysOfWeek: [watchedStart.getDay()] }))
    }
  }

  function close() {
    reset()
    setScopeStep(false)
    setPendingValues(null)
    setEditScope('single')
    setBusyMsg(null)
    onOpenChange(false)
  }

  function basePayload(values: SessionFormValues) {
    const activityEntry = activities.find(a => a.id === values.activityId)
    return {
      teamId,
      activityId:     values.activityId || null,
      activityName:   activityEntry?.name ?? null,
      activityType:   values.activityType,
      location:       values.location || null,
      placeId:        values.placeId || null,
      roomId:         values.roomId || null,
      providerId:     values.providerId || null,
      providerName:   values.providerName || null,
      max_participants: values.maxParticipants ? Number(values.maxParticipants) : null,
      notes:          values.notes || null,
      allowBooking:   values.allowBooking ?? false,
      bookingMandatory: (values.allowBooking ?? false) ? (values.bookingMandatory ?? false) : false,
      duration_minutes: values.duration,
    }
  }

  // ── create (single or recurring series) ──
  async function runCreate(values: SessionFormValues) {
    const startDate = values.start
    const endDate   = new Date(startDate.getTime() + values.duration * 60000)
    const activityEntry = activities.find(a => a.id === values.activityId)

    if (isRecurring) {
      setBusyMsg(t('generatingSeries'))
      const seriesRef = await addDoc(collection(db, 'session_series'), {
        teamId, teacher: userId, createdBy: userId,
        template: {
          activityId: values.activityId || null,
          activityName: activityEntry?.name ?? null,
          activityType: values.activityType,
          location: values.location || null,
          placeId: values.placeId || null,
          roomId: values.roomId || null,
          tags: [], notes: values.notes || '',
          duration: values.duration,
          allowBooking: values.allowBooking ?? false,
          bookingMandatory: (values.allowBooking ?? false) ? (values.bookingMandatory ?? false) : false,
          providerName: values.providerName || null,
          providerId: values.providerId || null,
          max_participants: values.maxParticipants ? Number(values.maxParticipants) : null,
        },
        recurrence: {
          frequency:      recurrence.frequency,
          interval:       recurrence.interval,
          daysOfWeek:     recurrence.daysOfWeek,
          endCondition:   recurrence.endCondition,
          endDate:        recurrence.endDate ? Timestamp.fromDate(recurrence.endDate) : null,
          maxOccurrences: recurrence.endCondition === 'count' ? recurrence.maxOccurrences : null,
          duration:       values.duration,
          startDate:      Timestamp.fromDate(startDate),
        },
        status: 'active',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        totalOccurrences: 0, lastGeneratedUntil: null,
      })
      const generate = httpsCallable<{ seriesId: string }, { generatedCount: number }>(functions, 'generateRecurringSessions')
      const result = await generate({ seriesId: seriesRef.id })
      setBusyMsg(t('seriesCreated', { count: result.data.generatedCount }))
      onSaved()
      setTimeout(close, 1200)
      return
    }

    await addDoc(collection(db, SESSIONS_COLLECTION), {
      ...basePayload(values),
      start: Timestamp.fromDate(startDate),
      end:   Timestamp.fromDate(endDate),
      createdBy: userId, teacher: userId,
      participants_count: 0,
      created_at: serverTimestamp(),
    })
    onSaved()
    close()
  }

  // ── edit a standalone session (no series) ──
  async function runSingleSessionEdit(values: SessionFormValues) {
    const startDate = values.start
    const endDate   = new Date(startDate.getTime() + values.duration * 60000)
    await updateDoc(doc(db, SESSIONS_COLLECTION, editing!.id), {
      ...basePayload(values),
      start: Timestamp.fromDate(startDate),
      end:   Timestamp.fromDate(endDate),
      updatedAt: serverTimestamp(),
    })
    onSaved()
    close()
  }

  // ── edit a session that belongs to a series (scoped) ──
  async function runSeriesEdit(values: SessionFormValues, scope: 'single' | 'future') {
    setBusyMsg(t('updatingSeries'))
    const startDate = values.start
    const endDate   = new Date(startDate.getTime() + values.duration * 60000)
    const activityEntry = activities.find(a => a.id === values.activityId)
    const update = httpsCallable<{ sessionId: string; editScope: string; updates: Record<string, unknown> }, { updatedCount: number }>(
      functions, 'updateRecurringSession',
    )
    const res = await update({
      sessionId: editing!.id,
      editScope: scope,
      updates: {
        activityId:     values.activityId || null,
        activityName:   activityEntry?.name ?? null,
        activityType:   values.activityType,
        start:          startDate.toISOString(),
        end:            endDate.toISOString(),
        duration:       values.duration,
        location:       values.location || null,
        providerId:     values.providerId || null,
        providerName:   values.providerName || null,
        max_participants: values.maxParticipants ? Number(values.maxParticipants) : null,
        notes:          values.notes || null,
        allowBooking:   values.allowBooking ?? false,
        bookingMandatory: (values.allowBooking ?? false) ? (values.bookingMandatory ?? false) : false,
      },
    })
    setBusyMsg(t('seriesUpdated', { count: res.data.updatedCount || 1 }))
    onSaved()
    setTimeout(close, 1000)
  }

  const onSubmit = async (values: SessionFormValues) => {
    if (!editing) { await runCreate(values); return }
    if (isSeries) { setPendingValues(values); setScopeStep(true); return }
    await runSingleSessionEdit(values)
  }

  async function confirmScope() {
    if (!pendingValues) return
    setScopeStep(false)
    await runSeriesEdit(pendingValues, editScope)
  }

  const title = editing ? t('editSession') : t('newSession')

  return (
    <ResponsiveModal open={open} onOpenChange={(v) => { if (!v) close() }} title={title}>
      {busyMsg ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{busyMsg}</p>
        </div>
      ) : scopeStep ? (
        // ── edit-scope chooser ──
        <div className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Repeat2 className="h-4 w-4 text-primary" />
              {t('editScopeTitle')}
            </div>
            <p className="text-sm text-muted-foreground">{t('editScopeDescription')}</p>
            <div className="space-y-2 pt-1">
              {(['single', 'future'] as const).map(scope => (
                <label key={scope}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    editScope === scope ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'
                  }`}>
                  <input type="radio" name="editScope" checked={editScope === scope}
                    onChange={() => setEditScope(scope)} className="accent-primary" />
                  <span className="text-sm">{scope === 'single' ? t('editScopeThis') : t('editScopeFuture')}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="border-t bg-muted/30 px-6 py-3 flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={() => setScopeStep(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="button" onClick={confirmScope}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              {t('applyChanges')}
            </button>
          </div>
        </div>
      ) : (
        // ── main form ──
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
            {isSeries && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary">
                <Repeat2 className="h-3.5 w-3.5 shrink-0" />
                {t('partOfSeries')}
              </div>
            )}

            {/* ── Basics: what is taught and by whom ── */}
            <section className="space-y-3">
              <SectionLabel>{t('sectionBasics')}</SectionLabel>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('fieldActivity')}</label>
                <Controller name="activityId" control={control} render={({ field }) => (
                  <Select value={field.value || '__none__'} onValueChange={v => field.onChange(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <span className="flex flex-1 text-left text-sm truncate">
                        {field.value && field.value !== '__none__'
                          ? activities.find(a => a.id === field.value)?.name ?? field.value
                          : <span className="text-muted-foreground">—</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {activities.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('fieldType')}</label>
                  <Controller name="activityType" control={control} render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <span className="flex flex-1 text-left text-sm truncate">
                          {t(`type_${field.value}` as Parameters<typeof t>[0])}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_TYPES.map(tp => (
                          <SelectItem key={tp} value={tp}>{t(`type_${tp}` as Parameters<typeof t>[0])}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('fieldInstructor')}</label>
                  <Controller name="providerId" control={control} render={({ field }) => (
                    <Select
                      value={field.value || '__none__'}
                      onValueChange={(v) => {
                        if (v === '__none__') {
                          field.onChange('')
                          setValue('providerName', '')
                        } else {
                          field.onChange(v)
                          const c = coaches.find((m) => m.userId === v)
                          setValue('providerName', c ? coachLabel(c) : '')
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <span className="flex flex-1 text-left text-sm truncate">
                          {instructorLabel ?? <span className="text-muted-foreground">{t('instructorNone')}</span>}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t('instructorNone')}</SelectItem>
                        {coaches.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>{coachLabel(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
              </div>
            </section>

            <div className="border-t" />

            {/* ── Schedule: when it happens (and how often) ── */}
            <section className="space-y-3">
              <SectionLabel>{t('sectionSchedule')}</SectionLabel>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('fieldStart')}</label>
                  <Controller name="start" control={control} render={({ field }) => (
                    <DateTimePicker value={field.value} onChange={field.onChange} />
                  )} />
                  {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t('fieldDuration')}
                    <span className="ml-2 font-normal text-muted-foreground">{formatDuration(watchedDuration ?? 60)}</span>
                  </label>
                  <Controller name="duration" control={control} render={({ field }) => (
                    <DurationPicker value={field.value} onChange={field.onChange} minutesLabel={t('durationMinutes')} />
                  )} />
                  {errors.duration && <p className="text-xs text-destructive">{errors.duration.message}</p>}
                </div>
              </div>

              {/* Recurrence — new sessions only */}
              {!editing && (
                <>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                    <div role="checkbox" aria-checked={isRecurring}
                      onClick={() => handleRecurringToggle(!isRecurring)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        isRecurring ? 'bg-primary' : 'bg-input'
                      }`}>
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                        isRecurring ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </div>
                    <span className="text-sm font-medium inline-flex items-center gap-1.5">
                      <Repeat2 className="h-4 w-4 text-muted-foreground" />
                      {t('fieldRepeat')}
                    </span>
                  </label>
                  {isRecurring && (
                    <RecurrencePanel value={recurrence} onChange={setRecurrence} startDate={watchedStart} />
                  )}
                </>
              )}
            </section>

            <div className="border-t" />

            {/* ── Location: place/room from the team's venues + free-text label ── */}
            <section className="space-y-3">
              <SectionLabel>{t('sectionLocation')}</SectionLabel>
              {places.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('fieldPlace')}</label>
                    <Controller name="placeId" control={control} render={({ field }) => (
                      <Select
                        value={field.value || '__none'}
                        onValueChange={(v) => { field.onChange(v === '__none' ? '' : v); setValue('roomId', '') }}
                      >
                        <SelectTrigger className="w-full">
                          <span className="flex flex-1 text-left text-sm truncate">
                            {field.value
                              ? places.find((p) => p.id === field.value)?.name ?? field.value
                              : <span className="text-muted-foreground">{t('placeNone')}</span>}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">{t('placeNone')}</SelectItem>
                          {places.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}{p.scope === 'org' ? ' · org' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                  </div>
                  {placeRooms.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{t('fieldRoom')}</label>
                      <Controller name="roomId" control={control} render={({ field }) => (
                        <Select value={field.value || '__none'} onValueChange={(v) => field.onChange(v === '__none' ? '' : v)}>
                          <SelectTrigger className="w-full">
                            <span className="flex flex-1 text-left text-sm truncate">
                              {field.value
                                ? placeRooms.find((r) => r.id === field.value)?.name ?? field.value
                                : <span className="text-muted-foreground">{t('roomNone')}</span>}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">{t('roomNone')}</SelectItem>
                            {placeRooms.map((r) => (
                              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )} />
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t('fieldLocation')}
                  <span className="ml-2 font-normal text-muted-foreground">{t('optional')}</span>
                </label>
                <input type="text" {...register('location')} placeholder={t('locationPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </section>

            <div className="border-t" />

            {/* ── Capacity & booking ── */}
            <section className="space-y-3">
              <SectionLabel>{t('sectionBooking')}</SectionLabel>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t('fieldMaxParticipants')}
                    <span className="ml-2 font-normal text-muted-foreground">{t('optional')}</span>
                  </label>
                  <input type="number" min={1} step={1} inputMode="numeric"
                    {...register('maxParticipants')} placeholder={t('maxParticipantsPlaceholder')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="space-y-3 sm:pt-7">
                  <div className="flex items-center gap-3">
                    <Controller name="allowBooking" control={control} render={({ field }) => (
                      <input type="checkbox" id="sess-allowBooking" checked={field.value ?? false}
                        onChange={field.onChange} className="h-4 w-4 rounded border-input accent-primary" />
                    )} />
                    <label htmlFor="sess-allowBooking" className="text-sm">{t('fieldAllowBooking')}</label>
                  </div>
                  {/* Booking-required — a refinement of allowBooking; only relevant once
                      booking is offered. Drives the "Booking required" chip in the public flow. */}
                  {watchedAllowBooking && (
                    <div className="flex items-start gap-3 pl-7">
                      <Controller name="bookingMandatory" control={control} render={({ field }) => (
                        <input type="checkbox" id="sess-bookingMandatory" checked={field.value ?? false}
                          onChange={field.onChange} className="mt-0.5 h-4 w-4 rounded border-input accent-primary" />
                      )} />
                      <label htmlFor="sess-bookingMandatory" className="text-sm">
                        {t('fieldBookingMandatory')}
                        <span className="block text-xs text-muted-foreground">{t('bookingMandatoryHint')}</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t('fieldNotes')}
                  <span className="ml-2 font-normal text-muted-foreground">{t('optional')}</span>
                </label>
                <textarea {...register('notes')} rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>
            </section>
          </div>

          <div className="border-t bg-muted/30 px-6 py-3 flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={close}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isSubmitting ? tCommon('loading') : editing ? t('saveChanges') : t('createSession')}
            </button>
          </div>
        </form>
      )}
    </ResponsiveModal>
  )
}
