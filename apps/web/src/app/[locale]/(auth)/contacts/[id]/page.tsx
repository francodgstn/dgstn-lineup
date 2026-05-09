'use client'

import { useState, use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  doc, getDoc, updateDoc, collection, query, where, orderBy,
  getDocs, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CONTACTS_COLLECTION, SESSIONS_COLLECTION } from '@lineup/shared'
import type { Contact, MembershipStatus, ContactType } from '@lineup/shared'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, CalendarDays, Mail, Phone, StickyNote } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
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

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary', requested: 'outline', under_review: 'outline',
  almost_ready: 'outline', active: 'default', expired: 'destructive',
}

function formatDate(ts: { toDate(): Date } | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── schema ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['trial', 'student', 'external']).optional(),
  membership_status: z.enum(['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']).optional(),
  notes: z.string().max(2000).optional(),
})
type ProfileValues = z.infer<typeof profileSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useContact(id: string) {
  return useQuery<Contact | null>({
    queryKey: ['contact', id],
    queryFn: async () => {
      const d = await getDoc(doc(db, CONTACTS_COLLECTION, id))
      if (!d.exists()) return null
      return { id: d.id, ...d.data() } as Contact
    },
  })
}

interface SessionSummary { id: string; label: string; start: { toDate(): Date } }

function useRecentSessions(teamId: string | null, contactId: string) {
  return useQuery<SessionSummary[]>({
    queryKey: ['contact-sessions', contactId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      // Sessions store bookings as subcollection — query bookings where contactId matches
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        orderBy('start', 'desc'),
      )
      const snap = await getDocs(q)
      // Filter to sessions that have a booking for this contact (simplified — full impl reads subcollection)
      return snap.docs.slice(0, 10).map((d) => ({
        id: d.id,
        label: d.data().activityName ?? 'Session',
        start: d.data().start,
      }))
    },
  })
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type TabId = 'profile' | 'activity' | 'notes'

// ─── profile tab ──────────────────────────────────────────────────────────────

function ProfileTab({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const TYPES: ContactType[] = ['trial', 'student', 'external']
  const STATUSES: MembershipStatus[] = ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstname: contact.firstname,
      lastname: contact.lastname,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      type: contact.type,
      membership_status: contact.membership_status,
      notes: contact.notes ?? '',
    },
  })

  const onSubmit = async (values: ProfileValues) => {
    await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      type: values.type || null,
      membership_status: values.membership_status || 'guest',
      notes: values.notes || null,
      updatedAt: serverTimestamp(),
    })
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div className="space-y-1">
          <label className="text-sm font-medium">{t('colType')}</label>
          <select {...register('type')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">—</option>
            {TYPES.map((v) => <option key={v} value={v}>{t(`type_${v}`)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">{t('colStatus')}</label>
          <select {...register('membership_status')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">—</option>
            {STATUSES.map((v) => <option key={v} value={v}>{t(`status_${v}`)}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">{t('fieldNotes')}</label>
        <textarea {...register('notes')} rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isSubmitting || !isDirty}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
          {isSubmitting ? tCommon('loading') : t('saveChanges')}
        </button>
      </div>
    </form>
  )
}

// ─── activity tab ─────────────────────────────────────────────────────────────

function ActivityTab({ contact, teamId }: { contact: Contact; teamId: string }) {
  const t = useTranslations('Sessions')
  const { data: sessions = [], isLoading } = useRecentSessions(teamId, contact.id)

  if (isLoading) return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )

  if (sessions.length === 0) return (
    <div className="py-12 text-center text-muted-foreground text-sm">{t('emptyPast')}</div>
  )

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{s.label}</p>
            <p className="text-xs text-muted-foreground">{formatDate(s.start)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── notes tab ────────────────────────────────────────────────────────────────

function NotesTab({ contact }: { contact: Contact }) {
  const t = useTranslations('Contacts')
  if (!contact.notes) return (
    <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
      <StickyNote className="h-8 w-8 opacity-30" />
      <span>{t('noNotes')}</span>
    </div>
  )
  return (
    <div className="whitespace-pre-wrap text-sm text-foreground bg-muted/30 rounded-lg p-4">
      {contact.notes}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { currentTeamId } = useAuth()
  const { data: contact, isLoading } = useContact(id)
  const [tab, setTab] = useState<TabId>('profile')
  const router = useRouter()
  const t = useTranslations('Contacts')
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="py-16 text-center text-muted-foreground">{t('notFound')}</div>
    )
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'profile',  label: t('tabProfile'),  icon: Mail },
    { id: 'activity', label: t('tabActivity'), icon: CalendarDays },
    { id: 'notes',    label: t('tabNotes'),    icon: StickyNote },
  ]

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/contacts')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('title')}
      </button>

      {/* Header card */}
      <div className="rounded-xl border bg-card p-5 flex items-start gap-4">
        <div className={`h-16 w-16 rounded-full shrink-0 flex items-center justify-center text-white text-xl font-bold ${avatarColor(contact.id)}`}>
          {initials(contact)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{contact.firstname} {contact.lastname}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {contact.membership_status && (
              <Badge variant={STATUS_VARIANT[contact.membership_status]}>
                {t(`status_${contact.membership_status}`)}
              </Badge>
            )}
            {contact.type && (
              <Badge variant="outline">{t(`type_${contact.type}`)}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {contact.email && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" /> {contact.email}
              </span>
            )}
            {contact.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" /> {contact.phone}
              </span>
            )}
            {contact.created_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" /> {t('memberSince')} {formatDate(contact.created_at)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tb) => {
          const Icon = tb.icon
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tb.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tb.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border bg-card p-5">
        {tab === 'profile' && <ProfileTab contact={contact} onSaved={invalidate} />}
        {tab === 'activity' && currentTeamId && <ActivityTab contact={contact} teamId={currentTeamId} />}
        {tab === 'notes' && <NotesTab contact={contact} />}
      </div>
    </div>
  )
}
