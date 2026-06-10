'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  doc, getDoc, collection, getDocs, query, orderBy,
  updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import {
  ArrowLeft, CalendarDays, MapPin, CreditCard, Users, Mail,
  Pencil, Trash2, Send,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-picker'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { EVENTS_COLLECTION } from '@linyup/shared'
import type { Event, EventType, RankingSystem, Team } from '@linyup/shared'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { CheckinPanel } from '@/components/events/CheckinPanel'
import dynamic from 'next/dynamic'
import type { Route } from 'next'

const CategoryManager = dynamic(
  () => import('@/plugins/hmd-fighting-cup/CategoryManager').then((m) => ({ default: m.CategoryManager })),
  { ssr: false },
)

// ─── subcollection types ──────────────────────────────────────────────────────

interface EventAttendee {
  id: string
  contactId: string
  firstname?: string
  lastname?: string
  email?: string
  notes?: string | null
  respondedAt?: Timestamp
}

interface EventInvitation {
  id: string
  contactId: string
  firstname?: string
  lastname?: string
  email?: string
  status?: 'sent' | 'opened' | 'responded' | 'declined'
  sentAt?: Timestamp
  firstOpenedAt?: Timestamp
  respondedAt?: Timestamp
}

// ─── edit schema ──────────────────────────────────────────────────────────────

const EVENT_TYPES: EventType[] = ['competition', 'camp', 'exam', 'seminar', 'workshop']

const editSchema = z
  .object({
    title: z.string().min(1, 'Required').max(120),
    type: z.enum(['competition', 'camp', 'exam', 'seminar', 'workshop']),
    start: z.date({ required_error: 'Required' }),
    end: z.date({ required_error: 'Required' }),
    location: z.string().max(120).optional(),
    fee: z.string().optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((d) => !d.start || !d.end || d.end > d.start, {
    message: 'End must be after start',
    path: ['end'],
  })

type EditFormData = z.infer<typeof editSchema>

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts?: { toDate(): Date } | null) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function formatTime(ts?: { toDate(): Date } | null) {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function formatDateTime(ts?: { toDate(): Date } | null) {
  if (!ts) return '—'
  return ts.toDate().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
function statusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'open': return 'default'
    case 'restricted': return 'secondary'
    case 'closed': return 'outline'
    case 'cancelled': return 'destructive'
    default: return 'secondary'
  }
}
function invStatusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'responded': return 'default'
    case 'opened': return 'secondary'
    case 'declined': return 'destructive'
    default: return 'outline'
  }
}

// ─── edit dialog ──────────────────────────────────────────────────────────────

