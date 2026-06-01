'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  collection, query, where, orderBy, getDocs, addDoc, updateDoc,
  doc, serverTimestamp, Timestamp, deleteField,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MultiSelect } from '@/components/ui/multi-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CONTACTS_COLLECTION, TEAMS_COLLECTION, CONTACT_REQUESTS_SUBCOLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
} from '@lineup/shared'
import type { Contact, MembershipStatus, ContactType, ContactRequest, RankingSystem, SubscriptionType } from '@lineup/shared'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Search, UserPlus, Filter, X, Flame,
  Star, AlertCircle, ChevronDown, ChevronUp, Archive, Trash2, RotateCcw,
  MoreHorizontal, ArrowRightLeft, Mail, Pencil, Award, CreditCard, Tag,
} from 'lucide-react'
import type { Route } from 'next'
import { RosterCard } from '@/components/dashboard/RosterCard'
import { DemographicsCard } from '@/components/dashboard/DemographicsCard'
import { getPrimaryRank } from '@/lib/rank-utils'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary', requested: 'outline', under_review: 'outline',
  almost_ready: 'outline', active: 'default', expired: 'destructive',
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate(): Date }).toDate()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number') return new Date((ts as { seconds: number }).seconds * 1000)
  return null
}

function daysUntilAnonymisation(deletedAt: unknown): number | null {
  const deleted = tsToDate(deletedAt)
  if (!deleted) return null
  const deadline = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
}

// ─── schema ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['trial', 'student', 'external']),
})
type CreateValues = z.infer<typeof createSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useActiveContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact)
    },
  })
}

function useArchivedContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'archived', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('archived_at', '!=', null),
        where('deleted_at', '==', null),
        orderBy('archived_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact)
    },
  })
}

function useDeletedContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'deleted', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('anonymized_at', '==', null),
        where('teamId', '==', teamId),
        where('deleted_at', '!=', null),
        orderBy('deleted_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact)
    },
  })
}

function useContactRequests(teamId: string | null) {
  return useQuery<ContactRequest[]>({
    queryKey: ['contact-requests', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, TEAMS_COLLECTION, teamId, CONTACT_REQUESTS_SUBCOLLECTION),
        orderBy('requested_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContactRequest)
    },
  })
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionType)
    },
  })
}

// ─── create dialog ────────────────────────────────────────────────────────────

function CreateContactDialog({
  open, onOpenChange, teamId, userId, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  teamId: string; userId: string; onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { type: 'trial' },
  })
  const type = watch('type')
  const TYPES: ContactType[] = ['trial', 'student', 'external']

  const onSubmit = async (values: CreateValues) => {
    await addDoc(collection(db, CONTACTS_COLLECTION), {
      teamId,
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      type: values.type,
      membership_status: 'guest',
      createdBy: userId,
      created_at: serverTimestamp(),
      deleted_at: null,
      archived_at: null,
      anonymized_at: null,
    })
    reset()
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addContact')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="contents">
          <div className="space-y-4 pt-1">
            {/* Type radio */}
            <div className="flex gap-2">
              {TYPES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setValue('type', v)}
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    type === v
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`type_${v}`)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldFirstname')} *</label>
                <Input {...register('firstname')} autoCapitalize="words" />
                {errors.firstname && <p className="text-xs text-destructive">{errors.firstname.message}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldLastname')} *</label>
                <Input {...register('lastname')} autoCapitalize="words" />
                {errors.lastname && <p className="text-xs text-destructive">{errors.lastname.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('colEmail')}</label>
                <Input type="email" {...register('email')} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldPhone')}</label>
                <Input type="tel" {...register('phone')} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isSubmitting ? tCommon('loading') : t('createContact')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  open, onOpenChange, title, desc, confirmLabel, onConfirm, destructive = false,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  title: string; desc: string; confirmLabel: string
  onConfirm: () => Promise<void>; destructive?: boolean
}) {
  const t = useTranslations('Contacts')
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false); onOpenChange(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{desc}</p>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
            {t('cancel')}
          </button>
          <button onClick={handleConfirm} disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}>
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── overview panel ───────────────────────────────────────────────────────────

function OverviewPanel({
  contacts, loading, rankingSystems,
}: {
  contacts: Contact[]
  loading: boolean
  rankingSystems?: RankingSystem[]
}) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(true)

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {t('statsTitle')}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RosterCard contacts={contacts} />
          <DemographicsCard contacts={contacts} rankingSystems={rankingSystems} />
        </div>
      )}
    </div>
  )
}

