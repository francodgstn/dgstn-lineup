'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  collection, query, where, orderBy, getDocs, addDoc, updateDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MultiSelect } from '@/components/ui/multi-select'
import {
  CONTACTS_COLLECTION, TEAMS_COLLECTION, CONTACT_REQUESTS_SUBCOLLECTION,
} from '@lineup/shared'
import type { Contact, MembershipStatus, ContactType, ContactRequest } from '@lineup/shared'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Search, UserPlus, ChevronRight, Filter, X, Flame,
  Star, AlertCircle, ChevronDown, ChevronUp, Archive, Trash2, RotateCcw,
} from 'lucide-react'
import type { Route } from 'next'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary', requested: 'outline', under_review: 'outline',
  almost_ready: 'outline', active: 'default', expired: 'destructive',
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-red-500', 'bg-indigo-500',
]
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function daysUntilAnonymisation(deletedAt: { toDate(): Date } | null | undefined): number | null {
  if (!deletedAt) return null
  const deleted = deletedAt.toDate()
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
        where('teamId', '==', teamId),
        where('deleted_at', '!=', null),
        where('anonymized_at', '==', null),
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
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
        </form>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
            {t('cancel')}
          </button>
          <button onClick={handleSubmit(onSubmit)} disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {isSubmitting ? tCommon('loading') : t('createContact')}
          </button>
        </DialogFooter>
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

// ─── stats panel ──────────────────────────────────────────────────────────────

function StatsPanel({ contacts }: { contacts: Contact[] }) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(false)

  const total = contacts.length
  const active = contacts.filter((c) => c.membership_status === 'active').length
  const trial = contacts.filter((c) => c.type === 'trial').length
  const student = contacts.filter((c) => c.type === 'student').length
  const external = contacts.filter((c) => c.type === 'external').length
  const newCount = contacts.filter((c) => !c.acquisition?.acknowledged).length

  const stats = [
    { label: t('statsTotal'), value: total },
    { label: t('statsActive'), value: active },
    { label: t('statsTrial'), value: trial },
    { label: t('statsStudent'), value: student },
    { label: t('statsExternal'), value: external },
    { label: t('statsNew'), value: newCount },
  ]

  return (
    <div className="rounded-xl border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
      >
        {t('statsTitle')}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t grid grid-cols-3 sm:grid-cols-6 divide-x divide-y sm:divide-y-0">
          {stats.map(({ label, value }) => (
            <div key={label} className="px-4 py-3 text-center">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── filter panel ─────────────────────────────────────────────────────────────

interface Filters { types: string[]; statuses: string[] }
const EMPTY_FILTERS: Filters = { types: [], statuses: [] }

function FilterPanel({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(false)
  const hasFilters = filters.types.length > 0 || filters.statuses.length > 0

  const TYPE_OPTS = (['trial', 'student', 'external'] as ContactType[]).map((v) => ({
    value: v, label: t(`type_${v}`),
  }))
  const STATUS_OPTS = (
    ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired'] as MembershipStatus[]
  ).map((v) => ({ value: v, label: t(`status_${v}`) }))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            hasFilters ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted text-muted-foreground'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {t('filtersLabel')}
          {hasFilters && <span className="text-xs font-bold">{filters.types.length + filters.statuses.length}</span>}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {hasFilters && (
          <button onClick={() => onChange(EMPTY_FILTERS)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />{t('clearFilters')}
          </button>
        )}
      </div>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border bg-muted/30">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterType')}</p>
            <MultiSelect
              options={TYPE_OPTS}
              value={filters.types}
              onChange={(types) => onChange({ ...filters, types })}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('filterStatus')}</p>
            <MultiSelect
              options={STATUS_OPTS}
              value={filters.statuses}
              onChange={(statuses) => onChange({ ...filters, statuses })}
            />
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
}: {
  contact: Contact
  selectable: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  const router = useRouter()
  const t = useTranslations('Contacts')
  const isNew = !contact.acquisition?.acknowledged

  return (
    <div className="flex items-center gap-1 border-b last:border-0">
      {selectable && (
        <label className="pl-3 py-3 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(contact.id)}
            className="h-4 w-4 rounded border-border"
          />
        </label>
      )}
      <button
        onClick={() => router.push(`/contacts/${contact.id}` as Route)}
        className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Avatar */}
        <div className={`h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold relative ${avatarColor(contact.id)}`}>
          {initials(contact)}
          {isNew && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 border-2 border-background" />
          )}
          {(contact.alerts_count ?? 0) > 0 && (
            <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-destructive border-2 border-background flex items-center justify-center">
              <AlertCircle className="h-2.5 w-2.5 text-white" />
            </span>
          )}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {contact.firstname} {contact.lastname}
            {isNew && (
              <span className="ml-2 text-xs font-semibold text-blue-500">{t('newBadge')}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {contact.email ?? contact.phone ?? '—'}
          </p>
        </div>

        {/* Score + streak (desktop) */}
        <div className="hidden md:flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          {(contact.current_month_score ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 text-yellow-500" />
              {contact.current_month_score}
            </span>
          )}
          {(contact.current_streak ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <Flame className="h-3 w-3 text-orange-500" />
              {contact.current_streak}w
            </span>
          )}
        </div>

        {/* Status + type chips (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {contact.type && (
            <Badge variant="outline" className="text-xs">{t(`type_${contact.type}`)}</Badge>
          )}
          {contact.membership_status && (
            <Badge variant={STATUS_VARIANT[contact.membership_status]} className="text-xs">
              {t(`status_${contact.membership_status}`)}
            </Badge>
          )}
        </div>

        {/* Mobile: status only */}
        <div className="flex sm:hidden shrink-0">
          {contact.membership_status && (
            <Badge variant={STATUS_VARIANT[contact.membership_status]} className="text-xs">
              {t(`status_${contact.membership_status}`)}
            </Badge>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
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
      <div className={`h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold ${avatarColor(contact.id)}`}>
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

// ─── bulk action bar ──────────────────────────────────────────────────────────

function BulkBar({
  count, tab, onArchive, onDelete, onRestore, onClear,
}: {
  count: number; tab: TabId
  onArchive?: () => void; onDelete?: () => void; onRestore?: () => void; onClear: () => void
}) {
  const t = useTranslations('Contacts')
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border rounded-full shadow-lg px-4 py-2">
      <span className="text-sm font-medium mr-2">{t('bulkSelected', { count })}</span>
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
      <button onClick={onClear}
        className="p-1.5 rounded-full hover:bg-muted transition-colors ml-1 text-muted-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── tab types ────────────────────────────────────────────────────────────────

type TabId = 'active' | 'archived' | 'deleted' | 'requests'

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId, user } = useAuth()
  const qc = useQueryClient()
  const t = useTranslations('Contacts')

  const { data: active = [], isLoading: loadingActive } = useActiveContacts(currentTeamId)
  const { data: archived = [], isLoading: loadingArchived } = useArchivedContacts(currentTeamId)
  const { data: deleted = [], isLoading: loadingDeleted } = useDeletedContacts(currentTeamId)
  const { data: requests = [] } = useContactRequests(currentTeamId)

  const [tab, setTab] = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)

  // confirm dialogs
  const [confirmArchive, setConfirmArchive] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string[]>([])
  const [confirmRestore, setConfirmRestore] = useState<string[]>([])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] })
    setSelected(new Set())
  }

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

      {/* Stats */}
      {tab === 'active' && <StatsPanel contacts={active} />}

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
      {tab === 'active' && <FilterPanel filters={filters} onChange={setFilters} />}

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
    </div>
  )
}
