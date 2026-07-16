'use client'

// Appointment availability management, extracted from the former /appointments page
// so it can mount as modals on the Schedule page (an appointment is booked/scheduled
// as a session — there is no separate appointments page any more).
//
//   • AppointmentAvailabilityDialog — manage recurring availability templates
//     (fixed slots + open windows): list, create, edit, pause/resume.
//   • AppointmentDetail — a booked appointment session's bookings roster + cancel,
//     opened from the Schedule calendar when an appointment slot is clicked.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, query, where, orderBy,
  getDocs, addDoc, updateDoc, doc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker, TimePicker } from '@/components/ui/date-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AVAILABILITY_COLLECTION,
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
} from '@linyup/shared'
import type { Availability, AppointmentBooking, Session } from '@linyup/shared'
import { Pause, Play, Pencil, Plus, MapPin, Video, CalendarClock } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatSlotDate(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function formatSlotTime(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatDaysTime(rec: Availability['recurrence']): string {
  return `${rec.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')} · ${rec.time}`
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useTemplates(teamId: string | null) {
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
  }
  const labels: Record<string, string> = {
    open: t('statusOpen'), full: t('statusFull'), cancelled: t('statusCancelled'),
    active: t('statusActive'), paused: t('statusPaused'),
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls[status] ?? ''}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── template form schema ─────────────────────────────────────────────────────

const HHMM = /^\d{2}:\d{2}$/
const DURATION_PRESETS = [30, 45, 60, 90, 120]
const GRANULARITY_OPTIONS = [10, 15, 20, 30]

const templateSchema = z
  .object({
    title: z.string().min(1, 'Required').max(80),
    providerId: z.string().min(1, 'Required'),
    // 'fixed_slots' = exact recurring times; 'open_window' = a daily range clients self-book within.
    mode: z.enum(['fixed_slots', 'open_window']),
    duration_minutes: z.number().int().min(15).max(480),
    max_participants: z.number().int().min(1).max(50),
    location: z.string().max(120).optional(),
    onlineUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
    isFreeTrial: z.boolean(),
    daysOfWeek: z.array(z.number()).min(1, 'Select at least one day'),
    time: z.string().optional().or(z.literal('')), // fixed_slots only
    startDate: z.string().min(1, 'Required'),
    endDate: z.string().optional(),
    // open_window only:
    windowStart: z.string().optional().or(z.literal('')),
    windowEnd: z.string().optional().or(z.literal('')),
    durationsMinutes: z.array(z.number()).optional(),
    granularityMinutes: z.number().int().optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'fixed_slots') {
      if (!HHMM.test(v.time || ''))
        ctx.addIssue({ code: 'custom', path: ['time'], message: 'Enter HH:MM' })
    } else {
      if (!HHMM.test(v.windowStart || ''))
        ctx.addIssue({ code: 'custom', path: ['windowStart'], message: 'Enter HH:MM' })
      if (!HHMM.test(v.windowEnd || ''))
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'Enter HH:MM' })
      if (v.windowStart && v.windowEnd && v.windowStart >= v.windowEnd)
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'End must be after start' })
      if (!v.durationsMinutes || v.durationsMinutes.length === 0)
        ctx.addIssue({ code: 'custom', path: ['durationsMinutes'], message: 'Pick at least one duration' })
    }
  })
type TemplateFormValues = z.infer<typeof templateSchema>

// ─── template dialog ──────────────────────────────────────────────────────────

