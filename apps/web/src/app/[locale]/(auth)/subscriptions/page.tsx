'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  collection, query, where, orderBy, getDocs,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import { Link } from '@/i18n/navigation'
import { CONTACTS_COLLECTION } from '@linyup/shared'
import type { Contact } from '@linyup/shared'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import type { Route } from 'next'

// ─── data ─────────────────────────────────────────────────────────────────────

// Reuses the same queryKey as the contacts page — zero extra reads if cached.
function useContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null),
          orderBy('lastname', 'asc'),
        ),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Contact))
    },
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function contactName(c: Contact) {
  return [c.firstname, c.lastname].filter(Boolean).join(' ') || '—'
}

function formatDate(ts: unknown): string {
  if (!ts) return ''
  const obj = ts as { toDate?: () => Date; seconds?: number }
  const d = typeof obj.toDate === 'function' ? obj.toDate() : new Date((obj.seconds ?? 0) * 1000)
  return d.toLocaleDateString([], { month: 'short', year: 'numeric' })
}

type FilterKey = '__all__' | '__active__' | '__none__' | string // string = subscription_type_id

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SubscriptionsOverviewPage() {
  const t = useTranslations('SubscriptionsOverview')
  const { currentTeamId } = useAuth()
  const { data: contacts = [], isLoading } = useContacts(currentTeamId)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('__all__')

  // Build unique subscription types present in the team
  const subscriptionTypes = useMemo(() => {
    const map = new Map<string, string>() // id → name
    contacts.forEach((c) => {
      if (c.subscription_type_id && c.subscription_type_name) {
        map.set(c.subscription_type_id, c.subscription_type_name)
      }
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [contacts])

  // Stats
  const activeCount = useMemo(
    () => contacts.filter((c) => !!c.subscription_type_id).length,
    [contacts],
  )
  const noneCount = contacts.length - activeCount

  // Filtered list
  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      // Filter by subscription
      if (filter === '__active__' && !c.subscription_type_id) return false
      if (filter === '__none__' && c.subscription_type_id) return false
      if (filter !== '__all__' && filter !== '__active__' && filter !== '__none__') {
        if (c.subscription_type_id !== filter) return false
      }
      // Filter by name search
      if (search) {
        const name = contactName(c).toLowerCase()
        if (!name.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [contacts, filter, search])

  const pills: { key: FilterKey; label: string; count: number }[] = [
    { key: '__all__',    label: t('filterAll'),    count: contacts.length },
    { key: '__active__', label: t('filterActive'), count: activeCount },
    { key: '__none__',   label: t('filterNone'),   count: noneCount },
    ...subscriptionTypes.map((st) => ({
      key: st.id as FilterKey,
      label: st.name,
      count: contacts.filter((c) => c.subscription_type_id === st.id).length,
    })),
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        {!isLoading && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('subtitle', { total: contacts.length, active: activeCount, none: noneCount })}
          </p>
        )}
      </div>

      {/* Filter pills */}
      {!isLoading && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === p.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label} ({p.count})
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-9 text-sm"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">{t('noContacts')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colName')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colSubscription')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">{t('colRecurrence')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">{t('colSince')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const hasSub = !!c.subscription_type_id
                const subLabel = c.subscription_type_name ?? c.subscription_type_id ?? null
                return (
                  <Link key={c.id} href={`/contacts/${c.id}` as Route} className="contents">
                    <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="font-medium text-sm">{contactName(c)}</div>
                        {c.email && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{c.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {subLabel ? (
                          <Badge variant="secondary" className="font-normal">{subLabel}</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t('noSubscription')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
                        {c.subscription_recurrence || (hasSub ? t('ongoing') : '—')}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                        {formatDate(c.subscription_type_updated_at) || '—'}
                      </td>
                    </tr>
                  </Link>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
