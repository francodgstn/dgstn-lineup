'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection, query, where, orderBy, limit, getDocs,
  addDoc, updateDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EVENTS_COLLECTION } from '@lineup/shared'
import type { Event, EventType } from '@lineup/shared'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Pencil, Trash2, Users, MapPin, CalendarDays } from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES: EventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function eventDuration(e: Event): string {
  if (!e.start || !e.end) return ''
  const ms = (e.end as { toDate(): Date }).toDate().getTime() - (e.start as { toDate(): Date }).toDate().getTime()
  const mins = Math.round(ms / 60000)
  const days = Math.floor(mins / 1440)
  if (days >= 1) return `${days}d`
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

const eventSchema = z
  .object({
    title: z.string().min(1, 'Required').max(120),
    type: z.enum(['competition', 'camp', 'exam', 'seminar', 'workshop']),
    start: z.string().min(1, 'Required'),
    end: z.string().min(1, 'Required'),
    location: z.string().max(120).optional(),
    fee: z.string().optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((d) => !d.start || !d.end || new Date(d.end) > new Date(d.start), {
    message: 'End must be after start',
    path: ['end'],
  })

type EventFormData = z.infer<typeof eventSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useEvents(teamId: string | null, upcoming: boolean) {
  return useQuery<Event[]>({
    queryKey: ['events', upcoming ? 'upcoming' : 'past', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const now = Timestamp.now()
      const q = query(
        collection(db, EVENTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('start', upcoming ? '>=' : '<', now),
        orderBy('start', upcoming ? 'asc' : 'desc'),
        limit(50),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Event)
    },
  })
}

// ─── event form dialog ────────────────────────────────────────────────────────

function EventDialog({
  open,
  onClose,
  teamId,
  userId,
  editing,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  editing: Event | null
}) {
  const t = useTranslations('Events')
  const qc = useQueryClient()

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: editing
      ? {
          title: editing.title,
          type: editing.type as EventFormData['type'],
          start: tsToInputValue(editing.start),
          end: tsToInputValue(editing.end),
          location: editing.location ?? '',
          fee: editing.fee != null ? String(editing.fee) : '',
          description: editing.description ?? '',
        }
      : { title: '', type: 'competition', start: '', end: '', location: '', fee: '', description: '' },
  })

  async function onSubmit(data: EventFormData) {
    const payload = {
      title: data.title,
      type: data.type,
      start: Timestamp.fromDate(new Date(data.start)),
      end: Timestamp.fromDate(new Date(data.end)),
      location: data.location ?? '',
      fee: data.fee ? Number(data.fee) : null,
      description: data.description ?? '',
    }
    if (editing) {
      await updateDoc(doc(db, EVENTS_COLLECTION, editing.id), payload)
    } else {
      await addDoc(collection(db, EVENTS_COLLECTION), {
        ...payload,
        teamId,
        createdBy: userId,
        status: 'open',
        participants_count: 0,
        deleted_at: null,
        created_at: serverTimestamp(),
      })
    }
    await qc.invalidateQueries({ queryKey: ['events'] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('editEvent') : t('newEvent')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ev-title">{t('fieldTitle')}</Label>
            <Input id="ev-title" {...register('title')} autoFocus />
            {errors.title && <p className="text-destructive text-xs">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-type">{t('fieldType')}</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{t(`type_${type}` as Parameters<typeof t>[0])}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">{t('fieldStart')}</Label>
              <Input id="ev-start" type="datetime-local" {...register('start')} />
              {errors.start && <p className="text-destructive text-xs">{errors.start.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-end">{t('fieldEnd')}</Label>
              <Input id="ev-end" type="datetime-local" {...register('end')} />
              {errors.end && <p className="text-destructive text-xs">{errors.end.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-location">{t('fieldLocation')}</Label>
              <Input id="ev-location" {...register('location')} placeholder={t('fieldLocationPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-fee">
                {t('fieldFee')}{' '}
                <span className="text-muted-foreground font-normal text-xs">{t('fieldFeeOptional')}</span>
              </Label>
              <Input id="ev-fee" type="number" min="0" step="0.01" {...register('fee')} placeholder="0.00" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">{t('fieldDescription')}</Label>
            <textarea
              id="ev-desc"
              {...register('description')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : editing ? t('saveChanges') : t('createEvent')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── delete confirm dialog ────────────────────────────────────────────────────

function DeleteConfirmDialog({
  event,
  onConfirm,
  onCancel,
}: {
  event: Event | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Events')
  return (
    <Dialog open={!!event} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('deleteEvent')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          {event ? t('deleteConfirm', { title: event.title }) : ''}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('deleteEvent')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── event card ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  onEdit,
  onDelete,
}: {
  event: Event
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Events')
  const startTime = formatTime(event.start)
  const endTime = formatTime(event.end)
  const duration = eventDuration(event)

  return (
    <div className="flex gap-3 p-4 border-b last:border-0">
      {/* Date column */}
      <div className="w-12 shrink-0 flex flex-col items-center justify-start pt-0.5">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <CalendarDays className="h-5 w-5 text-primary" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{event.title}</p>
              <Badge variant="secondary" className="text-xs capitalize shrink-0">
                {t(`type_${event.type}` as Parameters<typeof t>[0])}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDate(event.start)}
              {startTime && <> · {startTime}{endTime && endTime !== startTime ? ` – ${endTime}` : ''}</>}
              {duration && <span className="ml-1 text-muted-foreground/60">({duration})</span>}
            </p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
              title={t('editEvent')}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
              title={t('deleteEvent')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {event.location && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {event.location}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" />
            {event.participants_count ?? 0}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'upcoming' | 'past'

export default function EventsPage() {
  const { currentTeamId, user } = useAuth()
  const qc = useQueryClient()
  const t = useTranslations('Events')
  const [tab, setTab] = useState<Tab>('upcoming')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState<Event | null>(null)

  const upcoming = useEvents(currentTeamId, true)
  const past = useEvents(currentTeamId, false)
  const current = tab === 'upcoming' ? upcoming : past

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(e: Event) { setEditing(e); setDialogOpen(true) }
  function closeDialog() { setDialogOpen(false); setEditing(null) }

  async function handleDelete() {
    if (!deleting) return
    await updateDoc(doc(db, EVENTS_COLLECTION, deleting.id), { deleted_at: serverTimestamp() })
    await qc.invalidateQueries({ queryKey: ['events'] })
    setDeleting(null)
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: t('tabUpcoming') },
    { key: 'past', label: t('tabPast') },
  ]

  const events = current.data ?? []
  const emptyText = tab === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!upcoming.isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { count: upcoming.data?.length ?? 0 })}
            </p>
          )}
        </div>
        <button
          onClick={openNew}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('newEvent')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border overflow-hidden bg-card">
        {current.isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-4 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}

        {!current.isLoading && events.length === 0 && (
          <div className="py-16 text-center text-muted-foreground text-sm">{emptyText}</div>
        )}

        {!current.isLoading && events.map((e) => (
          <EventCard
            key={e.id}
            event={e}
            onEdit={() => openEdit(e)}
            onDelete={() => setDeleting(e)}
          />
        ))}
      </div>

      {/* Mobile FAB */}
      <button
        onClick={openNew}
        className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
        aria-label={t('newEvent')}
      >
        <Plus className="h-6 w-6" />
      </button>

      {currentTeamId && user && (
        <EventDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onClose={closeDialog}
          teamId={currentTeamId}
          userId={user.uid}
          editing={editing}
        />
      )}

      <DeleteConfirmDialog
        event={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
