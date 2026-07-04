'use client'

import { useState, useMemo, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import {
  SESSIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
  EVENTS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  compareActivities,
} from '@linyup/shared'
import type { Session, Activity, Event } from '@linyup/shared'
import { useEventTypes } from '@/hooks/useEventTypes'
import { eventTypeLabel, prettyEventType } from '@/lib/eventTypeLabel'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import dynamic from 'next/dynamic'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateTimePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  ChevronDown,
  CalendarDays,
  CalendarRange,
  List,
  MapPin,
  Users,
  Pencil,
  Trash2,
  User,
  Repeat2,
  ArrowUpRight,
} from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { SectionIntro } from '@/components/onboarding/SectionIntro'
import { SessionFormDialog } from '@/components/sessions/SessionFormDialog'
import { SessionDeleteDialog } from '@/components/sessions/SessionDeleteDialog'

const SessionsCalendar = dynamic(() => import('../sessions/SessionsCalendar'), { ssr: false })

// ─── types ────────────────────────────────────────────────────────────────────

type CalendarView = 'calendar' | 'list'
type TimeTab = 'upcoming' | 'past'
type ItemFilter = 'all' | 'sessions' | 'events'
type ListItem = { kind: 'session'; data: Session } | { kind: 'event'; data: Event }

interface MemberDoc {
  id: string
  userId: string
  email?: string
  displayName?: string
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return '—'
  return ts
    .toDate()
    .toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function durationLabel(
  startTs: { toDate(): Date } | null | undefined,
  endTs: { toDate(): Date } | null | undefined
) {
  if (!startTs || !endTs) return ''
  const mins = Math.round((endTs.toDate().getTime() - startTs.toDate().getTime()) / 60000)
  const days = Math.floor(mins / 1440)
  if (days >= 1) return `${days}d`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

function memberLabel(m: MemberDoc) {
  return m.displayName ?? m.email ?? m.userId
}
function getItemMs(item: ListItem) {
  return (item.data.start as { toDate(): Date }).toDate().getTime()
}

// Day-divider helpers — group the list by calendar day with a human label.
function dayKey(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function dayDividerLabel(
  ms: number,
  rel: { today: string; tomorrow: string; yesterday: string }
) {
  const d = new Date(ms)
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  const now = new Date()
  const dayMonth = d.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
  if (diffDays === 0) return `${rel.today} · ${dayMonth}`
  if (diffDays === 1) return `${rel.tomorrow} · ${dayMonth}`
  if (diffDays === -1) return `${rel.yesterday} · ${dayMonth}`
  return `${d.toLocaleDateString([], { weekday: 'long' })}, ${dayMonth}`
}

// ─── schemas ──────────────────────────────────────────────────────────────────

const eventSchema = z
  .object({
    title: z.string().min(1, 'Required').max(120),
    // Open string: built-in slug, installed-plugin type id, or team-custom type id.
    type: z.string().min(1, 'Required'),
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
type EventForm = z.infer<typeof eventSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useAllSessions(teamId: string | null, year: number, month: number) {
  return useQuery<Session[]>({
    queryKey: ['sessions', 'calendar', teamId, year, month],
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!teamId) return []
      // Load prev + current + next month so navigation feels instant
      const from = Timestamp.fromDate(new Date(year, month - 1, 1))
      const to = Timestamp.fromDate(new Date(year, month + 2, 1))
      const snap = await getDocs(
        query(
          collection(db, SESSIONS_COLLECTION),
          where('teamId', '==', teamId),
          where('start', '>=', from),
          where('start', '<', to),
          orderBy('start', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
    },
  })
}

function useActivities(teamId: string | null) {
  return useQuery<Activity[]>({
    queryKey: ['activities', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(
          collection(db, ACTIVITIES_COLLECTION),
          where('teamId', '==', teamId),
          orderBy('name', 'asc')
        )
      )
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }) as Activity)
        .sort(compareActivities)
    },
  })
}

function useAllEvents(teamId: string | null, orgId: string | null | undefined) {
  return useQuery<Event[]>({
    queryKey: ['events', 'calendar', teamId, orgId],
    enabled: !!teamId,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (!teamId) return []
      const teamSnap = await getDocs(
        query(
          collection(db, EVENTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null),
          orderBy('start', 'asc')
        )
      )
      const teamEvents = teamSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)
      let orgEvents: Event[] = []
      if (orgId) {
        const orgSnap = await getDocs(
          query(
            collection(db, EVENTS_COLLECTION),
            where('orgId', '==', orgId),
            where('scope', '==', 'org'),
            where('deleted_at', '==', null),
            orderBy('start', 'asc')
          )
        )
        orgEvents = orgSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Event)
      }
      return [...teamEvents, ...orgEvents]
    },
  })
}

