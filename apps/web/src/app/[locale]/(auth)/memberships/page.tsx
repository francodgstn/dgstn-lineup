'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, query, where, doc, updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { useMembershipTerm } from '@/hooks/useMembershipTerm'
import { useAuth } from '@/contexts/AuthContext'
import {
  CONTACTS_COLLECTION, ORGANIZATIONS_COLLECTION, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION,
  DEFAULT_ORG_MEMBERSHIP_STATUSES,
} from '@linyup/shared'
import type { Contact, OrgMembershipStatusDef } from '@linyup/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Search, IdCard } from 'lucide-react'

// ─── colour map (shared with org page) ────────────────────────────────────────

const COLOR_CLASSES: Record<string, string> = {
  gray:   'bg-gray-100   text-gray-700   dark:bg-gray-800   dark:text-gray-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  blue:   'bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  green:  'bg-green-100  text-green-700  dark:bg-green-900  dark:text-green-300',
  red:    'bg-red-100    text-red-700    dark:bg-red-900    dark:text-red-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useTeamContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['team-contacts-membership', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null),
        ),
      )
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as Contact))
        .sort((a, b) =>
          `${a.lastname ?? ''} ${a.firstname ?? ''}`.localeCompare(`${b.lastname ?? ''} ${b.firstname ?? ''}`),
        )
    },
  })
}

