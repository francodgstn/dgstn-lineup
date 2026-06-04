'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, query, where, orderBy, getDocs, addDoc,
  updateDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-picker'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Pencil, Trash2, CalendarRange, MapPin, CalendarDays, ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { EVENTS_COLLECTION } from '@linyup/shared'
import type { Event, EventType } from '@linyup/shared'
import type { Route } from 'next'

const EVENT_TYPES: EventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

const eventSchema = z
  .object({
    title: z.string().min(1, 'Required').max(120),
    type: z.enum(['competition', 'camp', 'exam', 'seminar', 'workshop']),
    start: z.date({ required_error: 'Required' }),
    end: z.date({ required_error: 'Required' }),
    location: z.string().max(120).optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((d) => !d.start || !d.end || d.end > d.start, {
    message: 'End must be after start',
    path: ['end'],
  })

type EventFormData = z.infer<typeof eventSchema>

function formatDate(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── data hook ────────────────────────────────────────────────────────────────

function useOrgEvents(orgId: string, upcoming: boolean) {
  return useQuery<Event[]>({
    queryKey: ['org-events', orgId, upcoming ? 'upcoming' : 'past'],
    queryFn: async () => {
      const now = Timestamp.now()
      const q = query(
        collection(db, EVENTS_COLLECTION),
        where('orgId', '==', orgId),
        where('scope', '==', 'org'),
        where('deleted_at', '==', null),
        where('start', upcoming ? '>=' : '<', now),
        orderBy('start', upcoming ? 'asc' : 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)
    },
  })
}

// ─── Event dialog ─────────────────────────────────────────────────────────────

function OrgEventDialog({
  open,
  onClose,
  orgId,
  userId,
  editing,
}: {
  open: boolean
  onClose: () => void
  orgId: string
  userId: string
  editing: Event | null
}) {
  const qc = useQueryClient()
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: editing
      ? {
          title: editing.title,
          type: editing.type as EventFormData['type'],
          start: (editing.start as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
          end: (editing.end as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
          location: editing.location ?? '',
          description: editing.description ?? '',
        }
      : { type: 'competition' },
  })

  async function onSubmit(data: EventFormData) {
    const payload = {
      orgId,
      scope: 'org',
      teamId: null,
      title: data.title,
      type: data.type,
      start: Timestamp.fromDate(data.start),
      end: Timestamp.fromDate(data.end),
      location: data.location?.trim() || null,
      description: data.description?.trim() || null,
      status: 'open',
      deleted_at: null,
      createdBy: userId,
    }
    if (editing) {
      await updateDoc(doc(db, EVENTS_COLLECTION, editing.id), { ...payload, updated_at: serverTimestamp() })
    } else {
      await addDoc(collection(db, EVENTS_COLLECTION), { ...payload, created_at: serverTimestamp() })
    }
    qc.invalidateQueries({ queryKey: ['org-events', orgId] })
    // Also invalidate club events (they pick up org events too)
    qc.invalidateQueries({ queryKey: ['events'] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit event' : 'New organization event'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register('title')} placeholder="Championship 2026" />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { if (v) field.onChange(v) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Controller
                name="start"
                control={control}
                render={({ field }) => <DateTimePicker value={field.value} onChange={field.onChange} />}
              />
              {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Controller
                name="end"
                control={control}
                render={({ field }) => <DateTimePicker value={field.value} onChange={field.onChange} />}
              />
              {errors.end && <p className="text-xs text-destructive">{errors.end.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Location <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input {...register('location')} placeholder="Sports Hall, Geneva" />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input {...register('description')} placeholder="Visible to all clubs" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? '…' : editing ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrgEventsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const { user } = useAuth()
  const { isAdmin } = useOrg()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState<Event | null>(null)

  const upcoming = useOrgEvents(orgId, true)
  const past = useOrgEvents(orgId, false)
  const current = tab === 'upcoming' ? upcoming : past

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['org-events', orgId] })
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  async function handleSoftDelete() {
    if (!deleting) return
    await updateDoc(doc(db, EVENTS_COLLECTION, deleting.id), {
      deleted_at: serverTimestamp(),
    })
    invalidate()
    setDeleting(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Organization events</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Visible to all clubs in this organization.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
            <Plus className="h-4 w-4 mr-1.5" />New event
          </Button>
        )}
      </div>

      {/* Tab */}
      <div className="flex gap-1 border-b text-sm">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 border-b-2 -mb-px font-medium capitalize transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {current.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !current.data || current.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CalendarRange className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No {tab} events.</p>
          {isAdmin && tab === 'upcoming' && (
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
              <Plus className="h-4 w-4 mr-1.5" />New event
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {current.data.map((event) => (
            <div key={event.id} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="h-4 w-4 text-primary" />
              </div>
              <Link
                href={`/org/${orgId}/events/${event.id}` as Route}
                className="flex-1 min-w-0 block"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{event.title}</span>
                  <Badge variant="secondary" className="text-xs capitalize shrink-0">{event.type}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(event.start as { toDate(): Date })}
                  {event.location && (
                    <span className="ml-2 inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />{event.location}
                    </span>
                  )}
                </p>
              </Link>
              <div className="flex items-center gap-1 shrink-0">
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing(event); setDialogOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(event)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      )}

      {user && (
        <OrgEventDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditing(null) }}
          orgId={orgId}
          userId={user.uid}
          editing={editing}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.title} will be removed from all clubs' event lists.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSoftDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
