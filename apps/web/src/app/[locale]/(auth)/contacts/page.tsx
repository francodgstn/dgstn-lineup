'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CONTACTS_COLLECTION } from '@lineup/shared'
import type { Contact, MembershipStatus } from '@lineup/shared'
import { Search, UserPlus } from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fullName(c: Contact) {
  return `${c.firstname} ${c.lastname}`
}

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

// ─── data hook ───────────────────────────────────────────────────────────────

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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId } = useAuth()
  const { data: contacts = [], isLoading } = useContacts(currentTeamId)
  const [search, setSearch] = useState('')
  const t = useTranslations('Contacts')

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
          fullName(c).toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q)
        )
      })
    : contacts

  const active = contacts.filter((c) => c.membership_status === 'active').length
  const total = contacts.length

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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          disabled
          title={useTranslations('Common')('comingSoon')}
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
                </tr>
              ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
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
                      <Badge variant="outline" className="capitalize">{c.type}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(c.last_session_at)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
