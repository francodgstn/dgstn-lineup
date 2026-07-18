'use client'

// Appointment availability management, extracted from the former /appointments page
// so it can mount as modals on the Schedule page (an appointment is booked/scheduled
// as a session — there is no separate appointments page any more).
//
//   • AppointmentAvailabilityDialog — manage recurring availability schedules (the
//     *when*: a time range or a list of explicit times, linked to one or more
//     type === 'appointment' activities that own the *what* — duration, capacity,
//     access): list, create, edit, pause/resume.
//   • AppointmentDetail — a booked appointment session's bookings roster + cancel,
//     opened from the Schedule calendar when an appointment slot is clicked.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  collection, query, where, orderBy,
  getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker, TimePicker, DateTimePicker } from '@/components/ui/date-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/ui/query-error'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_ACCENT } from '@/components/ui/color-picker'
import {
  ACTIVITIES_COLLECTION,
  AVAILABILITY_COLLECTION,
  AVAILABILITY_EXCEPTIONS_COLLECTION,
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  isExpiredAppointmentHold,
} from '@linyup/shared'
import type { Availability, AvailabilityException, AppointmentBooking, Session, Activity } from '@linyup/shared'
import { useActivities } from '@/hooks/useActivities'
import { formatDuration } from '@/components/sessions/SessionFormDialog'
import { Pause, Play, Pencil, Plus, MapPin, Video, CalendarClock, CalendarOff, Trash2, X, ChevronDown, ChevronRight, User } from 'lucide-react'

// ─── error surfacing (mirrors AppointmentFormDialog / TemplateDialog conventions) ──

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return String(err)
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatSlotDate(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function formatSlotTime(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDaysOfWeek(daysOfWeek: number[]): string {
  return daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')
}

// ─── time-off (availability exception) date helpers ────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

/** Monday 00:00 of the week containing `d` (Mon-anchored weeks). */
function mondayOf(d: Date): Date {
  const day = d.getDay() // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day
  return startOfDay(addDays(d, diff))
}

function isMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Formats an exception's [start, end) window for the manager list — an
 *  all-day (midnight-to-midnight) range collapses to date(s) only, e.g.
 *  "Mon 21 Jul – Sun 27 Jul"; a same-day slot shows times, e.g.
 *  "Tue 22 Jul · 14:00–15:00". */
function formatExceptionRange(start: Date, end: Date): string {
  if (isMidnight(start) && isMidnight(end)) {
    // end is exclusive — the last covered instant is 1ms before it.
    const inclusiveEnd = new Date(end.getTime() - 1)
    return sameCalendarDay(start, inclusiveEnd)
      ? formatDateShort(start)
      : `${formatDateShort(start)} – ${formatDateShort(inclusiveEnd)}`
  }
  if (sameCalendarDay(start, end)) {
    return `${formatDateShort(start)} · ${formatTimeShort(start)}–${formatTimeShort(end)}`
  }
  return `${formatDateShort(start)} ${formatTimeShort(start)} – ${formatDateShort(end)} ${formatTimeShort(end)}`
}

// ─── data hooks ───────────────────────────────────────────────────────────────

// Exported so other Schedule surfaces (the calendar's availability bands) can
// reuse the same query instead of re-reading the collection — see
// SessionsCalendar.tsx. Callers that only want live schedules should filter
// the result to `status === 'active'` themselves ('paused' is kept here so
// the manager dialog can still list/resume them).
export function useAvailabilityTemplates(teamId: string | null) {
  return useQuery<(Availability & { id: string })[]>({
    queryKey: ['coachAvailability', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const q = query(
        collection(db, AVAILABILITY_COLLECTION),
        where('teamId', '==', teamId),
        where('status', 'in', ['active', 'paused']),
        orderBy('created_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Availability & { id: string })
    },
  })
}

/** A team's `availability_exceptions` docs — provider time-off that overrides
 *  the templates above (see AvailabilityException). `listAvailability`
 *  already subtracts these server-side; this hook just backs the manager's
 *  CRUD list. */
export function useAvailabilityExceptions(teamId: string | null) {
  return useQuery<(AvailabilityException & { id: string })[]>({
    queryKey: ['availabilityExceptions', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const q = query(
        collection(db, AVAILABILITY_EXCEPTIONS_COLLECTION),
        where('teamId', '==', teamId),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AvailabilityException & { id: string })
    },
  })
}

interface MemberOption { id: string; name: string }

function useTeamMemberOptions(teamId: string | null) {
  return useQuery<MemberOption[]>({
    queryKey: ['teamMembersWithNames', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId!, TEAM_MEMBERS_SUBCOLLECTION))
      return Promise.all(snap.docs.map(async (memberDoc) => {
        const userId = memberDoc.id
        const userDoc = await getDoc(doc(db, 'users', userId))
        if (!userDoc.exists()) return { id: userId, name: userId }
        const u = userDoc.data()!
        return { id: userId, name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.email || userId }
      }))
    },
  })
}

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('Appointments')
  const cls: Record<string, string> = {
    open:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    full:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    paused:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    // A paid-booking HOLD — reserved while checkout completes. An expired-but-
    // unswept hold is shown as 'cancelled' instead (see AppointmentDetail).
    pending_payment: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }
  const labels: Record<string, string> = {
    open: t('statusOpen'), full: t('statusFull'), cancelled: t('statusCancelled'),
    active: t('statusActive'), paused: t('statusPaused'),
    pending_payment: t('statusAwaitingPayment'),
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls[status] ?? ''}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── template form schema ─────────────────────────────────────────────────────

const HHMM = /^\d{2}:\d{2}$/
const GRANULARITY_OPTIONS = [10, 15, 20, 30]

const templateSchema = z
  .object({
    title: z.string().min(1, 'Required').max(80),
    providerId: z.string().min(1, 'Required'),
    // The type === 'appointment' activities bookable within this schedule.
    activityIds: z.array(z.string()).min(1, 'Select at least one appointment offering'),
    // 'range' = a daily window clients self-book within; 'times' = an explicit list
    // of start times. Both are lazy — no Session is ever pre-generated.
    mode: z.enum(['range', 'times']),
    location: z.string().max(120).optional(),
    onlineUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
    daysOfWeek: z.array(z.number()).min(1, 'Select at least one day'),
    startDate: z.string().min(1, 'Required'),
    endDate: z.string().optional(),
    // 'range' mode only:
    windowStart: z.string().optional().or(z.literal('')),
    windowEnd: z.string().optional().or(z.literal('')),
    granularityMinutes: z.number().int().optional(),
    // 'times' mode only:
    times: z.array(z.string()).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'range') {
      if (!HHMM.test(v.windowStart || ''))
        ctx.addIssue({ code: 'custom', path: ['windowStart'], message: 'Enter HH:MM' })
      if (!HHMM.test(v.windowEnd || ''))
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'Enter HH:MM' })
      if (v.windowStart && v.windowEnd && v.windowStart >= v.windowEnd)
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'End must be after start' })
    } else {
      if (!v.times || v.times.length === 0)
        ctx.addIssue({ code: 'custom', path: ['times'], message: 'Add at least one start time' })
      else if (v.times.some((tm) => !HHMM.test(tm)))
        ctx.addIssue({ code: 'custom', path: ['times'], message: 'Enter valid HH:MM times' })
    }
  })