function useTeamMembers(teamId: string | null) {
  return useQuery<MemberDoc[]>({
    queryKey: ['team-members', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, TEAM_MEMBERS_SUBCOLLECTION),
          orderBy('joined')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as MemberDoc)
    },
  })
}

// ─── event form dialog ────────────────────────────────────────────────────────

function EventFormDialog({
  open,
  editing,
  members,
  teamId,
  userId,
  orgId,
  isOrgAdmin,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: Event | null
  members: MemberDoc[]
  teamId: string
  userId: string
  orgId: string | null | undefined
  isOrgAdmin: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('Events')
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EventForm>({
    resolver: zodResolver(eventSchema),
    defaultValues: editing
      ? {
          title: editing.title,
          type: editing.type as EventForm['type'],
          scope: (editing.scope ?? 'team') as 'team' | 'org',
          start: (editing.start as { toDate(): Date }).toDate(),
          end: (editing.end as { toDate(): Date }).toDate(),
          location: editing.location ?? '',
          fee: editing.fee != null ? String(editing.fee) : '',
          description: editing.description ?? '',
          coachId: editing.coachId ?? undefined,
          coachName: editing.coachName ?? '',
        }
      : {
          title: '',
          type: 'competition',
          scope: 'team',
          location: '',
          fee: '',
          description: '',
          coachName: '',
        },
  })

  const { types } = useEventTypes(teamId)
  // Keep the event's current type selectable even if its plugin was uninstalled
  // (or it's an unknown/legacy type) — otherwise editing would silently drop it.
  const typeOptions =
    editing && editing.type && !types.some((x) => x.id === editing.type)
      ? [...types, { id: editing.type, name: prettyEventType(editing.type), source: 'builtin' as const }]
      : types
  const labelForType = (id: string) =>
    eventTypeLabel(
      id,
      (k) => t.has(k as Parameters<typeof t>[0]),
      (k) => t(k as Parameters<typeof t>[0]),
      typeOptions.find((x) => x.id === id)?.name,
    )

  const onSubmit = async (data: EventForm) => {
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
      const isOrg = data.scope === 'org'
      await addDoc(collection(db, EVENTS_COLLECTION), {
        ...payload,
        ...(isOrg ? { scope: 'org', orgId, teamId: null } : { teamId, scope: 'team' }),
        createdBy: userId,
        status: 'open',
        participants_count: 0,
        deleted_at: null,
        created_at: serverTimestamp(),
      })
    }
    await qc.invalidateQueries({ queryKey: ['events'] })
    onSaved()
    onClose()
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose()
          reset()
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('editEvent') : t('newEvent')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* Scope toggle — org admin + new only */}
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
            <Label>{t('fieldType')}</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value ? (
                        labelForType(field.value)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((tp) => (
                      <SelectItem key={tp.id} value={tp.id}>
                        {labelForType(tp.id)}
                      </SelectItem>
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
              <Input
                id="ev-location"
                {...register('location')}
                placeholder={t('fieldLocationPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-fee">
                {t('fieldFee')}{' '}
                <span className="text-muted-foreground font-normal text-xs">
                  {t('fieldFeeOptional')}
                </span>
              </Label>
              <Input
                id="ev-fee"
                type="number"
                min="0"
                step="0.01"
                {...register('fee')}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">{t('fieldDescription')}</Label>
            <textarea
              id="ev-desc"
              {...register('description')}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
          {/* Coach */}
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
                          ? memberLabel(
                              members.find((m) => m.userId === field.value) ?? {
                                id: '',
                                userId: field.value,
                              }
                            )
                          : t('fieldCoachMemberPlaceholder')}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('fieldCoachMemberPlaceholder')}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {memberLabel(m)}
                        </SelectItem>
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onClose()
                reset()
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : editing ? t('saveChanges') : t('createEvent')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── list item row ────────────────────────────────────────────────────────────

const ACTIVITY_PALETTE = ['#7C3AED', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#F43F5E']

function activityAccent(activityId?: string | null, activities: Activity[] = []) {
  const custom = activities.find((a) => a.id === activityId)?.color
  if (custom) return custom
  if (!activityId) return ACTIVITY_PALETTE[0]
  let h = 0
  for (const ch of activityId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ACTIVITY_PALETTE[h % ACTIVITY_PALETTE.length]
}

function ListItemRow({
  item,
  activities,
  onEdit,
  onDelete,
}: {
  item: ListItem
  activities: Activity[]
  onEdit: () => void
  onDelete: () => void
}) {
  const tS = useTranslations('Sessions')
  const tE = useTranslations('Events')
  const tC = useTranslations('Calendar')

  if (item.kind === 'session') {
    const s = item.data
    const accent = activityAccent(s.activityId, activities)
    const dur = durationLabel(s.start, s.end)
    return (
      <div className="flex gap-3 p-4 border-b last:border-0 group hover:bg-muted/30 transition-colors">
        <div className="w-10 shrink-0 flex items-start justify-center pt-0.5">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${accent}22` }}
          >
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/sessions/${s.id}`}
                  className="font-medium text-sm hover:underline hover:text-primary transition-colors"
                >
                  {s.activityName ?? (
                    <span className="text-muted-foreground italic">{tC('noActivity')}</span>
                  )}
                </Link>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {tS(`type_${s.activityType ?? 'group_class'}` as Parameters<typeof tS>[0])}
                </Badge>
                {s.seriesId && <Repeat2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                {s.bookingMandatory && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    {tS('bookingRequiredChip')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDate(s.start)} · {formatTime(s.start)}
                {dur && <span className="ml-1 text-muted-foreground/60">({dur})</span>}
              </p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Link
                href={`/sessions/${s.id}`}
                aria-label={tC('openDetail')}
                title={tC('openDetail')}
                className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <button
                onClick={onEdit}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {s.location && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {s.location}
              </span>
            )}
            {s.instructorName && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3 shrink-0" />
                {s.instructorName}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3 shrink-0" />
              {s.max_participants
                ? `${s.participants_count ?? 0}/${s.max_participants}`
                : (s.participants_count ?? 0)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const e = item.data
  const dur = durationLabel(e.start, e.end)
  return (
    <div className="flex gap-3 p-4 border-b last:border-0 group hover:bg-muted/30 transition-colors">
      <div className="w-10 shrink-0 flex items-start justify-center pt-0.5">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <CalendarRange className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/events/${e.id}`}
                className="font-medium text-sm hover:underline hover:text-primary transition-colors"
              >
                {e.title}
              </Link>
              <Badge variant="secondary" className="text-xs shrink-0">
                {eventTypeLabel(
                  e.type,
                  (k) => tE.has(k as Parameters<typeof tE>[0]),
                  (k) => tE(k as Parameters<typeof tE>[0]),
                )}
              </Badge>
              {e.scope === 'org' && (
                <Badge variant="outline" className="text-xs shrink-0">
                  Org
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDate(e.start)} · {formatTime(e.start)}
              {dur && <span className="ml-1 text-muted-foreground/60">({dur})</span>}
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onEdit}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {e.location && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {e.location}
            </span>
          )}
          {e.coachName && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3 shrink-0" />
              {e.coachName}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" />
            {e.participants_count ?? 0}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { currentTeamId, user, team, isOrgAdmin } = useAuth()
  const qc = useQueryClient()
  const t = useTranslations('Calendar')
  const tCommon = useTranslations('Common')
  const orgId = team?.org_id ?? null

  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(() => today.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => today.getMonth())

  const [view, setView] = useState<CalendarView>('calendar')
  const [tab, setTab] = useState<TimeTab>('upcoming')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [activityFilter, setActivityFilter] = useState<string | null>(null)
  const [sessionDialog, setSessionDialog] = useState<{ open: boolean; editing: Session | null }>({
    open: false,
    editing: null,
  })
  const [deletingSession, setDeletingSession] = useState<Session | null>(null)
  const [eventDialog, setEventDialog] = useState<{ open: boolean; editing: Event | null }>({
    open: false,
    editing: null,
  })

  const sessionsQ = useAllSessions(currentTeamId, viewYear, viewMonth)
  const activitiesQ = useActivities(currentTeamId)
  const eventsQ = useAllEvents(currentTeamId, orgId)
  const { data: members = [] } = useTeamMembers(currentTeamId)

  const invalidateSessions = () => qc.invalidateQueries({ queryKey: ['sessions'] })
  const invalidateEvents = () => qc.invalidateQueries({ queryKey: ['events'] })

  const handleDeleteSession = (s: Session) => setDeletingSession(s)
  const deleteSessionLabel = deletingSession
    ? deletingSession.activityName
      ? `${deletingSession.activityName} – ${formatDate(deletingSession.start)}`
      : formatDate(deletingSession.start)
    : ''

  const handleDeleteEvent = async (e: Event) => {
    if (!window.confirm(`Delete event "${e.title}"? This cannot be undone.`)) return
    await updateDoc(doc(db, EVENTS_COLLECTION, e.id), { deleted_at: serverTimestamp() })
    invalidateEvents()
  }

  // ── combined list ──

  const nowMs = Date.now()
  const allItems: ListItem[] = [
    ...(sessionsQ.data ?? []).map((s) => ({ kind: 'session' as const, data: s })),
    ...(eventsQ.data ?? []).map((e) => ({ kind: 'event' as const, data: e })),
  ]
  const listItems = allItems
    .filter((item) => (tab === 'upcoming' ? getItemMs(item) >= nowMs : getItemMs(item) < nowMs))
    .filter(
      (item) =>
        filter === 'all' ||
        (filter === 'sessions' ? item.kind === 'session' : item.kind === 'event')
    )
    .filter(
      (item) =>
        !activityFilter ||
        item.kind !== 'session' ||
        (item.data as Session).activityId === activityFilter!
    )

    .sort((a, b) =>
      tab === 'upcoming' ? getItemMs(a) - getItemMs(b) : getItemMs(b) - getItemMs(a)
    )

  const isListLoading = sessionsQ.isLoading || eventsQ.isLoading
  const upcomingCount = allItems.filter((item) => getItemMs(item) >= nowMs).length

  const TABS: { key: TimeTab; label: string }[] = [
    { key: 'upcoming', label: t('tabUpcoming') },
    { key: 'past', label: t('tabPast') },
  ]
  const FILTERS: { key: ItemFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'sessions', label: t('filterSessions') },
    { key: 'events', label: t('filterEvents') },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <SectionIntro sectionKey="calendar" />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('subtitle', { count: upcomingCount })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="hidden sm:flex gap-1 p-1 bg-muted rounded-lg">
            {(
              [
                { key: 'calendar', icon: CalendarDays, label: t('viewCalendar') },
                { key: 'list', icon: List, label: t('viewList') },
              ] as const
            ).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                  view === key
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          {/* Add dropdown */}
          {currentTeamId && user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="h-4 w-4" />
                {t('newEntry')}
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSessionDialog({ open: true, editing: null })}>
                  <CalendarDays className="h-4 w-4 mr-2" />
                  {t('newSession')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEventDialog({ open: true, editing: null })}>
                  <CalendarRange className="h-4 w-4 mr-2" />
                  {t('newEvent')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Calendar view */}
      {view === 'calendar' && (
        <SessionsCalendar
          sessions={sessionsQ.data ?? []}
          activities={activitiesQ.data ?? []}
          events={eventsQ.data ?? []}
          onEdit={(s) => setSessionDialog({ open: true, editing: s })}
          onDelete={handleDeleteSession}
          onEventEdit={(e) => setEventDialog({ open: true, editing: e })}
          onEventDelete={handleDeleteEvent}
          viewYear={viewYear}
          viewMonth={viewMonth}
          onNavigate={(y, m) => {
            setViewYear(y)
            setViewMonth(m)
          }}
        />
      )}

      {/* List view */}
      {view === 'list' && (
        <>
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

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    setFilter(key)
                    if (key !== 'sessions') setActivityFilter(null)
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filter === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {filter === 'sessions' && (activitiesQ.data?.length ?? 0) > 0 && (
              <Select
                value={activityFilter ?? '__all__'}
                onValueChange={(v) => setActivityFilter(v === '__all__' ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs w-[160px]">
                  <span className="truncate">
                    {activityFilter
                      ? (activitiesQ.data?.find((a) => a.id === activityFilter)?.name ??
                        t('filterActivity'))
                      : t('filterActivity')}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('filterActivity')}</SelectItem>
                  {activitiesQ.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Combined list */}
          <div className="rounded-xl border overflow-hidden bg-card">
            {isListLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-4 border-b last:border-0">
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-64" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            {!isListLoading && listItems.length === 0 && (
              <div className="py-16 text-center text-muted-foreground text-sm">
                {tab === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
              </div>
            )}
            {!isListLoading &&
              (() => {
                let lastDay = ''
                return listItems.map((item) => {
                  const ms = getItemMs(item)
                  const dk = dayKey(ms)
                  const showDivider = dk !== lastDay
                  lastDay = dk
                  return (
                    <Fragment key={`${item.kind}-${item.data.id}`}>
                      {showDivider && (
                        <div className="px-4 py-1.5 bg-muted/40 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {dayDividerLabel(ms, {
                            today: tCommon('today'),
                            tomorrow: tCommon('tomorrow'),
                            yesterday: tCommon('yesterday'),
                          })}
                        </div>
                      )}
                      <ListItemRow
                        item={item}
                        activities={activitiesQ.data ?? []}
                        onEdit={() => {
                          if (item.kind === 'session')
                            setSessionDialog({ open: true, editing: item.data })
                          else setEventDialog({ open: true, editing: item.data })
                        }}
                        onDelete={() => {
                          if (item.kind === 'session') handleDeleteSession(item.data)
                          else handleDeleteEvent(item.data)
                        }}
                      />
                    </Fragment>
                  )
                })
              })()}
          </div>
        </>
      )}

      {/* Mobile FAB */}
      {currentTeamId && user && (
        <div className="sm:hidden fixed bottom-6 right-6 z-40">
          <DropdownMenu>
            <DropdownMenuTrigger className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors">
              <Plus className="h-6 w-6" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem onClick={() => setSessionDialog({ open: true, editing: null })}>
                <CalendarDays className="h-4 w-4 mr-2" />
                {t('newSession')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEventDialog({ open: true, editing: null })}>
                <CalendarRange className="h-4 w-4 mr-2" />
                {t('newEvent')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Dialogs */}
      {currentTeamId && user && (
        <>
          <SessionFormDialog
            key={sessionDialog.editing?.id ?? 'new-session'}
            open={sessionDialog.open}
            onOpenChange={(v) =>
              setSessionDialog((prev) => ({ open: v, editing: v ? prev.editing : null }))
            }
            editing={sessionDialog.editing}
            activities={activitiesQ.data ?? []}
            teamId={currentTeamId}
            userId={user.uid}
            onSaved={invalidateSessions}
          />
          <SessionDeleteDialog
            open={!!deletingSession}
            onOpenChange={(v) => {
              if (!v) setDeletingSession(null)
            }}
            session={deletingSession}
            label={deleteSessionLabel}
            onDeleted={invalidateSessions}
          />
          <EventFormDialog
            key={eventDialog.editing?.id ?? 'new-event'}
            open={eventDialog.open}
            editing={eventDialog.editing}
            members={members}
            teamId={currentTeamId}
            userId={user.uid}
            orgId={orgId}
            isOrgAdmin={isOrgAdmin}
            onClose={() => setEventDialog({ open: false, editing: null })}
            onSaved={invalidateEvents}
          />
        </>
      )}
    </div>
  )
}