function useStatusDefs(orgId: string | null | undefined) {
  return useQuery<OrgMembershipStatusDef[]>({
    queryKey: ['org-membership-statuses', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!orgId) return DEFAULT_ORG_MEMBERSHIP_STATUSES
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION),
      )
      if (snap.empty) return DEFAULT_ORG_MEMBERSHIP_STATUSES
      const defs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as OrgMembershipStatusDef))
      const byId = Object.fromEntries(DEFAULT_ORG_MEMBERSHIP_STATUSES.map((s) => [s.id, s]))
      defs.forEach((d) => { byId[d.id] = d })
      return Object.values(byId).sort((a, b) => a.order - b.order)
    },
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatExpiry(ts: { toDate(): Date } | null | undefined, fallback: string) {
  if (!ts) return fallback
  return ts.toDate().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function contactName(c: Contact) {
  return [c.firstname, c.lastname].filter(Boolean).join(' ') || '—'
}

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ statusId, defs }: { statusId: string; defs: OrgMembershipStatusDef[] }) {
  const def = defs.find((s) => s.id === statusId) ?? defs.find((s) => s.id === 'guest')
  if (!def) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${COLOR_CLASSES[def.color] ?? COLOR_CLASSES.gray}`}>
      {def.label}
    </span>
  )
}

// ─── expiration dialog ────────────────────────────────────────────────────────

function ExpirationDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: (date: Date | null) => void
  onCancel: () => void
}) {
  const t = useTranslations('TeamMemberships')
  const [value, setValue] = useState('')

  function handleConfirm() { onConfirm(value ? new Date(value) : null); setValue('') }
  function handleCancel() { setValue(''); onCancel() }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('expirationDialogTitle')}</DialogTitle>
          <DialogDescription>{t('expirationDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="tm-exp-date">{t('expirationLabel')}</Label>
          <Input id="tm-exp-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>{t('cancel')}</Button>
          <Button onClick={handleConfirm}>{t('expirationSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── contact row ──────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  defs,
  canEdit,
  onUpdated,
}: {
  contact: Contact
  defs: OrgMembershipStatusDef[]
  canEdit: boolean
  onUpdated: () => void
}) {
  const t = useTranslations('TeamMemberships')
  const currentStatus = contact.org_membership_status ?? 'guest'
  const [pending, setPending] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showExpiry, setShowExpiry] = useState(false)

  async function applyStatus(statusId: string, expiry: Date | null) {
    const def = defs.find((s) => s.id === statusId)
    if (!def) return
    setSaving(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        org_membership_status: statusId,
        org_membership_active: def.countsAsActive,
        org_membership_expiration: expiry ? Timestamp.fromDate(expiry) : null,
        updated_at: serverTimestamp(),
      })
      onUpdated()
    } finally {
      setSaving(false)
      setPending(null)
    }
  }

  function handleStatusChange(statusId: string | null) {
    if (!statusId) return
    const def = defs.find((s) => s.id === statusId)
    if (!def) return
    if (def.countsAsActive) {
      setPending(statusId)
      setShowExpiry(true)
    } else {
      applyStatus(statusId, null)
    }
  }

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3">
          <div className="font-medium text-sm">{contactName(contact)}</div>
          {contact.email && (
            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{contact.email}</div>
          )}
        </td>
        <td className="px-4 py-3">
          {canEdit ? (
            <Select value={currentStatus} onValueChange={handleStatusChange} disabled={saving}>
              <SelectTrigger className="h-7 w-[160px] text-xs border-0 bg-transparent p-0 shadow-none focus:ring-0 hover:bg-muted rounded px-2">
                <SelectValue>
                  <StatusBadge statusId={currentStatus} defs={defs} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {defs.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${COLOR_CLASSES[s.color]?.split(' ')[0] ?? ''}`} />
                      <span>{s.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge statusId={currentStatus} defs={defs} />
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
          {formatExpiry(contact.org_membership_expiration as { toDate(): Date } | null | undefined, t('noExpiration'))}
        </td>
      </tr>
      <ExpirationDialog
        open={showExpiry}
        onConfirm={(date) => { setShowExpiry(false); if (pending) applyStatus(pending, date) }}
        onCancel={() => { setShowExpiry(false); setPending(null) }}
      />
    </>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamMembershipsPage() {
  const t = useTranslations('TeamMemberships')
  const { currentTeamId, team, teamRole } = useAuth()
  const membershipTerm = useMembershipTerm()
  const qc = useQueryClient()

  const orgId = team?.org_id
  const canEdit = teamRole === 'owner' || teamRole === 'manager'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('__all__')

  const { data: contacts, isLoading: contactsLoading } = useTeamContacts(currentTeamId)
  const { data: rawDefs, isLoading: defsLoading } = useStatusDefs(orgId)

  const defs: OrgMembershipStatusDef[] = rawDefs ?? DEFAULT_ORG_MEMBERSHIP_STATUSES
  const isLoading = contactsLoading || defsLoading

  const filtered = useMemo(() => {
    if (!contacts) return []
    return contacts.filter((c) => {
      const status = c.org_membership_status ?? 'guest'
      if (statusFilter !== '__all__' && status !== statusFilter) return false
      if (search) {
        const name = contactName(c).toLowerCase()
        if (!name.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [contacts, statusFilter, search])

  const totalActive = useMemo(
    () => contacts?.filter((c) => c.org_membership_active).length ?? 0,
    [contacts],
  )

  const countsByStatus = useMemo(() => {
    const map: Record<string, number> = {}
    contacts?.forEach((c) => {
      const s = c.org_membership_status ?? 'guest'
      map[s] = (map[s] ?? 0) + 1
    })
    return map
  }, [contacts])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <IdCard className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t('noOrg')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{membershipTerm}</h1>
        {contacts && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('subtitle', { total: contacts.length, active: totalActive })}
          </p>
        )}
      </div>

      {/* Status filter pills */}
      {!isLoading && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatusFilter('__all__')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === '__all__'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('filterAll')} {contacts ? `(${contacts.length})` : ''}
          </button>
          {defs.map((s) => {
            const count = countsByStatus[s.id] ?? 0
            if (count === 0) return null
            return (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label} ({count})
              </button>
            )
          })}
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
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colStatus')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">{t('colExpires')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  defs={defs}
                  canEdit={canEdit}
                  onUpdated={() => qc.invalidateQueries({ queryKey: ['team-contacts-membership', currentTeamId] })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
