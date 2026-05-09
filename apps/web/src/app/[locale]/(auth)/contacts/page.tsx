'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CONTACTS_COLLECTION } from '@lineup/shared'
import type { Contact, MembershipStatus, ContactType } from '@lineup/shared'
import { Pencil, Search, UserPlus } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary',
  requested: 'outline',
  under_review: 'outline',
  almost_ready: 'outline',
  active: 'default',
  expired: 'destructive',
}

// ─── schema ───────────────────────────────────────────────────────────────────

const contactSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['lead', 'prospect', 'customer']).optional(),
  membership_status: z.enum(['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']).optional(),
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

// ─── contact dialog ───────────────────────────────────────────────────────────

function ContactDialog({
  open,
  onOpenChange,
  editing,
  teamId,
  userId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: Contact | null
  teamId: string
  userId: string
  onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      firstname: editing?.firstname ?? '',
      lastname: editing?.lastname ?? '',
      email: editing?.email ?? '',
      phone: editing?.phone ?? '',
      type: editing?.type ?? undefined,
      membership_status: editing?.membership_status ?? undefined,
      notes: editing?.notes ?? '',
    },
  })

  const onSubmit = async (values: ContactFormValues) => {
    const payload: Record<string, unknown> = {
      teamId,
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      type: values.type || null,
      membership_status: values.membership_status || 'guest',
      notes: values.notes || null,
    }

    if (editing) {
      await updateDoc(doc(db, CONTACTS_COLLECTION, editing.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
    } else {
      await addDoc(collection(db, CONTACTS_COLLECTION), {
        ...payload,
        createdBy: userId,
        created_at: serverTimestamp(),
        deleted_at: null,
        archived_at: null,
      })
    }

    onSaved()
    onOpenChange(false)
  }

  const TYPES: ContactType[] = ['lead', 'prospect', 'customer']
  const STATUSES: MembershipStatus[] = ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('editContact') : t('addContact')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldFirstname')}</label>
              <input
                type="text"
                {...register('firstname')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.firstname && <p className="text-xs text-destructive">{errors.firstname.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldLastname')}</label>
              <input
                type="text"
                {...register('lastname')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.lastname && <p className="text-xs text-destructive">{errors.lastname.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('colEmail')}</label>
              <input
                type="email"
                {...register('email')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('fieldPhone')}</label>
              <input
                type="tel"
                {...register('phone')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('colType')}</label>
              <select
                {...register('type')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">—</option>
                {TYPES.map((v) => (
                  <option key={v} value={v}>{t(`type_${v}`)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('colStatus')}</label>
              <select
                {...register('membership_status')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">—</option>
                {STATUSES.map((v) => (
                  <option key={v} value={v}>{t(`status_${v}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t('fieldNotes')}</label>
            <textarea
              {...register('notes')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? tCommon('loading') : editing ? t('saveChanges') : t('createContact')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId, user } = useAuth()
  const { data: contacts = [], isLoading } = useContacts(currentTeamId)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const t = useTranslations('Contacts')
  const qc = useQueryClient()

  const statusLabel: Record<MembershipStatus, string> = {
    guest: t('statusGuest'),
    requested: t('statusRequested'),
    under_review: t('statusUnderReview'),
    almost_ready: t('statusAlmostReady'),
    active: t('statusActive'),
    expired: t('statusExpired'),
  }

  const filtered = search.trim()
    ? contacts.filter((c) => {
        const q = search.toLowerCase()
        return (
          `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q)
        )
      })
    : contacts

  const active = contacts.filter((c) => c.membership_status === 'active').length
  const total = contacts.length

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contacts'] })

  const handleNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (c: Contact) => {
    setEditing(c)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { total, active })}
            </p>
          )}
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          {t('addContact')}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colName')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colEmail')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colStatus')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colType')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">{t('colLastSession')}</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-12" />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-36" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3" />
                </tr>
              ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {search ? t('emptySearch') : t('empty')}
                </td>
              </tr>
            )}

            {!isLoading &&
              filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    {c.firstname} {c.lastname}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {c.membership_status ? (
                      <Badge variant={STATUS_VARIANT[c.membership_status]}>
                        {statusLabel[c.membership_status]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.type ? (
                      <Badge variant="outline">{t(`type_${c.type}`)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(c.last_session_at)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleEdit(c)}
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {currentTeamId && user && (
        <ContactDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
          teamId={currentTeamId}
          userId={user.uid}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
