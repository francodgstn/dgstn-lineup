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
import { DateTimePicker } from '@/components/ui/date-picker'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EVENTS_COLLECTION, TEAMS_COLLECTION, TEAM_MEMBERS_SUBCOLLECTION } from '@linyup/shared'
import type { Event, EventType } from '@linyup/shared'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Pencil, Trash2, Users, MapPin, CalendarDays, User } from 'lucide-react'
import { Link } from '@/i18n/navigation'

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES: EventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

// ─── types ────────────────────────────────────────────────────────────────────

interface MemberDoc {
  id: string
  userId: string
  email?: string
  displayName?: string
}

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

function memberLabel(m: MemberDoc): string {
  return m.displayName ?? m.email ?? m.userId
}

// ─── schema ───────────────────────────────────────────────────────────────────

const eventSchema = z
  .object({
    title: z.string().min(1, 'Required').max(120),
    type: z.enum(['competition', 'camp', 'exam', 'seminar', 'workshop']),
    scope: z.enum(['team', 'org']).default('team'),
    start: z.date({ required_error: 'Required' }),
    end: z.date({ required_error: 'Required' }),
    location: z.string().max(120).optional(),
    fee: z.string().optional(),
    description: z.string().max(1000).optional(),
    coachId: z.string().optional(),
    coachName: z.string().max(120).optional(),
  })
  .refine((d) => !d.start || !d.end || d.end > d.start, {
    message: 'End must be after start',
    path: ['end'],
  })

type EventFormData = z.infer<typeof eventSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useEvents(teamId: string | null, orgId: string | null | undefined, upcoming: boolean) {
  return useQuery<Event[]>({
    queryKey: ['events', upcoming ? 'upcoming' : 'past', teamId, orgId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const now = Timestamp.now()

      // Team events
      const teamQ = query(
        collection(db, EVENTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('start', upcoming ? '>=' : '<', now),
        orderBy('start', upcoming ? 'asc' : 'desc'),
        limit(50),
      )
      const teamSnap = await getDocs(teamQ)
      const teamEvents = teamSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)

      // Org-wide events (only when team belongs to an org)
      let orgEvents: Event[] = []
      if (orgId) {
        const orgQ = query(
          collection(db, EVENTS_COLLECTION),
          where('orgId', '==', orgId),
          where('scope', '==', 'org'),
          where('deleted_at', '==', null),
          where('start', upcoming ? '>=' : '<', now),
          orderBy('start', upcoming ? 'asc' : 'desc'),
          limit(20),
        )
        const orgSnap = await getDocs(orgQ)
        orgEvents = orgSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)
      }

      // Merge and re-sort
      const all = [...teamEvents, ...orgEvents]
      all.sort((a, b) => {
        const at = (a.start as { toDate(): Date }).toDate().getTime()
        const bt = (b.start as { toDate(): Date }).toDate().getTime()
        return upcoming ? at - bt : bt - at
      })
      return all
    },
  })
}

function useTeamMembers(teamId: string | null) {
  return useQuery<MemberDoc[]>({
    queryKey: ['team-members', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, TEAMS_COLLECTION, teamId!, TEAM_MEMBERS_SUBCOLLECTION), orderBy('joined'))
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as MemberDoc))
    },
  })
}

// ─── event form dialog ────────────────────────────────────────────────────────

