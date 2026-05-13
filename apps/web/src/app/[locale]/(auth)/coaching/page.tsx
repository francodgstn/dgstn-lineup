'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection, query, where, orderBy, limit,
  getDocs, addDoc, updateDoc, doc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  COACH_AVAILABILITY_COLLECTION,
  COACH_SLOTS_COLLECTION,
  COACH_SLOT_BOOKINGS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
} from '@lineup/shared'
import type { CoachAvailability, CoachSlot, CoachBooking } from '@lineup/shared'
import { CalendarClock, Pause, Play, Pencil, RefreshCw, Plus, MapPin, Video, Users, Dumbbell } from 'lucide-react'

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

function formatDaysTime(rec: CoachAvailability['recurrence']): string {
  return `${rec.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')} · ${rec.time}`
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useUpcomingSlots(teamId: string | null) {
  return useQuery<(CoachSlot & { id: string })[]>({
    queryKey: ['coachSlots', 'upcoming', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const q = query(
        collection(db, COACH_SLOTS_COLLECTION),
        where('teamId', '==', teamId),
        where('start', '>=', Timestamp.now()),
        orderBy('start', 'asc'),
        limit(60),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CoachSlot & { id: string })
    },
  })
}

function useTemplates(teamId: string | null) {
  return useQuery<(CoachAvailability & { id: string })[]>({
    queryKey: ['coachAvailability', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const q = query(
        collection(db, COACH_AVAILABILITY_COLLECTION),
        where('teamId', '==', teamId),
        where('status', 'in', ['active', 'paused']),
        orderBy('created_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CoachAvailability & { id: string })
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
  const t = useTranslations('Coaching')
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

const templateSchema = z.object({
  title: z.string().min(1, 'Required').max(80),
  coachId: z.string().min(1, 'Required'),
  duration_minutes: z.number().int().min(15).max(480),
  max_participants: z.number().int().min(1).max(50),
  location: z.string().max(120).optional(),
  onlineUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  daysOfWeek: z.array(z.number()).min(1, 'Select at least one day'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter HH:MM'),
  startDate: z.string().min(1, 'Required'),
  endDate: z.string().optional(),
})
type TemplateFormValues = z.infer<typeof templateSchema>

// ─── template dialog ──────────────────────────────────────────────────────────

function TemplateDialog({
  open, onOpenChange, editing, teamId, userId, members, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: (CoachAvailability & { id: string }) | null
  teamId: string
  userId: string
  members: MemberOption[]
  onSaved: () => void
}) {
  const t = useTranslations('Coaching')
  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting }, reset } =
    useForm<TemplateFormValues>({
      resolver: zodResolver(templateSchema),
      defaultValues: editing ? {
        title: editing.title,
        coachId: editing.coachId,
        duration_minutes: editing.duration_minutes,
        max_participants: editing.max_participants,
        location: editing.location || '',
        onlineUrl: editing.onlineUrl || '',
        daysOfWeek: editing.recurrence.daysOfWeek,
        time: editing.recurrence.time,
        startDate: editing.recurrence.startDate.toDate().toISOString().split('T')[0],
        endDate: editing.recurrence.endDate?.toDate().toISOString().split('T')[0] || '',
      } : {
        title: '', coachId: userId, duration_minutes: 60, max_participants: 1,
        location: '', onlineUrl: '', daysOfWeek: [], time: '09:00',
        startDate: new Date().toISOString().split('T')[0], endDate: '',
      },
    })

  const selectedDays = watch('daysOfWeek') || []

  function toggleDay(day: number) {
    setValue('daysOfWeek', selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day].sort((a, b) => a - b))
  }

  async function onSubmit(data: TemplateFormValues) {
    const member = members.find((m) => m.id === data.coachId)
    const recurrence = {
      daysOfWeek: data.daysOfWeek,
      time: data.time,
      startDate: Timestamp.fromDate(new Date(data.startDate)),
      endDate: data.endDate ? Timestamp.fromDate(new Date(data.endDate)) : null,
    }
    const payload = {
      teamId, coachId: data.coachId, coachName: member?.name || data.coachId,
      title: data.title, duration_minutes: data.duration_minutes, max_participants: data.max_participants,
      location: data.location || null, onlineUrl: data.onlineUrl || null, recurrence,
    }
    if (editing) {
      await updateDoc(doc(db, COACH_AVAILABILITY_COLLECTION, editing.id), { ...payload, updated_at: serverTimestamp() })
    } else {
      await addDoc(collection(db, COACH_AVAILABILITY_COLLECTION), {
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
            <Controller name="coachId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {errors.coachId && <p className="text-destructive text-xs">{errors.coachId.message}</p>}
          </div>

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

          <div className="space-y-1.5">
            <Label htmlFor="location">{t('fieldLocation')}</Label>
            <Input id="location" placeholder="Gym, studio…" {...register('location')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="onlineUrl">{t('fieldOnlineUrl')}</Label>
            <Input id="onlineUrl" placeholder="https://meet.google.com/…" {...register('onlineUrl')} />
            {errors.onlineUrl && <p className="text-destructive text-xs">{errors.onlineUrl.message}</p>}
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

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="time">{t('fieldTime')}</Label>
                <Input id="time" type="time" {...register('time')} />
                {errors.time && <p className="text-destructive text-xs">{errors.time.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="startDate">{t('fieldStartDate')}</Label>
                <Input id="startDate" type="date" {...register('startDate')} />
                {errors.startDate && <p className="text-destructive text-xs">{errors.startDate.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">{t('fieldEndDate')}</Label>
                <Input id="endDate" type="date" {...register('endDate')} />
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

// ─── slot detail dialog ───────────────────────────────────────────────────────

function SlotDetailDialog({ slot, onClose, onCancelled }: {
  slot: (CoachSlot & { id: string }) | null
  onClose: () => void
  onCancelled: () => void
}) {
  const t = useTranslations('Coaching')
  const [bookings, setBookings] = useState<(CoachBooking & { id: string })[] | null>(null)
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  async function loadBookings() {
    if (!slot) return
    setLoadingBookings(true)
    try {
      const snap = await getDocs(collection(db, COACH_SLOTS_COLLECTION, slot.id, COACH_SLOT_BOOKINGS_SUBCOLLECTION))
      setBookings(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as CoachBooking & { id: string })
          .filter((b) => b.status === 'confirmed')
      )
    } finally { setLoadingBookings(false) }
  }

  async function cancelSlot() {
    if (!slot) return
    setCancelling(true)
    try {
      await updateDoc(doc(db, COACH_SLOTS_COLLECTION, slot.id), { status: 'cancelled' })
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
                {slot.title}
                <StatusBadge status={slot.status} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{formatSlotDate(slot.start)}</p>
              <p className="font-medium">{formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}</p>
              <p className="text-muted-foreground">{slot.coachName} · {formatDuration(slot.duration_minutes)}</p>
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
                          <span className="font-medium">{b.fullname}</span>
                          <span className="text-muted-foreground"> · {b.email}</span>
                          {b.phone && <span className="text-muted-foreground"> · {b.phone}</span>}
                        </li>
                      ))}
                    </ul>
              )}
            </div>

            {slot.status !== 'cancelled' && (
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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function CoachingPage() {
  const t = useTranslations('Coaching')
  const { currentTeamId: teamId, user } = useAuth()
  const userId = user?.uid
  const qc = useQueryClient()

  const slotsQ = useUpcomingSlots(teamId)
  const templatesQ = useTemplates(teamId)
  const membersQ = useTeamMemberOptions(teamId)

  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; editing: (CoachAvailability & { id: string }) | null }>({ open: false, editing: null })
  const [slotDetail, setSlotDetail] = useState<(CoachSlot & { id: string }) | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateMsg, setGenerateMsg] = useState<string | null>(null)

  async function handleGenerate() {
    if (!teamId) return
    setGenerating(true); setGenerateMsg(null)
    try {
      const fn = httpsCallable(functions, 'generateCoachSlots')
      const result = await fn({ teamId }) as { data: { created: number; skipped: number } }
      setGenerateMsg(t('generateResult', { created: result.data.created, skipped: result.data.skipped }))
      qc.invalidateQueries({ queryKey: ['coachSlots'] })
    } catch {
      setGenerateMsg(t('generateError'))
    } finally { setGenerating(false) }
  }

  async function toggleTemplateStatus(tmpl: CoachAvailability & { id: string }) {
    await updateDoc(doc(db, COACH_AVAILABILITY_COLLECTION, tmpl.id), {
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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
          <Dumbbell className="h-5 w-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <Tabs defaultValue="slots">
        <TabsList>
          <TabsTrigger value="slots">{t('tabSlots')}</TabsTrigger>
          <TabsTrigger value="templates">{t('tabTemplates')}</TabsTrigger>
        </TabsList>

        {/* ─ Slots tab ─ */}
        <TabsContent value="slots" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? t('generating') : t('generateNow')}
            </Button>
            {generateMsg && <p className="text-sm text-muted-foreground">{generateMsg}</p>}
          </div>

          {slotsQ.isLoading && (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          )}

          {!slotsQ.isLoading && slotsQ.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="font-medium">{t('noSlots')}</p>
              <p className="text-sm mt-1">{t('noSlotsHint')}</p>
            </div>
          )}

          <div className="space-y-2">
            {slotsQ.data?.map((slot) => (
              <button key={slot.id} onClick={() => setSlotDetail(slot)}
                className="w-full text-left rounded-xl border p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{slot.title}</p>
                      <StatusBadge status={slot.status} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {formatSlotDate(slot.start)} · {formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{slot.coachName}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 mt-0.5">
                    <Users className="h-3.5 w-3.5" />
                    {slot.bookings_count}/{slot.max_participants}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        {/* ─ Templates tab ─ */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setTemplateDialog({ open: true, editing: null })}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />{t('newTemplate')}
            </Button>
          </div>

          {templatesQ.isLoading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          )}

          {!templatesQ.isLoading && templatesQ.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
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
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {formatDaysTime(tmpl.recurrence)} · {formatDuration(tmpl.duration_minutes)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tmpl.coachName}</p>
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
        </TabsContent>
      </Tabs>

      <TemplateDialog
        open={templateDialog.open}
        onOpenChange={(v) => setTemplateDialog((s) => ({ ...s, open: v }))}
        editing={templateDialog.editing}
        teamId={teamId!}
        userId={userId!}
        members={membersQ.data || []}
        onSaved={invalidateAll}
      />

      <SlotDetailDialog
        slot={slotDetail}
        onClose={() => setSlotDetail(null)}
        onCancelled={() => { setSlotDetail(null); qc.invalidateQueries({ queryKey: ['coachSlots'] }) }}
      />
    </div>
  )
}
