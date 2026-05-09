'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CONTACTS_COLLECTION } from '@lineup/shared'
import type { Contact, MembershipStatus, ContactType } from '@lineup/shared'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Search, UserPlus, ChevronRight } from 'lucide-react'
import type { Route } from 'next'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary',
  requested: 'outline',
  under_review: 'outline',
  almost_ready: 'outline',
  active: 'default',
  expired: 'destructive',
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

// ─── schema ───────────────────────────────────────────────────────────────────

const contactSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['lead', 'prospect', 'customer']).optional(),
  notes: z.string().max(2000).optional(),
})
type ContactFormValues = z.infer<typeof contactSchema>

// ─── data hook ────────────────────────────────────────────────────────────────

function useContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        orderBy('lastname'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact)
    },
  })
}

// ─── create dialog ────────────────────────────────────────────────────────────

function CreateContactDialog({
  open,
  onOpenChange,
  teamId,
  userId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  userId: string
  onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
  })

  const onSubmit = async (values: ContactFormValues) => {
    await addDoc(collection(db, CONTACTS_COLLECTION), {
      teamId,
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      type: values.type || 'lead',
      membership_status: 'guest',
      notes: values.notes || null,
      createdBy: userId,
      created_at: serverTimestamp(),
      deleted_at: null,
      archived_at: null,
    })
    reset()
    onSaved()
    onOpenChange(false)
  }

  const TYPES: ContactType[] = ['lead', 'prospect', 'customer']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addContact')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldFirstname')} *</label>
              <input type="text" {...register('firstname')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              {errors.firstname && <p className="text-xs text-destructive">{errors.firstname.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldLastname')} *</label>
              <input type="text" {...register('lastname')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              {errors.lastname && <p className="text-xs text-destructive">{errors.lastname.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('colEmail')}</label>
              <input type="email" {...register('email')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldPhone')}</label>
              <input type="tel" {...register('phone')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('colType')}</label>
            <select {...register('type')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {TYPES.map((v) => <option key={v} value={v}>{t(`type_${v}`)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldNotes')}</label>
            <textarea {...register('notes')} rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isSubmitting ? tCommon('loading') : t('createContact')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── contact row ──────────────────────────────────────────────────────────────

function ContactRow({ contact }: { contact: Contact }) {
  const router = useRouter()
  const t = useTranslations('Contacts')

  return (
    <button
      onClick={() => router.push(`/contacts/${contact.id}` as Route)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left border-b last:border-0"
    >
      {/* Avatar */}
      <div className={`h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold ${avatarColor(contact.id)}`}>
        {initials(contact)}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {contact.firstname} {contact.lastname}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {contact.email ?? contact.phone ?? '—'}
        </p>
      </div>

      {/* Status + type chips */}
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
  )
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type TabId = 'active' | 'requests' | 'all'

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId, user } = useAuth()
  const { data: contacts = [], isLoading } = useContacts(currentTeamId)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const t = useTranslations('Contacts')
  const qc = useQueryClient()

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contacts'] })

  const tabFiltered = useMemo(() => {
    if (tab === 'active') return contacts.filter((c) => c.membership_status === 'active')
    if (tab === 'requests') return contacts.filter((c) => c.membership_status === 'requested' || c.membership_status === 'under_review')
    return contacts
  }, [contacts, tab])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tabFiltered
    return tabFiltered.filter((c) =>
      `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
  }, [tabFiltered, search])

  const activeCount = contacts.filter((c) => c.membership_status === 'active').length
  const requestCount = contacts.filter(
    (c) => c.membership_status === 'requested' || c.membership_status === 'under_review'
  ).length

  const TABS: { id: TabId; label: string; count?: number }[] = [
    { id: 'all',      label: t('tabAll'),      count: contacts.length },
    { id: 'active',   label: t('tabActive'),   count: activeCount },
    { id: 'requests', label: t('tabRequests'), count: requestCount },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { total: contacts.length, active: activeCount })}
            </p>
          )}
        </div>
        {/* Desktop add button */}
        <button
          onClick={() => setDialogOpen(true)}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          {t('addContact')}
        </button>
      </div>

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

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tb.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tb.label}
            {tb.count !== undefined && tb.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                tab === tb.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {tb.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border overflow-hidden bg-card">
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}

        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-16 text-center text-muted-foreground text-sm">
            {search ? t('emptySearch') : t('empty')}
          </div>
        )}

        {!isLoading && filtered.map((c) => <ContactRow key={c.id} contact={c} />)}
      </div>

      {/* Mobile FAB */}
      <button
        onClick={() => setDialogOpen(true)}
        className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
        aria-label={t('addContact')}
      >
        <UserPlus className="h-6 w-6" />
      </button>

      {currentTeamId && user && (
        <CreateContactDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          teamId={currentTeamId}
          userId={user.uid}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
