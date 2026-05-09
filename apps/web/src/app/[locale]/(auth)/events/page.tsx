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
import { useForm } from 'react-hook-form'
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
import { Plus, Pencil, Trash2, Users, MapPin } from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES: EventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return { date: '—', time: '' }
  const d = ts.toDate()
  return {
    date: d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
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

// ─── dialog ───────────────────────────────────────────────────────────────────

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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EventFormData>({
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
            <select
              id="ev-type"
              {...register('type')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>{t(`type_${type}` as Parameters<typeof t>[0])}</option>
              ))}
            </select>
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
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

// ─── event row ────────────────────────────────────────────────────────────────

function EventRow({
  event,
  onEdit,
  onDelete,
  t,
}: {
  event: Event
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations<'Events'>>
}) {
  const { date, time } = formatDateTime(event.start)
  const endTime = formatDateTime(event.end).time

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-sm">{event.title}</p>
        <p className="text-xs text-muted-foreground">{eventDuration(event)}</p>
      </td>
      <td className="px-4 py-3">
        <Badge variant="secondary" className="capitalize text-xs">
          {t(`type_${event.type}` as Parameters<typeof t>[0])}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm">{date}</p>
        <p className="text-xs text-muted-foreground">
          {time}{endTime && endTime !== time ? ` – ${endTime}` : ''}
        </p>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {event.location ? (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
            {event.location}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {event.participants_count ?? 0}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-0.5">
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
      </td>
    </tr>
  )
}

// ─── table ────────────────────────────────────────────────────────────────────

function EventTable({
  events,
  isLoading,
  emptyText,
  onEdit,
  onDelete,
  t,
}: {
  events: Event[]
  isLoading: boolean
  emptyText: string
  onEdit: (e: Event) => void
  onDelete: (e: Event) => void
  t: ReturnType<typeof useTranslations<'Events'>>
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colTitle')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colType')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colDate')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colLocation')}</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colParticipants')}</th>
            <th className="w-20 px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                <td className="px-4 py-3" />
              </tr>
            ))}

          {!isLoading && events.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          )}

          {!isLoading &&
            events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                onEdit={() => onEdit(e)}
                onDelete={() => onDelete(e)}
                t={t}
              />
            ))}
        </tbody>
      </table>
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

  const upcoming = useEvents(currentTeamId, true)
  const past = useEvents(currentTeamId, false)
  const current = tab === 'upcoming' ? upcoming : past

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(e: Event) { setEditing(e); setDialogOpen(true) }
  function closeDialog() { setDialogOpen(false); setEditing(null) }

  async function handleDelete(e: Event) {
    if (!window.confirm(t('deleteConfirm', { title: e.title }))) return
    await updateDoc(doc(db, EVENTS_COLLECTION, e.id), { deleted_at: serverTimestamp() })
    await qc.invalidateQueries({ queryKey: ['events'] })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: t('tabUpcoming') },
    { key: 'past', label: t('tabPast') },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!upcoming.isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { count: upcoming.data?.length ?? 0 })}
            </p>
          )}
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1.5" />
          {t('newEvent')}
        </Button>
      </div>

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

      <EventTable
        events={current.data ?? []}
        isLoading={current.isLoading}
        emptyText={tab === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
        onEdit={openEdit}
        onDelete={handleDelete}
        t={t}
      />

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
    </div>
  )
}