// ─── filter panel ─────────────────────────────────────────────────────────────

type InactivityPreset = 'never' | '30d' | '60d' | '90d'

interface Filters {
  types: string[]
  statuses: string[]
  subscriptions: string[]    // subscription_type_id values; 'none' = no subscription
  hasAlerts: boolean
  sessionsMin: number | null
  sessionsMax: number | null
  inactivity: InactivityPreset | null
}
const EMPTY_FILTERS: Filters = {
  types: [], statuses: [], subscriptions: [],
  hasAlerts: false, sessionsMin: null, sessionsMax: null, inactivity: null,
}

function countActiveFilters(f: Filters): number {
  return f.types.length + f.statuses.length + f.subscriptions.length
    + (f.hasAlerts ? 1 : 0)
    + (f.sessionsMin != null || f.sessionsMax != null ? 1 : 0)
    + (f.inactivity ? 1 : 0)
}

function FilterPanel({
  filters,
  onChange,
  subscriptionTypes,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  subscriptionTypes: SubscriptionType[]
}) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(false)
  const activeCount = countActiveFilters(filters)

  const TYPE_OPTS = (['trial', 'student', 'external'] as ContactType[]).map((v) => ({
    value: v, label: t(`type_${v}`),
  }))
  const STATUS_OPTS = (
    ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired'] as MembershipStatus[]
  ).map((v) => ({ value: v, label: t(`status_${v}`) }))

  const SUBSCRIPTION_OPTS = [
    { value: 'none', label: t('filterSubscriptionNone') },
    ...subscriptionTypes.map((s) => ({ value: s.id, label: s.name })),
  ]

  const INACTIVITY_OPTS: { value: InactivityPreset; label: string }[] = [
    { value: 'never',  label: t('filterInactivityNever') },
    { value: '30d',    label: t('filterInactivity30d') },
    { value: '60d',    label: t('filterInactivity60d') },
    { value: '90d',    label: t('filterInactivity90d') },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            activeCount > 0 ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted text-muted-foreground'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {t('filtersLabel')}
          {activeCount > 0 && <span className="text-xs font-bold">{activeCount}</span>}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {activeCount > 0 && (
          <button onClick={() => onChange(EMPTY_FILTERS)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />{t('clearFilters')}
          </button>
        )}
      </div>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 rounded-xl border bg-muted/30">
          {/* Type */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterType')}</p>
            <MultiSelect
              options={TYPE_OPTS}
              value={filters.types}
              onChange={(types) => onChange({ ...filters, types })}
            />
          </div>

          {/* Status */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterStatus')}</p>
            <MultiSelect
              options={STATUS_OPTS}
              value={filters.statuses}
              onChange={(statuses) => onChange({ ...filters, statuses })}
            />
          </div>

          {/* Subscription */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterSubscription')}</p>
            <MultiSelect
              options={SUBSCRIPTION_OPTS}
              value={filters.subscriptions}
              onChange={(subscriptions) => onChange({ ...filters, subscriptions })}
            />
          </div>

          {/* Sessions count */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterSessions')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                placeholder={t('filterSessionsMin')}
                value={filters.sessionsMin ?? ''}
                onChange={(e) => onChange({ ...filters, sessionsMin: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-md border px-2 py-1.5 text-sm"
              />
              <span className="text-muted-foreground text-xs shrink-0">–</span>
              <input
                type="number"
                min={0}
                placeholder={t('filterSessionsMax')}
                value={filters.sessionsMax ?? ''}
                onChange={(e) => onChange({ ...filters, sessionsMax: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Last active */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterLastActive')}</p>
            <div className="flex flex-wrap gap-1.5">
              {INACTIVITY_OPTS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...filters, inactivity: filters.inactivity === opt.value ? null : opt.value })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    filters.inactivity === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterAlerts')}</p>
            <button
              onClick={() => onChange({ ...filters, hasAlerts: !filters.hasAlerts })}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                filters.hasAlerts ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {t('filterAlertsLabel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── contact row ──────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  selectable,
  selected,
  onSelect,
  rankingSystems = [],
}: {
  contact: Contact
  selectable: boolean
  selected: boolean
  onSelect: (id: string) => void
  rankingSystems?: RankingSystem[]
}) {
  const router = useRouter()
  const t = useTranslations('Contacts')
  const isNew = contact.acquisition?.acknowledged === false
  const rankColor = rankingSystems.length > 0
    ? getPrimaryRank(contact, rankingSystems)?.level.color
    : undefined

  return (
    <div className="flex items-center border-b last:border-0 hover:bg-muted/50 transition-colors">
      <button
        onClick={() => router.push(`/contacts/${contact.id}` as Route)}
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
      >
        {/* Avatar */}
        <div className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center bg-muted text-muted-foreground text-sm font-semibold relative">
          {initials(contact)}
          {rankColor && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background"
              style={{ background: rankColor }}
            />
          )}
        </div>

        {/* Text block */}
        <div className="flex-1 min-w-0 space-y-0.5">
          {/* Line 1: name */}
          <p className="font-medium text-sm truncate">
            {contact.firstname} {contact.lastname}
            {isNew && (
              <span className="ml-2 text-xs font-semibold text-blue-500">{t('newBadge')}</span>
            )}
          </p>
          {/* Line 2: email + score/streak (desktop) */}
          <p className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
            <span className="truncate">{contact.email ?? contact.phone ?? '—'}</span>
            {(contact.current_month_score ?? 0) > 0 && (
              <span className="hidden md:flex items-center gap-0.5 shrink-0">
                <Star className="h-3 w-3 text-yellow-500" />{contact.current_month_score}
              </span>
            )}
            {(contact.current_streak ?? 0) > 0 && (
              <span className="hidden md:flex items-center gap-0.5 shrink-0">
                <Flame className="h-3 w-3 text-orange-500" />{contact.current_streak}w
              </span>
            )}
          </p>
          {/* Line 3: type + status chips */}
          <div className="flex items-center gap-1.5 pt-0.5">
            {contact.type && (
              <Badge variant="outline" className="text-xs">{t(`type_${contact.type}`)}</Badge>
            )}
            {contact.membership_status && (
              <Badge variant={STATUS_VARIANT[contact.membership_status]} className="text-xs">
                {t(`status_${contact.membership_status}`)}
              </Badge>
            )}
          </div>
        </div>
      </button>

      {/* Alerts indicator */}
      {(contact.alerts_count ?? 0) > 0 && (
        <div className="flex items-center gap-1 shrink-0 px-3 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-semibold">{contact.alerts_count}</span>
        </div>
      )}

      {/* Checkbox — right side */}
      {selectable && (
        <label className="pr-4 pl-2 py-3 cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(contact.id)}
            className="h-4 w-4 rounded border-border"
          />
        </label>
      )}
    </div>
  )
}

// ─── deleted row ──────────────────────────────────────────────────────────────

function DeletedRow({
  contact, selected, onSelect,
}: {
  contact: Contact; selected: boolean; onSelect: (id: string) => void
}) {
  const t = useTranslations('Contacts')
  const days = daysUntilAnonymisation(contact.deleted_at)

  return (
    <div className="flex items-center gap-1 border-b last:border-0 px-4 py-3">
      <label className="mr-2 cursor-pointer">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(contact.id)}
          className="h-4 w-4 rounded border-border"
        />
      </label>
      <div className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center bg-muted text-muted-foreground text-sm font-semibold">
        {initials(contact)}
      </div>
      <div className="flex-1 min-w-0 ml-3">
        <p className="font-medium text-sm truncate">{contact.firstname} {contact.lastname}</p>
        {days !== null && (
          <p className={`text-xs ${days <= 7 ? 'text-destructive' : 'text-amber-600'}`}>
            {t('deletedDaysLeft', { days })}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── requests tab ─────────────────────────────────────────────────────────────

function RequestsTab({ teamId }: { teamId: string }) {
  const { data: requests = [], isLoading } = useContactRequests(teamId)

  if (isLoading) return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )
  if (requests.length === 0) return (
    <div className="py-16 text-center text-muted-foreground text-sm">No pending requests.</div>
  )
  return (
    <div className="rounded-xl border overflow-hidden bg-card">
      {requests.map((r) => (
        <div key={r.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{r.contact_name ?? r.contact_id}</p>
            {r.note && <p className="text-xs text-muted-foreground mt-0.5">{r.note}</p>}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {r.requested_at?.toDate().toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── bulk edit dialogs ────────────────────────────────────────────────────────

function BulkSetRankDialog({
  open, onOpenChange, rankingSystems, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  rankingSystems: RankingSystem[]; count: number
  onConfirm: (systemId: string, value: number | null) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const [systemId, setSystemId] = useState(rankingSystems[0]?.id ?? '')
  const [level, setLevel] = useState<number | 'clear' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setSystemId(rankingSystems[0]?.id ?? ''); setLevel(null) }
  }, [open, rankingSystems])

  const system = rankingSystems.find((s) => s.id === systemId)
  const useButtons = (system?.levels.length ?? 0) <= 6

  const handleConfirm = async () => {
    if (!systemId || level === null) return
    setBusy(true)
    try { await onConfirm(systemId, level === 'clear' ? null : level); onOpenChange(false) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('bulkSetRankTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          {rankingSystems.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('bulkRankSystem')}</p>
              <div className="flex flex-wrap gap-1.5">
                {rankingSystems.map((s) => (
                  <button key={s.id}
                    onClick={() => { setSystemId(s.id); setLevel(null) }}
                    className={`px-3 py-1 rounded-lg border text-sm font-medium transition-colors ${
                      systemId === s.id ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >{s.name}</button>
                ))}
              </div>
            </div>
          )}

          {system && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('bulkRankLevel')}</p>
              {useButtons ? (
                <div className="flex flex-wrap gap-1.5">
                  {system.levels.map((l) => (
                    <button key={l.value}
                      onClick={() => setLevel(level === l.value ? null : l.value)}
                      className={`flex items-center gap-1.5 py-1 px-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        level === l.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {l.color && <div className="h-2.5 w-2.5 rounded-full shrink-0 border border-border" style={{ background: l.color }} />}
                      {l.label}
                    </button>
                  ))}
                </div>
              ) : (
                <Select
                  value={typeof level === 'number' ? String(level) : ''}
                  onValueChange={(v) => setLevel(v === '' ? null : Number(v))}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {system.levels.map((l) => (
                      <SelectItem key={l.value} value={String(l.value)}>
                        <span className="flex items-center gap-2">
                          {l.color && <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" style={{ background: l.color }} />}
                          {l.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                onClick={() => setLevel(level === 'clear' ? null : 'clear')}
                className={`text-xs transition-colors ${level === 'clear' ? 'text-destructive font-medium' : 'text-muted-foreground hover:text-destructive'}`}
              >
                {t('bulkClearRank')}
              </button>
            </div>
          )}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || level === null}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkSetSubscriptionDialog({
  open, onOpenChange, subscriptionTypes, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  subscriptionTypes: SubscriptionType[]; count: number
  onConfirm: (type: SubscriptionType | null) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const tSettings = useTranslations('TeamSettings')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) setPicked(null) }, [open])

  const handleConfirm = async () => {
    if (!picked) return
    setBusy(true)
    const type = picked === 'none' ? null : subscriptionTypes.find((s) => s.id === picked) ?? null
    try { await onConfirm(type); onOpenChange(false) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('bulkSetSubscriptionTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-1 py-1 max-h-72 overflow-y-auto">
          <button
            onClick={() => setPicked(picked === 'none' ? null : 'none')}
            className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${picked === 'none' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
          >
            <p className="font-medium text-muted-foreground">{t('bulkSubscriptionNone')}</p>
          </button>
          {subscriptionTypes.map((st) => (
            <button key={st.id}
              onClick={() => setPicked(picked === st.id ? null : st.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${picked === st.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
            >
              <div className="flex items-center gap-2">
                <p className="font-medium flex-1">{st.name}</p>
                <Badge variant={st.source === 'aggregator' ? 'secondary' : 'outline'} className="text-xs shrink-0">
                  {tSettings(st.source === 'aggregator' ? 'subTypeSourceAggregator' : 'subTypeSourceInternal')}
                </Badge>
              </div>
              {st.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{st.description}</p>}
            </button>
          ))}
          {subscriptionTypes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{t('bulkNoSubscriptions')}</p>
          )}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || !picked}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkSetTypeDialog({
  open, onOpenChange, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  count: number
  onConfirm: (type: ContactType) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const [selected, setSelected] = useState<ContactType | null>(null)
  const [busy, setBusy] = useState(false)
  const TYPES: ContactType[] = ['trial', 'student', 'external']

  useEffect(() => { if (open) setSelected(null) }, [open])

  const handleConfirm = async () => {
    if (!selected) return
    setBusy(true)
    try { await onConfirm(selected); onOpenChange(false) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>{t('bulkSetTypeTitle')}</DialogTitle></DialogHeader>
        <div className="py-1">
          <div className="flex gap-2">
            {TYPES.map((v) => (
              <button key={v}
                onClick={() => setSelected(selected === v ? null : v)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  selected === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`type_${v}`)}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || !selected}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── bulk action bar ──────────────────────────────────────────────────────────

interface MoreAction {
  label: string
  icon: React.ElementType
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

function BulkBar({
  count, tab, onArchive, onDelete, onRestore, onClear, moreActions = [], editActions = [],
}: {
  count: number; tab: TabId
  onArchive?: () => void; onDelete?: () => void; onRestore?: () => void; onClear: () => void
  moreActions?: MoreAction[]
  editActions?: MoreAction[]
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border rounded-full shadow-lg px-4 py-2">
      <span className="text-sm font-medium mr-2">{t('bulkSelected', { count })}</span>

      {editActions.length > 0 && (
        <>
          <Popover>
            <PopoverTrigger className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors">
              <Pencil className="h-3.5 w-3.5" />
              {t('bulkEditFields')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-52 p-1">
              {editActions.map((action) => (
                <button key={action.label} onClick={action.onClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors text-left">
                  <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {action.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
        </>
      )}

      {onArchive && (
        <button onClick={onArchive}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors">
          <Archive className="h-3.5 w-3.5" />{t('bulkArchive')}
        </button>
      )}
      {onRestore && (
        <button onClick={onRestore}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors">
          <RotateCcw className="h-3.5 w-3.5" />{t('bulkRestore')}
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />{t('bulkDelete')}
        </button>
      )}

      {moreActions.length > 0 && (
        <>
          <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
          <Popover>
            <PopoverTrigger
              className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground"
              aria-label={t('bulkMore')}
            >
              <MoreHorizontal className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-52 p-1">
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.disabled ? undefined : action.onClick}
                  disabled={action.disabled}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    action.disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : action.destructive
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'hover:bg-muted'
                  }`}
                >
                  <action.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{action.label}</span>
                  {action.disabled && (
                    <span className="text-xs text-muted-foreground">{tCommon('comingSoon')}</span>
                  )}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </>
      )}

      <button onClick={onClear}
        className="p-1.5 rounded-full hover:bg-muted transition-colors ml-0.5 text-muted-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── tab types ────────────────────────────────────────────────────────────────

type TabId = 'active' | 'archived' | 'deleted' | 'requests'

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId, user, team } = useAuth()
  const { isAtLeast } = usePlan()
  const qc = useQueryClient()
  const t = useTranslations('Contacts')

  const { data: active = [], isLoading: loadingActive } = useActiveContacts(currentTeamId)
  const { data: archived = [], isLoading: loadingArchived } = useArchivedContacts(currentTeamId)
  const { data: deleted = [], isLoading: loadingDeleted } = useDeletedContacts(currentTeamId)
  const { data: requests = [] } = useContactRequests(currentTeamId)
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(currentTeamId)

  const [tab, setTab] = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bulkEditMode, setBulkEditMode] = useState<'rank' | 'subscription' | 'type' | null>(null)

  // confirm dialogs
  const [confirmArchive, setConfirmArchive] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string[]>([])
  const [confirmRestore, setConfirmRestore] = useState<string[]>([])

  const invalidateContacts = () => qc.invalidateQueries({ queryKey: ['contacts'] })
  const invalidateAll = () => { invalidateContacts(); setSelected(new Set()) }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── filter + search active contacts ───────────────────────────────────────

  const filteredActive = useMemo(() => {
    let result = active

    if (filters.types.length > 0)
      result = result.filter((c) => c.type && filters.types.includes(c.type))

    if (filters.statuses.length > 0)
      result = result.filter((c) => c.membership_status && filters.statuses.includes(c.membership_status))

    if (filters.subscriptions.length > 0) {
      result = result.filter((c) => {
        if (filters.subscriptions.includes('none')) {
          if (!c.subscription_type_id) return true
        }
        return c.subscription_type_id && filters.subscriptions.includes(c.subscription_type_id)
      })
    }

    if (filters.hasAlerts)
      result = result.filter((c) => (c.alerts_count ?? 0) > 0)

    if (filters.sessionsMin != null)
      result = result.filter((c) => (c.total_sessions ?? 0) >= filters.sessionsMin!)
    if (filters.sessionsMax != null)
      result = result.filter((c) => (c.total_sessions ?? 0) <= filters.sessionsMax!)

    if (filters.inactivity) {
      const now = Date.now()
      result = result.filter((c) => {
        const last = c.last_session_at
          ? (c.last_session_at as { toDate(): Date }).toDate().getTime()
          : null
        if (filters.inactivity === 'never') return last === null
        const days = filters.inactivity === '30d' ? 30 : filters.inactivity === '60d' ? 60 : 90
        const cutoff = now - days * 86400000
        return last === null || last < cutoff
      })
    }

    const q = search.trim().toLowerCase()
    if (q)
      result = result.filter((c) =>
        `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      )

    return result
  }, [active, filters, search])

  const filteredArchived = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return archived
    return archived.filter((c) =>
      `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
  }, [archived, search])

  const filteredDeleted = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return deleted
    return deleted.filter((c) =>
      `${c.firstname} ${c.lastname}`.toLowerCase().includes(q)
    )
  }, [deleted, search])

  // ── current list & loading state ──────────────────────────────────────────

  const currentList = tab === 'active' ? filteredActive : tab === 'archived' ? filteredArchived : filteredDeleted
  const isLoading = tab === 'active' ? loadingActive : tab === 'archived' ? loadingArchived : loadingDeleted

  // ── bulk handlers ─────────────────────────────────────────────────────────

  const archiveContacts = async (ids: string[]) => {
    await Promise.all(ids.map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), { archived_at: serverTimestamp() })
    ))
    invalidateAll()
  }

  const deleteContacts = async (ids: string[]) => {
    await Promise.all(ids.map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), { deleted_at: serverTimestamp() })
    ))
    invalidateAll()
  }

  const restoreContacts = async (ids: string[]) => {
    await Promise.all(ids.map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), { archived_at: null, deleted_at: null })
    ))
    invalidateAll()
  }

  const rankingSystems = team?.ranking_systems ?? []

  const bulkSetRank = async (systemId: string, value: number | null) => {
    const fieldKey = `ranks.${systemId}`
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        [fieldKey]: value !== null ? value : deleteField(),
        updatedAt: serverTimestamp(),
      })
    ))
    invalidateContacts()
  }

  const bulkSetSubscription = async (type: SubscriptionType | null) => {
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        subscription_type_id: type?.id ?? null,
        subscription_type_name: type?.name ?? null,
        updatedAt: serverTimestamp(),
      })
    ))
    invalidateContacts()
  }

  const bulkSetContactType = async (contactType: ContactType) => {
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        type: contactType,
        updatedAt: serverTimestamp(),
      })
    ))
    invalidateContacts()
  }

  // ── select all ────────────────────────────────────────────────────────────

  const allSelected = currentList.length > 0 && (currentList as Contact[]).every((c) => selected.has(c.id))
  const someSelected = !allSelected && (currentList as Contact[]).some((c) => selected.has(c.id))
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set((currentList as Contact[]).map((c) => c.id)))
    }
  }

  // ── tabs ──────────────────────────────────────────────────────────────────

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: 'active',   label: t('tabActive'),   count: active.length },
    { id: 'archived', label: t('tabArchived'),  count: archived.length },
    { id: 'deleted',  label: t('tabDeleted'),   count: deleted.length },
    { id: 'requests', label: t('tabRequests'),  count: requests.length },
  ]

  const selectable = tab === 'active' || tab === 'archived' || tab === 'deleted'
  const selectedList = [...selected]

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!loadingActive && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', {
                total: active.length + archived.length,
                active: active.filter((c) => c.membership_status === 'active').length,
              })}
            </p>
          )}
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          {t('addContact')}
        </button>
      </div>

      {/* Overview charts */}
      {tab === 'active' && (
        <OverviewPanel
          contacts={active}
          loading={loadingActive}
          rankingSystems={team?.ranking_systems}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filters (active tab only) */}
      {tab === 'active' && <FilterPanel filters={filters} onChange={setFilters} subscriptionTypes={subscriptionTypes} />}

      {/* Tabs */}
      <div className="flex gap-0.5 border-b overflow-x-auto">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => { setTab(tb.id); setSelected(new Set()) }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tb.label}
            {tb.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                tab === tb.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>{tb.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Requests tab body */}
      {tab === 'requests' && currentTeamId && <RequestsTab teamId={currentTeamId} />}

      {/* Main list */}
      {tab !== 'requests' && (
        <div className="rounded-xl border overflow-hidden bg-card">
          {/* Select-all header */}
          {!isLoading && currentList.length > 0 && selectable && (
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <span className="text-xs text-muted-foreground">
                {selected.size > 0 ? t('selectAllCount', { count: selected.size, total: currentList.length }) : t('selectAll')}
              </span>
              <label className="cursor-pointer pr-0.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-border"
                />
              </label>
            </div>
          )}

          {isLoading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}

          {!isLoading && currentList.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              {search || filters.types.length || filters.statuses.length ? t('emptySearch') : t('empty')}
            </div>
          )}

          {!isLoading && tab !== 'deleted' && (currentList as Contact[]).map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              selectable={selectable}
              selected={selected.has(c.id)}
              onSelect={toggleSelect}
              rankingSystems={rankingSystems}
            />
          ))}

          {!isLoading && tab === 'deleted' && (currentList as Contact[]).map((c) => (
            <DeletedRow
              key={c.id}
              contact={c}
              selected={selected.has(c.id)}
              onSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* Mobile FAB */}
      {selected.size === 0 && (
        <button
          onClick={() => setDialogOpen(true)}
          className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
          aria-label={t('addContact')}
        >
          <UserPlus className="h-6 w-6" />
        </button>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          tab={tab}
          onArchive={tab === 'active' ? () => setConfirmArchive(selectedList) : undefined}
          onRestore={tab === 'archived' || tab === 'deleted' ? () => setConfirmRestore(selectedList) : undefined}
          onDelete={tab !== 'deleted' ? () => setConfirmDelete(selectedList) : undefined}
          onClear={() => setSelected(new Set())}
          editActions={tab !== 'deleted' ? [
            ...(rankingSystems.length > 0 ? [{ label: t('bulkSetRank'), icon: Award, onClick: () => setBulkEditMode('rank') }] : []),
            { label: t('bulkSetSubscription'), icon: CreditCard, onClick: () => setBulkEditMode('subscription') },
            { label: t('bulkSetType'), icon: Tag, onClick: () => setBulkEditMode('type') },
          ] : []}
          moreActions={tab === 'active' && isAtLeast('club') ? [
            { label: t('bulkMove'),     icon: ArrowRightLeft, onClick: () => {}, disabled: true },
            { label: t('bulkOutreach'), icon: Mail,           onClick: () => {}, disabled: true },
          ] : []}
        />
      )}

      {/* Dialogs */}
      {currentTeamId && user && (
        <CreateContactDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          teamId={currentTeamId}
          userId={user.uid}
          onSaved={invalidateAll}
        />
      )}

      <ConfirmDialog
        open={confirmArchive.length > 0}
        onOpenChange={(v) => { if (!v) setConfirmArchive([]) }}
        title={t('archiveContactTitle')}
        desc={t('archiveContactDesc', { name: `${confirmArchive.length} contacts` })}
        confirmLabel={t('bulkArchive')}
        onConfirm={() => archiveContacts(confirmArchive)}
      />

      <ConfirmDialog
        open={confirmDelete.length > 0}
        onOpenChange={(v) => { if (!v) setConfirmDelete([]) }}
        title={t('deleteContactTitle')}
        desc={t('deleteContactDesc', { name: `${confirmDelete.length} contacts` })}
        confirmLabel={t('bulkDelete')}
        destructive
        onConfirm={() => deleteContacts(confirmDelete)}
      />

      <ConfirmDialog
        open={confirmRestore.length > 0}
        onOpenChange={(v) => { if (!v) setConfirmRestore([]) }}
        title={t('restoreContactTitle')}
        desc={t('restoreContactDesc', { name: `${confirmRestore.length} contacts` })}
        confirmLabel={t('bulkRestore')}
        onConfirm={() => restoreContacts(confirmRestore)}
      />

      <BulkSetRankDialog
        open={bulkEditMode === 'rank'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        rankingSystems={rankingSystems}
        count={selected.size}
        onConfirm={bulkSetRank}
      />

      <BulkSetSubscriptionDialog
        open={bulkEditMode === 'subscription'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        subscriptionTypes={subscriptionTypes}
        count={selected.size}
        onConfirm={bulkSetSubscription}
      />

      <BulkSetTypeDialog
        open={bulkEditMode === 'type'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        count={selected.size}
        onConfirm={bulkSetContactType}
      />
    </div>
  )
}