function EditEventDialog({
  event,
  onClose,
  onSaved,
}: {
  event: Event
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('Events')
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      title: event.title,
      type: event.type as EditFormData['type'],
      start: (event.start as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
      end: (event.end as { toDate(): Date } | null | undefined)?.toDate() ?? undefined,
      location: event.location ?? '',
      fee: event.fee != null ? String(event.fee) : '',
      description: event.description ?? '',
    },
  })

  async function onSubmit(data: EditFormData) {
    await updateDoc(doc(db, EVENTS_COLLECTION, event.id), {
      title: data.title,
      type: data.type,
      start: Timestamp.fromDate(data.start),
      end: Timestamp.fromDate(data.end),
      location: data.location ?? '',
      fee: data.fee ? Number(data.fee) : null,
      description: data.description ?? '',
    })
    onSaved()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editEvent')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
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
                      {field.value
                        ? t(`type_${field.value}` as Parameters<typeof t>[0])
                        : <span className="text-muted-foreground">—</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`type_${type}` as Parameters<typeof t>[0])}
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
              {isSubmitting ? t('saving') : t('saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── delete confirm dialog ────────────────────────────────────────────────────

function DeleteConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Events')
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('deleteEvent')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">{t('detail_deleteConfirm')}</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('deleteEvent')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number | string
  icon: React.ElementType
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'checkins' | 'categories' | 'attendees' | 'invitations'

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentTeamId, team, teamRole, isOrgAdmin } = useAuth()
  const t = useTranslations('Events')
  const router = useRouter()
  const qc = useQueryClient()

  const [tab, setTab] = useState<DetailTab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ text: string; isError: boolean } | null>(null)

  // ─── event data ──────────────────────────────────────────────────────────────

  const eventQ = useQuery<Event | null>({
    queryKey: ['event', id],
    enabled: !!id,
    queryFn: async () => {
      const snap = await getDoc(doc(db, EVENTS_COLLECTION, id))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() } as Event
    },
  })

  const attendeesQ = useQuery<EventAttendee[]>({
    queryKey: ['event-attendees', id],
    enabled: !!id && tab === 'attendees',
    queryFn: async () => {
      const snap = await getDocs(collection(db, EVENTS_COLLECTION, id, 'attendees'))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventAttendee)
    },
  })

  const invitationsQ = useQuery<EventInvitation[]>({
    queryKey: ['event-invitations', id],
    enabled: !!id && tab === 'invitations',
    queryFn: async () => {
      const q = query(
        collection(db, EVENTS_COLLECTION, id, 'invitations'),
        orderBy('sentAt', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventInvitation)
    },
  })

  const event = eventQ.data

  // ─── actions ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!id) return
    await updateDoc(doc(db, EVENTS_COLLECTION, id), { deleted_at: serverTimestamp() })
    router.push('/schedule' as Route)
  }

  async function handleSendInvitations(resend: boolean) {
    setSending(true)
    setSendResult(null)
    try {
      const fn = httpsCallable<{ eventId: string; resend: boolean }, { stats: { sent: number; skipped: number } }>(
        functions,
        'sendEventInvitations',
      )
      const result = await fn({ eventId: id, resend })
      const { sent, skipped } = result.data.stats
      const parts = [t('detail_invitationsSent', { sent })]
      if (skipped > 0) parts.push(t('detail_invitationsSkipped', { skipped }))
      setSendResult({ text: parts.join(' · '), isError: false })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['event', id] }),
        qc.invalidateQueries({ queryKey: ['event-invitations', id] }),
      ])
    } catch (err) {
      setSendResult({ text: (err as Error).message ?? 'Error', isError: true })
    } finally {
      setSending(false)
    }
  }

  // ─── loading / not found ──────────────────────────────────────────────────────

  if (eventQ.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (!event || event.deleted_at) {
    return (
      <div className="space-y-4">
        <Link
          href="/schedule"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('detail_back')}
        </Link>
        <p className="text-muted-foreground">{t('detail_notFound')}</p>
      </div>
    )
  }

  const startDate = formatDate(event.start)
  const startTime = formatTime(event.start)
  const endTime = formatTime(event.end)
  const duration = eventDuration(event)

  // Ranking systems come from the team config, not the event doc
  const rankingSystems: RankingSystem[] = team?.ranking_systems ?? []

  // Detect if this event type is backed by a plugin that declares hasCategories
  const eventPlugin = PLUGIN_REGISTRY.find((p) => p.eventType?.id === event.type)
  const showCategoriesTab = !!eventPlugin?.eventType?.hasCategories

  // Attendees tab: visible to org admins (cross-club events) and team owners/managers
  const canSeeAttendees = isOrgAdmin || teamRole === 'owner' || teamRole === 'manager'

  const checkinLabel = (() => {
    const total = event.participants_count ?? 0
    const confirmed = event.completed_checkins_count ?? 0
    if (total === 0) return 'Checkins'
    if (confirmed < total) return `Checkins (${confirmed}/${total})`
    return `Checkins (${total})`
  })()

  const TABS: { key: DetailTab; label: string }[] = [
    { key: 'overview',    label: t('detail_tabOverview') },
    { key: 'checkins',    label: checkinLabel },
    ...(showCategoriesTab ? [{ key: 'categories' as DetailTab, label: 'Categories' }] : []),
    ...(canSeeAttendees ? [{ key: 'attendees' as DetailTab, label: `${t('detail_tabAttendees')}${event.attendees_count ? ` (${event.attendees_count})` : ''}` }] : []),
    { key: 'invitations', label: `${t('detail_tabInvitations')}${event.invitations_sent_count ? ` (${event.invitations_sent_count})` : ''}` },
  ]

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/schedule"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('detail_back')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
            <Badge variant="secondary" className="capitalize shrink-0">
              {t(`type_${event.type}` as Parameters<typeof t>[0])}
            </Badge>
            {event.status && (
              <Badge variant={statusVariant(event.status)} className="shrink-0">
                {t(`detail_status_${event.status}` as Parameters<typeof t>[0])}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {startDate}
              {startTime && (
                <> · {startTime}{endTime && endTime !== startTime ? ` – ${endTime}` : ''}</>
              )}
              {duration && <span className="text-muted-foreground/60 ml-1">({duration})</span>}
            </span>
            {event.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {event.location}
              </span>
            )}
            {event.fee != null && (
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                {event.fee}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1.5" />
            {t('editEvent')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Send invitations bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/40">
        <Send className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{t('detail_sendInvitations')}</p>
          {sendResult && (
            <p className={`text-xs mt-0.5 ${sendResult.isError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {sendResult.text}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            disabled={sending}
            onClick={() => handleSendInvitations(true)}
          >
            {t('detail_resendAll')}
          </Button>
          <Button
            size="sm"
            disabled={sending}
            onClick={() => handleSendInvitations(false)}
          >
            {sending ? t('detail_sending') : t('detail_sendInvitations')}
          </Button>
        </div>
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

      {/* ── Overview tab ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              label={t('detail_statsCheckins')}
              value={event.participants_count ?? 0}
              icon={Users}
            />
            <StatCard
              label={t('detail_statsRSVP')}
              value={event.attendees_count ?? 0}
              icon={Users}
            />
            <StatCard
              label={t('detail_statsInvited')}
              value={event.invitations_sent_count ?? 0}
              icon={Mail}
            />
          </div>

          {event.description ? (
            <div>
              <h3 className="text-sm font-medium mb-2">{t('detail_fieldDescription')}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">{t('detail_noDescription')}</p>
          )}
        </div>
      )}

      {/* ── Check-ins tab ───────────────────────────────────────────────────── */}
      {tab === 'checkins' && (
        <CheckinPanel
          eventId={id}
          eventTitle={event.title}
          eventType={event.type}
          rankingSystems={rankingSystems}
          orgId={event.orgId ?? (team as Team & { org_id?: string })?.org_id}
        />
      )}

      {/* ── Categories tab (plugin-provided, e.g. fighting_cup) ──────────────── */}
      {tab === 'categories' && showCategoriesTab && (
        <CategoryManager eventId={id} />
      )}

      {/* ── Attendees tab ────────────────────────────────────────────────────── */}
      {tab === 'attendees' && (
        <div className="rounded-xl border overflow-hidden bg-card">
          {attendeesQ.isLoading && (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-4 border-b last:border-0">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-3 w-20 shrink-0" />
              </div>
            ))
          )}

          {!attendeesQ.isLoading && (attendeesQ.data?.length ?? 0) === 0 && (
            <div className="py-14 text-center text-muted-foreground text-sm">
              {t('detail_attendeesEmpty')}
            </div>
          )}

          {!attendeesQ.isLoading && attendeesQ.data?.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-4 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {[a.firstname, a.lastname].filter(Boolean).join(' ') || a.contactId}
                </p>
                {a.email && (
                  <p className="text-xs text-muted-foreground mt-0.5">{a.email}</p>
                )}
                {a.notes && (
                  <p className="text-xs text-muted-foreground/70 italic mt-0.5">"{a.notes}"</p>
                )}
              </div>
              {a.respondedAt && (
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                  {formatDateTime(a.respondedAt)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Invitations tab ──────────────────────────────────────────────────── */}
      {tab === 'invitations' && (
        <div className="rounded-xl border overflow-hidden bg-card">
          {invitationsQ.isLoading && (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-4 border-b last:border-0">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <div className="space-y-1.5 shrink-0">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))
          )}

          {!invitationsQ.isLoading && (invitationsQ.data?.length ?? 0) === 0 && (
            <div className="py-14 text-center text-muted-foreground text-sm">
              {t('detail_invitationsEmpty')}
            </div>
          )}

          {!invitationsQ.isLoading && invitationsQ.data?.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 p-4 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {[inv.firstname, inv.lastname].filter(Boolean).join(' ') || inv.contactId}
                </p>
                {inv.email && (
                  <p className="text-xs text-muted-foreground mt-0.5">{inv.email}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <Badge variant={invStatusVariant(inv.status)} className="text-xs">
                  {t(`detail_invStatus_${inv.status ?? 'sent'}` as Parameters<typeof t>[0])}
                </Badge>
                {inv.sentAt && (
                  <span className="text-xs text-muted-foreground">{formatDateTime(inv.sentAt)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      {editOpen && event && (
        <EditEventDialog
          key={event.id}
          event={event}
          onClose={() => setEditOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['event', id] })}
        />
      )}

      {deleteOpen && (
        <DeleteConfirmDialog
          onConfirm={handleDelete}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