function TemplateDialog({
  open, onOpenChange, editing, teamId, userId, members, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: (Availability & { id: string }) | null
  teamId: string
  userId: string
  members: MemberOption[]
  onSaved: () => void
}) {
  const t = useTranslations('Appointments')
  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting }, reset } =
    useForm<TemplateFormValues>({
      resolver: zodResolver(templateSchema),
      defaultValues: editing ? {
        title: editing.title,
        providerId: editing.providerId,
        mode: editing.mode ?? 'fixed_slots',
        duration_minutes: editing.duration_minutes,
        max_participants: editing.max_participants,
        location: editing.location || '',
        onlineUrl: editing.onlineUrl || '',
        isFreeTrial: editing.isFreeTrial !== false,
        daysOfWeek: editing.recurrence.daysOfWeek,
        time: editing.recurrence.time,
        startDate: editing.recurrence.startDate.toDate().toISOString().split('T')[0],
        endDate: editing.recurrence.endDate?.toDate().toISOString().split('T')[0] || '',
        windowStart: editing.window?.start ?? '17:00',
        windowEnd: editing.window?.end ?? '21:00',
        durationsMinutes: editing.durationsMinutes ?? [60],
        granularityMinutes: editing.granularityMinutes ?? 15,
        bufferMinutes: editing.bufferMinutes ?? 0,
      } : {
        title: '', providerId: userId, mode: 'fixed_slots', duration_minutes: 60, max_participants: 1,
        location: '', onlineUrl: '', isFreeTrial: true, daysOfWeek: [], time: '09:00',
        startDate: new Date().toISOString().split('T')[0], endDate: '',
        windowStart: '17:00', windowEnd: '21:00', durationsMinutes: [60], granularityMinutes: 15, bufferMinutes: 0,
      },
    })

  const mode = watch('mode')
  const selectedDays = watch('daysOfWeek') || []
  const selectedDurations = watch('durationsMinutes') || []

  function toggleDay(day: number) {
    setValue('daysOfWeek', selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day].sort((a, b) => a - b))
  }

  function toggleDuration(d: number) {
    setValue('durationsMinutes', selectedDurations.includes(d)
      ? selectedDurations.filter((x) => x !== d)
      : [...selectedDurations, d].sort((a, b) => a - b))
  }

  async function onSubmit(data: TemplateFormValues) {
    const member = members.find((m) => m.id === data.providerId)
    const isWindow = data.mode === 'open_window'
    const durations = (data.durationsMinutes ?? []).slice().sort((a, b) => a - b)
    const recurrence = {
      daysOfWeek: data.daysOfWeek,
      // Windows have no single slot time; store the window start so existing
      // recurrence-based summaries stay meaningful.
      time: isWindow ? data.windowStart || '00:00' : data.time || '09:00',
      startDate: Timestamp.fromDate(new Date(data.startDate)),
      endDate: data.endDate ? Timestamp.fromDate(new Date(data.endDate)) : null,
    }
    const payload = {
      teamId, providerId: data.providerId, providerName: member?.name || data.providerId,
      title: data.title,
      duration_minutes: isWindow ? (durations[0] ?? 60) : data.duration_minutes,
      max_participants: isWindow ? 1 : data.max_participants,
      location: data.location || null, onlineUrl: data.onlineUrl || null,
      isFreeTrial: data.isFreeTrial,
      recurrence,
      mode: data.mode,
      // Window config (cleared when a template is switched back to fixed slots).
      window: isWindow ? { start: data.windowStart, end: data.windowEnd } : null,
      durationsMinutes: isWindow ? durations : null,
      granularityMinutes: isWindow ? data.granularityMinutes ?? 15 : null,
      bufferMinutes: isWindow ? data.bufferMinutes ?? 0 : null,
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTemplate') : t('newTemplate')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">

          <div className="space-y-1.5">
            <Label htmlFor="title">{t('fieldTitle')}</Label>
            <Input id="title" placeholder={t('fieldTitlePlaceholder')} {...register('title')} />
            {errors.title && <p className="text-destructive text-xs">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t('fieldCoach')}</Label>
            <Controller name="providerId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <span className="flex flex-1 text-left text-sm truncate">
                    {members.find((m) => m.id === field.value)?.name ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {errors.providerId && <p className="text-destructive text-xs">{errors.providerId.message}</p>}
          </div>

          {/* Availability mode */}
          <div className="space-y-1.5">
            <Label>{t('fieldMode')}</Label>
            <Controller name="mode" control={control} render={({ field }) => (
              <div className="grid grid-cols-2 gap-2">
                {(['fixed_slots', 'open_window'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => field.onChange(m)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${field.value === m ? 'border-primary bg-primary/5' : 'hover:border-foreground/30'}`}>
                    <span className="block text-sm font-medium">{t(m === 'fixed_slots' ? 'modeFixedSlots' : 'modeOpenWindow')}</span>
                    <span className="block text-xs text-muted-foreground">{t(m === 'fixed_slots' ? 'modeFixedSlotsHint' : 'modeOpenWindowHint')}</span>
                  </button>
                ))}
              </div>
            )} />
          </div>

          {mode === 'fixed_slots' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="duration_minutes">{t('fieldDuration')}</Label>
                <Input id="duration_minutes" type="number" min={15} max={480} step={15}
                  {...register('duration_minutes', { valueAsNumber: true })} />
                {errors.duration_minutes && <p className="text-destructive text-xs">{errors.duration_minutes.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max_participants">{t('fieldMaxParticipants')}</Label>
                <Input id="max_participants" type="number" min={1} max={50}
                  {...register('max_participants', { valueAsNumber: true })} />
              </div>
            </div>
          ) : (
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
                <Label>{t('fieldDurations')}</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {DURATION_PRESETS.map((d) => (
                    <button key={d} type="button" onClick={() => toggleDuration(d)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${selectedDurations.includes(d) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-foreground'}`}>
                      {formatDuration(d)}
                    </button>
                  ))}
                </div>
                {errors.durationsMinutes && <p className="text-destructive text-xs">{errors.durationsMinutes.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-1.5">
                  <Label htmlFor="bufferMinutes">{t('fieldBuffer')}</Label>
                  <Input id="bufferMinutes" type="number" min={0} max={120} step={5}
                    {...register('bufferMinutes', { valueAsNumber: true })} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="location">{t('fieldLocation')}</Label>
            <Input id="location" placeholder="Gym, studio…" {...register('location')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="onlineUrl">{t('fieldOnlineUrl')}</Label>
            <Input id="onlineUrl" placeholder="https://meet.google.com/…" {...register('onlineUrl')} />
            {errors.onlineUrl && <p className="text-destructive text-xs">{errors.onlineUrl.message}</p>}
          </div>

          <div className="flex items-center gap-2">
            <Controller name="isFreeTrial" control={control} render={({ field }) => (
              <input
                type="checkbox"
                id="isFreeTrial"
                checked={field.value}
                onChange={field.onChange}
                className="accent-primary"
              />
            )} />
            <Label htmlFor="isFreeTrial" className="cursor-pointer">
              {t('fieldFreeTrial')}
            </Label>
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

            {mode === 'fixed_slots' && (
              <div className="space-y-1.5">
                <Label>{t('fieldTime')}</Label>
                <Controller
                  name="time"
                  control={control}
                  render={({ field }) => (
                    <TimePicker value={field.value || ''} onChange={field.onChange} />
                  )}
                />
                {errors.time && <p className="text-destructive text-xs">{errors.time.message}</p>}
              </div>
            )}
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
                <StatusBadge status={slot.status ?? 'open'} />
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

            {(slot.status ?? 'open') !== 'cancelled' && (
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

// ─── availability manager dialog ───────────────────────────────────────────────

export function AppointmentAvailabilityDialog({ open, onOpenChange, teamId, userId }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
}) {
  const t = useTranslations('Appointments')
  const qc = useQueryClient()
  const templatesQ = useTemplates(open ? teamId : null)
  const membersQ = useTeamMemberOptions(open ? teamId : null)
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; editing: (Availability & { id: string }) | null }>({ open: false, editing: null })

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
              {templatesQ.data?.map((tmpl) => (
                <div key={tmpl.id} className="rounded-xl border p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{tmpl.title}</p>
                      <StatusBadge status={tmpl.status} />
                      {tmpl.mode === 'open_window' && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {t('modeOpenWindow')}
                        </span>
                      )}
                      {tmpl.isFreeTrial === false && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('membersOnly')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {tmpl.mode === 'open_window' && tmpl.window
                        ? `${tmpl.recurrence.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')} · ${tmpl.window.start}–${tmpl.window.end} · ${(tmpl.durationsMinutes ?? []).map(formatDuration).join(' / ')}`
                        : `${formatDaysTime(tmpl.recurrence)} · ${formatDuration(tmpl.duration_minutes)}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{tmpl.providerName}</p>
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
        onSaved={invalidateAll}
      />
    </>
  )
}