type TemplateFormValues = z.infer<typeof templateSchema>

// ─── template dialog ──────────────────────────────────────────────────────────

function TemplateDialog({
  open, onOpenChange, editing, teamId, userId, members, activities, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: (Availability & { id: string }) | null
  teamId: string
  userId: string
  members: MemberOption[]
  /** The team's type === 'appointment' activities — class activities are not linkable. */
  activities: Activity[]
  onSaved: () => void
}) {
  const t = useTranslations('Appointments')
  const tActivities = useTranslations('Activities')
  const qc = useQueryClient()
  const [creatingActivity, setCreatingActivity] = useState(false)
  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting }, reset } =
    useForm<TemplateFormValues>({
      resolver: zodResolver(templateSchema),
      defaultValues: editing ? {
        title: editing.title,
        providerId: editing.providerId,
        activityIds: editing.activityIds ?? [],
        mode: editing.mode ?? 'range',
        location: editing.location || '',
        onlineUrl: editing.onlineUrl || '',
        daysOfWeek: editing.recurrence.daysOfWeek,
        startDate: editing.recurrence.startDate.toDate().toISOString().split('T')[0],
        endDate: editing.recurrence.endDate?.toDate().toISOString().split('T')[0] || '',
        windowStart: editing.window?.start ?? '09:00',
        windowEnd: editing.window?.end ?? '17:00',
        granularityMinutes: editing.granularityMinutes ?? 15,
        times: editing.times ?? [],
        bufferMinutes: editing.bufferMinutes ?? 0,
      } : {
        title: '', providerId: userId, activityIds: [], mode: 'range',
        location: '', onlineUrl: '', daysOfWeek: [],
        startDate: new Date().toISOString().split('T')[0], endDate: '',
        windowStart: '09:00', windowEnd: '17:00', granularityMinutes: 15, times: [], bufferMinutes: 0,
      },
    })

  const mode = watch('mode')
  const selectedDays = watch('daysOfWeek') || []
  const timesList = watch('times') || []

  function toggleDay(day: number) {
    setValue('daysOfWeek', selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day].sort((a, b) => a - b))
  }

  function addTime() {
    setValue('times', [...timesList, '09:00'])
  }

  function updateTime(idx: number, value: string) {
    const next = [...timesList]
    next[idx] = value
    setValue('times', next)
  }

  function removeTime(idx: number) {
    setValue('times', timesList.filter((_, i) => i !== idx))
  }

  // Empty-state affordance: a schedule can't link to "no offering", so when the
  // team has no appointment-type activity yet, create a real general one and
  // auto-select it — this is what makes appointments listable on the site and
  // gateable by subscription, exactly like classes.
  async function createGeneralActivity() {
    if (creatingActivity) return
    setCreatingActivity(true)
    try {
      const ref = await addDoc(collection(db, ACTIVITIES_COLLECTION), {
        name: tActivities('type_appointment'),
        description: '',
        prerequisites: '',
        confirmationInstructions: '',
        type: 'appointment' as const,
        level: 'all' as const,
        color: DEFAULT_ACCENT,
        isFreeTrial: true,
        accessRule: { type: 'open' as const },
        dropIn: { enabled: false },
        durations: [{ minutes: 60, priceAmount: null }],
        slug: 'appointment',
        teamId,
        createdBy: userId,
        isActive: true,
        order: activities.length,
        created_at: serverTimestamp(),
      })
      await qc.invalidateQueries({ queryKey: ['activities'] })
      setValue('activityIds', [ref.id])
    } finally {
      setCreatingActivity(false)
    }
  }

  async function onSubmit(data: TemplateFormValues) {
    const member = members.find((m) => m.id === data.providerId)
    const isRange = data.mode === 'range'
    const recurrence = {
      daysOfWeek: data.daysOfWeek,
      startDate: Timestamp.fromDate(new Date(data.startDate)),
      endDate: data.endDate ? Timestamp.fromDate(new Date(data.endDate)) : null,
    }
    const payload = {
      teamId, providerId: data.providerId, providerName: member?.name || data.providerId,
      title: data.title,
      activityIds: data.activityIds,
      location: data.location || null, onlineUrl: data.onlineUrl || null,
      recurrence,
      mode: data.mode,
      // Range config (cleared when a schedule is switched to explicit times).
      window: isRange ? { start: data.windowStart, end: data.windowEnd } : null,
      granularityMinutes: isRange ? data.granularityMinutes ?? 15 : null,
      // Times config (cleared when a schedule is switched to a range).
      times: isRange ? null : [...(data.times ?? [])].sort(),
      bufferMinutes: data.bufferMinutes ?? 0,
    }
    if (editing) {
      await updateDoc(doc(db, AVAILABILITY_COLLECTION, editing.id), { ...payload, updated_at: serverTimestamp() })
    } else {
      await addDoc(collection(db, AVAILABILITY_COLLECTION), {
        ...payload, status: 'active', created_at: serverTimestamp(), updated_at: serverTimestamp(), createdBy: userId,
      })
    }
    onSaved(); reset(); onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Width matches SessionFormDialog (sm:max-w-3xl) — the two schedule
          creation dialogs should feel like siblings. */}
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTemplate') : t('newTemplate')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">

          <div className="space-y-1.5">
            <Label htmlFor="title">{t('fieldTitle')}</Label>
            <Input id="title" placeholder={t('fieldTitlePlaceholder')} {...register('title')} />
            <p className="text-xs text-muted-foreground">{t('fieldTitleHint')}</p>
            {errors.title && <p className="text-destructive text-xs">{errors.title.message}</p>}
          </div>

          {/* Availability mode — both are lazy, nothing is pre-generated. */}
          <div className="space-y-1.5">
            <Label>{t('fieldMode')}</Label>
            <Controller name="mode" control={control} render={({ field }) => (
              <div className="grid grid-cols-2 gap-2">
                {(['range', 'times'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => field.onChange(m)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${field.value === m ? 'border-primary bg-primary/5' : 'hover:border-foreground/30'}`}>
                    <span className="block text-sm font-medium">{t(m === 'range' ? 'modeRange' : 'modeTimes')}</span>
                    <span className="block text-xs text-muted-foreground">{t(m === 'range' ? 'modeRangeHint' : 'modeTimesHint')}</span>
                  </button>
                ))}
              </div>
            )} />
          </div>

          {mode === 'range' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('fieldWindowStart')}</Label>
                  <Controller name="windowStart" control={control} render={({ field }) => (
                    <TimePicker value={field.value || ''} onChange={field.onChange} />
                  )} />
                  {errors.windowStart && <p className="text-destructive text-xs">{errors.windowStart.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fieldWindowEnd')}</Label>
                  <Controller name="windowEnd" control={control} render={({ field }) => (
                    <TimePicker value={field.value || ''} onChange={field.onChange} />
                  )} />
                  {errors.windowEnd && <p className="text-destructive text-xs">{errors.windowEnd.message}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('fieldGranularity')}</Label>
                <Controller name="granularityMinutes" control={control} render={({ field }) => (
                  <Select value={String(field.value ?? 15)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GRANULARITY_OPTIONS.map((g) => <SelectItem key={g} value={String(g)}>{g} min</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{t('fieldTimes')}</Label>
              <div className="space-y-2">
                {timesList.map((time, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <TimePicker value={time} onChange={(v) => updateTime(idx, v)} />
                    <button
                      type="button"
                      onClick={() => removeTime(idx)}
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
                      aria-label={t('removeTime')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addTime}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />{t('addTime')}
                </Button>
              </div>
              {errors.times && <p className="text-destructive text-xs">{errors.times.message}</p>}
            </div>
          )}

          {/* The scattered per-schedule settings, gathered into one outlined
              group: label (+ hint) on the left, control on the right, one per
              row — same pattern as the Activities form. Offerings gets a
              taller row (label+hint above, checklist below) since it's a
              multi-select, not a single control. */}
          <div className="divide-y rounded-lg border">
            <div className="p-3">
              <div className="flex items-center justify-between gap-4">
                <Label className="font-medium">{t('fieldCoach')}</Label>
                <Controller name="providerId" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-48">
                      <span className="flex flex-1 text-left text-sm truncate">
                        {members.find((m) => m.id === field.value)?.name ?? <span className="text-muted-foreground">—</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              {errors.providerId && <p className="text-destructive text-xs mt-1.5">{errors.providerId.message}</p>}
            </div>

            {/* Linked appointment offerings — the *what*; duration/capacity/access live on the activity. */}
            <div className="p-3 space-y-1.5">
              <div>
                <p className="text-sm font-medium">{t('fieldActivities')}</p>
                <p className="text-xs text-muted-foreground">{t('fieldActivitiesHint')}</p>
              </div>
              {activities.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">{t('noAppointmentActivitiesHint')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={creatingActivity}
                    onClick={() => void createGeneralActivity()}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {creatingActivity ? t('creatingActivity') : t('createGeneralActivity')}
                  </Button>
                </div>
              ) : (
                <Controller
                  control={control}
                  name="activityIds"
                  render={({ field }) => (
                    <div className="space-y-1.5 rounded-md border p-3">
                      {activities.map((a) => (
                        <label key={a.id} className="flex items-start gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-primary"
                            checked={field.value.includes(a.id)}
                            onChange={(e) =>
                              field.onChange(
                                e.target.checked
                                  ? [...field.value, a.id]
                                  : field.value.filter((id: string) => id !== a.id),
                              )
                            }
                          />
                          <span>
                            <span className="font-medium">{a.name}</span>
                            {a.durations && a.durations.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {a.durations.map((d) => d.minutes).map(formatDuration).join(' / ')}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                />
              )}
              {errors.activityIds && <p className="text-destructive text-xs">{errors.activityIds.message}</p>}
            </div>

            <div className="flex items-center justify-between gap-4 p-3">
              <Label htmlFor="location" className="font-medium">{t('fieldLocation')}</Label>
              <Input id="location" placeholder="Gym, studio…" {...register('location')} className="h-9 w-48" />
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="onlineUrl" className="font-medium">{t('fieldOnlineUrl')}</Label>
                <Input id="onlineUrl" placeholder="https://meet.google.com/…" {...register('onlineUrl')} className="h-9 w-48" />
              </div>
              {errors.onlineUrl && <p className="text-destructive text-xs mt-1.5">{errors.onlineUrl.message}</p>}
            </div>

            <div className="flex items-center justify-between gap-4 p-3">
              <Label htmlFor="bufferMinutes" className="font-medium">{t('fieldBuffer')}</Label>
              <Input id="bufferMinutes" type="number" min={0} max={120} step={5}
                {...register('bufferMinutes', { valueAsNumber: true })} className="h-9 w-24" />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionRecurrence')}</p>

            <div className="space-y-1.5">
              <Label>{t('fieldDaysOfWeek')}</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_LABELS.map((label, idx) => (
                  <button key={idx} type="button" onClick={() => toggleDay(idx)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      selectedDays.includes(idx)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {errors.daysOfWeek && <p className="text-destructive text-xs">{errors.daysOfWeek.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('fieldStartDate')}</Label>
                <Controller
                  name="startDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(d) => field.onChange(d ? d.toISOString().split('T')[0] : '')}
                      fromYear={new Date().getFullYear() - 1}
                      toYear={new Date().getFullYear() + 3}
                    />
                  )}
                />
                {errors.startDate && <p className="text-destructive text-xs">{errors.startDate.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t('fieldEndDate')}</Label>
                <Controller
                  name="endDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(d) => field.onChange(d ? d.toISOString().split('T')[0] : '')}
                      fromYear={new Date().getFullYear() - 1}
                      toYear={new Date().getFullYear() + 3}
                    />
                  )}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t('saving') : t('save')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── appointment slot detail (bookings roster + cancel) ─────────────────────────

export function AppointmentDetail({ slot, onClose, onCancelled }: {
  slot: (Session & { id: string }) | null
  onClose: () => void
  onCancelled: () => void
}) {
  const t = useTranslations('Appointments')
  const [bookings, setBookings] = useState<(AppointmentBooking & { id: string })[] | null>(null)
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // A lapsed paid-booking hold (see isExpiredAppointmentHold) is logically free
  // even before the daily sweep flips the stored status — show it as 'cancelled'
  // so admin never mistakes it for a live hold or a real booking.
  const effectiveSlotStatus = slot && isExpiredAppointmentHold(slot, Date.now())
    ? 'cancelled'
    : (slot?.status ?? 'open')

  async function loadBookings() {
    if (!slot) return
    setLoadingBookings(true)
    try {
      const snap = await getDocs(collection(db, SESSIONS_COLLECTION, slot.id, 'bookings'))
      setBookings(
        snap.docs
          .map((d) => ({ ...d.data(), id: d.id }) as AppointmentBooking & { id: string })
          .filter((b) => b.status === 'confirmed')
      )
    } finally { setLoadingBookings(false) }
  }

  async function cancelSlot() {
    if (!slot) return
    setCancelling(true)
    try {
      await updateDoc(doc(db, SESSIONS_COLLECTION, slot.id), { status: 'cancelled', allowBooking: false })
      onCancelled()
    } finally { setCancelling(false); setConfirmCancel(false) }
  }

  return (
    <>
      <Dialog open={!!slot} onOpenChange={(v) => { if (!v) { onClose(); setBookings(null) } }}>
        <DialogContent className="max-w-sm">
          {slot && (<>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {slot.activityName}
                <StatusBadge status={effectiveSlotStatus} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{formatSlotDate(slot.start)}</p>
              <p className="font-medium">{formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}</p>
              <p className="text-muted-foreground">{slot.providerName} · {formatDuration(slot.duration_minutes ?? 60)}</p>
              {slot.location && <p className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{slot.location}</p>}
              {slot.onlineUrl && <p className="flex items-center gap-1 text-muted-foreground"><Video className="h-3.5 w-3.5" />{t('onlineSession')}</p>}
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('bookingsHeading')}</p>
                {bookings === null && (
                  <button onClick={loadBookings} disabled={loadingBookings}
                    className="text-xs text-primary hover:underline disabled:opacity-50">
                    {loadingBookings ? t('loading') : t('loadBookings')}
                  </button>
                )}
              </div>
              {bookings !== null && (
                bookings.length === 0
                  ? <p className="text-sm text-muted-foreground">{t('noBookings')}</p>
                  : <ul className="space-y-1.5">
                      {bookings.map((b) => (
                        <li key={b.id} className="text-sm">
                          <span className="font-medium">
                            {b.fullname || `${b.firstname ?? ''} ${b.lastname ?? ''}`.trim() || b.email}
                          </span>
                          <span className="text-muted-foreground"> · {b.email}</span>
                          {b.phone && <span className="text-muted-foreground"> · {b.phone}</span>}
                        </li>
                      ))}
                    </ul>
              )}
            </div>

            {effectiveSlotStatus !== 'cancelled' && (
              <div className="border-t pt-3">
                <Button variant="destructive" size="sm" className="w-full"
                  onClick={() => setConfirmCancel(true)}>
                  {t('cancelSlot')}
                </Button>
              </div>
            )}
          </>)}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelSlot')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelSlotConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={cancelSlot} disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelling ? t('cancelling') : t('cancelSlotYes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── time off (availability exceptions) ────────────────────────────────────────

/** Add ONE time-off window for a given coach — quick presets fill the range,
 *  or the admin picks a custom start/end. Writes `availability_exceptions`
 *  directly (client-side, same as the templates above); `listAvailability`
 *  subtracts these server-side, no other wiring needed. */
function TimeOffDialog({
  open, onOpenChange, teamId, userId, providerId, providerName, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
  providerId: string
  providerName: string
  onSaved: () => void
}) {
  const t = useTranslations('Appointments')
  const [start, setStart] = useState<Date | undefined>(undefined)
  const [end, setEnd] = useState<Date | undefined>(undefined)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reset the form each time the dialog opens (possibly for a different coach).
  useEffect(() => {
    if (open) {
      setStart(undefined)
      setEnd(undefined)
      setNote('')
      setError(null)
    }
  }, [open, providerId])

  function applyPreset(range: { start: Date; end: Date }) {
    setStart(range.start)
    setEnd(range.end)
    setError(null)
  }

  function presetToday() {
    const now = new Date()
    applyPreset({ start: now, end: addDays(startOfDay(now), 1) })
  }
  function presetTomorrow() {
    const tomorrow = addDays(startOfDay(new Date()), 1)
    applyPreset({ start: tomorrow, end: addDays(tomorrow, 1) })
  }
  function presetThisWeek() {
    const monday = mondayOf(new Date())
    applyPreset({ start: monday, end: addDays(monday, 7) })
  }
  function presetNextWeek() {
    const monday = addDays(mondayOf(new Date()), 7)
    applyPreset({ start: monday, end: addDays(monday, 7) })
  }

  async function handleSave() {
    if (!start || !end || end <= start) {
      setError(t('timeOffEndAfterStart'))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await addDoc(collection(db, AVAILABILITY_EXCEPTIONS_COLLECTION), {
        teamId,
        providerId,
        providerName,
        start: Timestamp.fromDate(start),
        end: Timestamp.fromDate(end),
        note: note || null,
        created_at: serverTimestamp(),
        createdBy: userId,
      })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addTimeOff')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={presetToday}>
              {t('timeOffPresetToday')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={presetTomorrow}>
              {t('timeOffPresetTomorrow')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={presetThisWeek}>
              {t('timeOffPresetThisWeek')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={presetNextWeek}>
              {t('timeOffPresetNextWeek')}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('timeOffStart')}</Label>
              <DateTimePicker value={start} onChange={setStart} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('timeOffEnd')}</Label>
              <DateTimePicker value={end} onChange={setEnd} />
            </div>
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="timeOffNote">{t('timeOffNote')}</Label>
            <Input
              id="timeOffNote"
              placeholder={t('timeOffNotePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button type="button" onClick={() => void handleSave()} disabled={submitting}>
              {submitting ? t('saving') : t('timeOffSave')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── availability manager dialog ───────────────────────────────────────────────

/** Create (or edit) ONE availability schedule, standalone — fetches its own
 *  provider + appointment-activity options so a caller can open it directly.
 *  This is the "+ New entry → Appointment availability" action; the manager
 *  list below uses the inner TemplateDialog directly, having already loaded
 *  those options. */
export function AppointmentAvailabilityFormDialog({
  open, onOpenChange, editing = null, teamId, userId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing?: (Availability & { id: string }) | null
  teamId: string
  userId: string
}) {
  const qc = useQueryClient()
  const membersQ = useTeamMemberOptions(open ? teamId : null)
  const activitiesQ = useActivities(open ? teamId : null)

  return (
    <TemplateDialog
      open={open}
      onOpenChange={onOpenChange}
      editing={editing}
      teamId={teamId}
      userId={userId}
      members={membersQ.data ?? []}
      activities={(activitiesQ.data ?? []).filter((a) => a.type === 'appointment')}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ['coachSlots'] })
        qc.invalidateQueries({ queryKey: ['coachAvailability'] })
      }}
    />
  )
}

/** The availability MANAGER — the list of a team's schedules, with edit/pause.
 *  A list is a management surface, not a creation action, so it hangs off the
 *  Schedule header rather than the "+ New entry" menu. */
export function AppointmentAvailabilityDialog({ open, onOpenChange, teamId, userId }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
}) {
  const t = useTranslations('Appointments')
  const qc = useQueryClient()
  const templatesQ = useAvailabilityTemplates(open ? teamId : null)
  const exceptionsQ = useAvailabilityExceptions(open ? teamId : null)
  const membersQ = useTeamMemberOptions(open ? teamId : null)
  const activitiesQ = useActivities(open ? teamId : null)
  const activities = activitiesQ.data ?? []
  const appointmentActivities = activities.filter((a) => a.type === 'appointment')
  const activityNameById = new Map(activities.map((a) => [a.id, a.name]))
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; editing: (Availability & { id: string }) | null }>({ open: false, editing: null })
  const [timeOffDialog, setTimeOffDialog] = useState<{ open: boolean; providerId: string; providerName: string } | null>(null)
  const [deletingExceptionId, setDeletingExceptionId] = useState<string | null>(null)

  // Group the schedules by coach so a multi-coach studio's list stays scannable —
  // one collapsible section per provider, COLLAPSED by default (open on click).
  const coachGroups = useMemo(() => {
    const map = new Map<string, { providerId: string; providerName: string; templates: (Availability & { id: string })[] }>()
    for (const tmpl of templatesQ.data ?? []) {
      const key = tmpl.providerId || 'unknown'
      if (!map.has(key)) map.set(key, { providerId: key, providerName: tmpl.providerName || key, templates: [] })
      map.get(key)!.templates.push(tmpl)
    }
    return [...map.values()].sort((a, b) => a.providerName.localeCompare(b.providerName))
  }, [templatesQ.data])

  // Time off, grouped by provider the same way — only rendered for coaches
  // already in coachGroups (a coach with time off but no template has nowhere
  // to hang the subsection off of, by design; see file header for scope).
  const exceptionsByProvider = useMemo(() => {
    const map = new Map<string, (AvailabilityException & { id: string })[]>()
    for (const exc of exceptionsQ.data ?? []) {
      const key = exc.providerId || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(exc)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.toDate().getTime() - b.start.toDate().getTime())
    }
    return map
  }, [exceptionsQ.data])

  const [expandedCoaches, setExpandedCoaches] = useState<Set<string>>(new Set())
  function toggleCoach(id: string) {
    setExpandedCoaches((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function toggleTemplateStatus(tmpl: Availability & { id: string }) {
    await updateDoc(doc(db, AVAILABILITY_COLLECTION, tmpl.id), {
      status: tmpl.status === 'active' ? 'paused' : 'active',
      updated_at: serverTimestamp(),
    })
    qc.invalidateQueries({ queryKey: ['coachAvailability'] })
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['coachSlots'] })
    qc.invalidateQueries({ queryKey: ['coachAvailability'] })
  }

  async function deleteException(id: string) {
    setDeletingExceptionId(id)
    try {
      await deleteDoc(doc(db, AVAILABILITY_EXCEPTIONS_COLLECTION, id))
      qc.invalidateQueries({ queryKey: ['coachSlots'] })
      qc.invalidateQueries({ queryKey: ['availabilityExceptions'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDeletingExceptionId(null)
    }
  }

  // A failed fetch must never render as "no templates yet" — that reads as a
  // config problem, not an outage. Both queries feed this list (providers come
  // from membersQ), so either failing blocks it the same way.
  const listErrored = templatesQ.isError || membersQ.isError
  const listErrorDetail =
    (templatesQ.error instanceof Error ? templatesQ.error.message : null) ??
    (membersQ.error instanceof Error ? membersQ.error.message : null)
  function retryList() {
    if (templatesQ.isError) templatesQ.refetch()
    if (membersQ.isError) membersQ.refetch()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('manageAvailabilityTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t('manageAvailabilityHint')}</p>
              <Button size="sm" className="shrink-0" onClick={() => setTemplateDialog({ open: true, editing: null })}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />{t('newTemplate')}
              </Button>
            </div>

            {listErrored ? (
              <QueryErrorState onRetry={retryList} detail={listErrorDetail} />
            ) : (
              <>
                {templatesQ.isLoading && (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                  </div>
                )}

                {!templatesQ.isLoading && templatesQ.data?.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground">
                    <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">{t('noTemplates')}</p>
                    <p className="text-sm mt-1">{t('noTemplatesHint')}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {coachGroups.map((group) => {
                    const isExpanded = expandedCoaches.has(group.providerId)
                    return (
                      <div key={group.providerId} className="rounded-xl border overflow-hidden">
                        {/* Per-coach section header — collapsed by default; click to expand. */}
                        <button
                          type="button"
                          onClick={() => toggleCoach(group.providerId)}
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <User className="h-3.5 w-3.5" />
                          </span>
                          <span className="font-medium text-sm flex-1 min-w-0 truncate">{group.providerName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {t('templateCount', { count: group.templates.length })}
                          </span>
                        </button>

                        {isExpanded && (
                          <>
                            <div className="border-t divide-y">
                              {group.templates.map((tmpl) => (
                                <div key={tmpl.id} className="p-4 flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-medium text-sm">{tmpl.title}</p>
                                      <StatusBadge status={tmpl.status} />
                                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                        {t(tmpl.mode === 'range' ? 'modeRange' : 'modeTimes')}
                                      </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                      {(tmpl.activityIds ?? []).map((id) => activityNameById.get(id) ?? id).join(', ')}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                      {tmpl.mode === 'range' && tmpl.window
                                        ? `${formatDaysOfWeek(tmpl.recurrence.daysOfWeek)} · ${tmpl.window.start}–${tmpl.window.end}`
                                        : `${formatDaysOfWeek(tmpl.recurrence.daysOfWeek)} · ${(tmpl.times ?? []).join(', ')}`}
                                    </p>
                                    {tmpl.location && (
                                      <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                        <MapPin className="h-3 w-3" />{tmpl.location}
                                      </p>
                                    )}
                                    {tmpl.onlineUrl && (
                                      <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                        <Video className="h-3 w-3" />{t('onlineSession')}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button onClick={() => toggleTemplateStatus(tmpl)}
                                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                                      title={tmpl.status === 'active' ? t('pauseTemplate') : t('resumeTemplate')}>
                                      {tmpl.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                    </button>
                                    <button onClick={() => setTemplateDialog({ open: true, editing: tmpl })}
                                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground">
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Time off — provider unavailability that overrides the
                                schedules above (see AvailabilityException / listAvailability). */}
                            <div className="border-t p-4 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  {t('timeOffTitle')}
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setTimeOffDialog({ open: true, providerId: group.providerId, providerName: group.providerName })}
                                >
                                  <CalendarOff className="h-3.5 w-3.5 mr-1.5" />{t('addTimeOff')}
                                </Button>
                              </div>

                              {exceptionsQ.isLoading ? (
                                <p className="text-xs text-muted-foreground">{t('loading')}</p>
                              ) : (exceptionsByProvider.get(group.providerId) ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">{t('noTimeOff')}</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {(exceptionsByProvider.get(group.providerId) ?? []).map((exc) => (
                                    <li key={exc.id} className="flex items-center justify-between gap-2 text-sm">
                                      <span className="min-w-0 truncate">
                                        {formatExceptionRange(exc.start.toDate(), exc.end.toDate())}
                                        {exc.note && <span className="text-muted-foreground"> · {exc.note}</span>}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void deleteException(exc.id)}
                                        disabled={deletingExceptionId === exc.id}
                                        title={t('timeOffRemove')}
                                        aria-label={t('timeOffRemove')}
                                        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TemplateDialog
        open={templateDialog.open}
        onOpenChange={(v) => setTemplateDialog((s) => ({ ...s, open: v }))}
        editing={templateDialog.editing}
        teamId={teamId}
        userId={userId}
        members={membersQ.data || []}
        activities={appointmentActivities}
        onSaved={invalidateAll}
      />

      {timeOffDialog && (
        <TimeOffDialog
          open={timeOffDialog.open}
          onOpenChange={(v) => setTimeOffDialog((s) => (s ? { ...s, open: v } : s))}
          teamId={teamId}
          userId={userId}
          providerId={timeOffDialog.providerId}
          providerName={timeOffDialog.providerName}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['coachSlots'] })
            qc.invalidateQueries({ queryKey: ['availabilityExceptions'] })
          }}
        />
      )}
    </>
  )
}