function EventDialog({
  open,
  onClose,
  teamId,
  userId,
  orgId,
  isOrgAdmin,
  members,
  editing,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  orgId: string | null | undefined
  isOrgAdmin: boolean
  members: MemberDoc[]
  editing: Event | null
}) {
  const t = useTranslations('Events')
  const qc = useQueryClient()

  const { register, handleSubmit, control, setValue, formState: { errors, isSubmitting } } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: editing
      ? {
          title: editing.title,
          type: editing.type as EventFormData['type'],
          scope: (editing.scope ?? 'team') as 'team' | 'org',
          start: (editing.start as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
          end: (editing.end as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
          location: editing.location ?? '',
          fee: editing.fee != null ? String(editing.fee) : '',
          description: editing.description ?? '',
          coachId: editing.coachId ?? undefined,
          coachName: editing.coachName ?? '',
        }
      : { title: '', type: 'competition', scope: 'team', start: undefined, end: undefined, location: '', fee: '', description: '', coachId: undefined, coachName: '' },
  })

  async function onSubmit(data: EventFormData) {
    const isOrg = data.scope === 'org'
    const payload = {
      title: data.title,
      type: data.type,
      start: Timestamp.fromDate(data.start),
      end: Timestamp.fromDate(data.end),
      location: data.location ?? '',
      fee: data.fee ? Number(data.fee) : null,
      description: data.description ?? '',
      coachId: data.coachId || null,
      coachName: data.coachName || null,
    }
    if (editing) {
      await updateDoc(doc(db, EVENTS_COLLECTION, editing.id), payload)
    } else {
      await addDoc(collection(db, EVENTS_COLLECTION), {
        ...payload,
        ...(isOrg
          ? { scope: 'org', orgId, teamId: null }
          : { teamId, scope: 'team' }),
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

          {/* Scope toggle — only for org admins creating a new event */}
          {isOrgAdmin && !editing && (
            <Controller
              name="scope"
              control={control}
              render={({ field }) => (
                <div className="space-y-1.5">
                  <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                    {(['team', 'org'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => field.onChange(s)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          field.value === s
                            ? 'bg-background shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(s === 'team' ? 'scopeTeam' : 'scopeOrg')}
                      </button>
                    ))}
                  </div>
                  {field.value === 'org' && (
                    <p className="text-xs text-muted-foreground">{t('scopeOrgHint')}</p>
                  )}
                </div>
              )}
            />
          )}

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
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value
                        ? t(`type_${field.value}` as Parameters<typeof t>[0])
                        : <span className="text-muted-foreground">—</span>}
                    </span>
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
              <Label>{t('fieldStart')}</Label>
              <Controller
                name="start"
                control={control}
                render={({ field }) => (
                  <DateTimePicker value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.start && <p className="text-destructive text-xs">{errors.start.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('fieldEnd')}</Label>
              <Controller
                name="end"
                control={control}
                render={({ field }) => (
                  <DateTimePicker value={field.value} onChange={field.onChange} />
                )}
              />
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

          {/* Coach / Instructor */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('fieldCoachMember')}</Label>
              <Controller
                name="coachId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? '__none__'}
                    onValueChange={(val) => {
                      if (val === '__none__') {
                        field.onChange(undefined)
                      } else {
                        field.onChange(val)
                        const m = members.find((m) => m.userId === val)
                        if (m) setValue('coachName', memberLabel(m))
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <span className="flex flex-1 text-left text-sm truncate text-muted-foreground">
                        {field.value
                          ? (memberLabel(members.find((m) => m.userId === field.value) ?? { id: '', userId: field.value }))
                          : t('fieldCoachMemberPlaceholder')}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('fieldCoachMemberPlaceholder')}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>{memberLabel(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-coach-name">{t('fieldCoachName')}</Label>
              <Input
                id="ev-coach-name"
                {...register('coachName')}
                placeholder={t('fieldCoachName')}
              />
            </div>
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
              <Link
                href={`/events/${event.id}`}
                className="font-medium text-sm hover:underline hover:text-primary transition-colors"
              >
                {event.title}
              </Link>
              <Badge variant="secondary" className="text-xs capitalize shrink-0">
                {t(`type_${event.type}` as Parameters<typeof t>[0])}
              </Badge>
              {event.scope === 'org' && (
                <Badge variant="outline" className="text-xs shrink-0">Org</Badge>
              )}
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
          {event.coachName && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3 shrink-0" />
              {event.coachName}
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
  const { currentTeamId, user, team, isOrgAdmin } = useAuth()
  const qc = useQueryClient()
  const t = useTranslations('Events')
  const [tab, setTab] = useState<Tab>('upcoming')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState<Event | null>(null)

  const orgId = team?.org_id ?? null
  const upcoming = useEvents(currentTeamId, orgId, true)
  const past = useEvents(currentTeamId, orgId, false)
  const { data: members = [] } = useTeamMembers(currentTeamId)
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
    <div className="space-y-6">
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
          orgId={orgId}
          isOrgAdmin={isOrgAdmin}
          members={members}
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
