'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, getDocs, query, where, doc, updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useOrg } from '@/contexts/OrgContext'
import {
  ORGANIZATIONS_COLLECTION, ORG_TEAMS_SUBCOLLECTION,
  CONTACTS_COLLECTION, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION,
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
import { Search } from 'lucide-react'

// ─── colour map ───────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, string> = {
  gray:   'bg-gray-100   text-gray-700   dark:bg-gray-800   dark:text-gray-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  blue:   'bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  green:  'bg-green-100  text-green-700  dark:bg-green-900  dark:text-green-300',
  red:    'bg-red-100    text-red-700    dark:bg-red-900    dark:text-red-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
}

// ─── types ────────────────────────────────────────────────────────────────────

interface TeamMeta { id: string; name: string }
interface ContactRow extends Contact { teamName?: string }

// ─── data hooks ───────────────────────────────────────────────────────────────

function useOrgTeamIds(orgId: string) {
  return useQuery<TeamMeta[]>({
    queryKey: ['org-teams-meta', orgId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_TEAMS_SUBCOLLECTION),
          where('status', '==', 'active'),
        ),
      )
      const rows = snap.docs.map((d) => ({ id: d.data().teamId as string, name: '' }))
      await Promise.all(
        rows.map(async (row) => {
          const teamSnap = await getDocs(query(collection(db, 'teams'), where('__name__', '==', row.id)))
          if (!teamSnap.empty) row.name = teamSnap.docs[0].data().name ?? row.id
        }),
      )
      return rows
    },
    staleTime: 5 * 60_000,
  })
}

function useOrgContacts(teams: TeamMeta[] | undefined) {
  const teamIds = teams?.map((t) => t.id) ?? []
  return useQuery<ContactRow[]>({
    queryKey: ['org-contacts', teamIds],
    enabled: teamIds.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const teamNameById = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]))
      const results: ContactRow[] = []
      // Firestore `in` supports up to 30 values; chunk if needed
      const chunks: string[][] = []
      for (let i = 0; i < teamIds.length; i += 30) chunks.push(teamIds.slice(i, i + 30))
      await Promise.all(
        chunks.map(async (chunk) => {
          const snap = await getDocs(
            query(
              collection(db, CONTACTS_COLLECTION),
              where('teamId', 'in', chunk),
              where('deleted_at', '==', null),
            ),
          )
          snap.docs.forEach((d) => {
            const data = { ...d.data(), id: d.id } as ContactRow
            data.teamName = teamNameById[data.teamId] ?? data.teamId
            results.push(data)
          })
        }),
      )
      return results.sort((a, b) =>
        `${a.lastname ?? ''} ${a.firstname ?? ''}`.localeCompare(`${b.lastname ?? ''} ${b.firstname ?? ''}`),
      )
    },
  })
}

function useStatusDefs(orgId: string) {
  return useQuery<OrgMembershipStatusDef[]>({
    queryKey: ['org-membership-statuses', orgId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_MEMBERSHIP_STATUSES_SUBCOLLECTION),
      )
      if (snap.empty) return DEFAULT_ORG_MEMBERSHIP_STATUSES
      const defs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as OrgMembershipStatusDef))
      // Merge: Firestore overrides defaults by id; append any extras
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

// ─── expiration dialog (shown when setting an "active" status) ────────────────

function ExpirationDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: (date: Date | null) => void
  onCancel: () => void
}) {
  const t = useTranslations('OrgMemberships')
  const [value, setValue] = useState('')

  function handleConfirm() {
    onConfirm(value ? new Date(value) : null)
    setValue('')
  }
  function handleCancel() {
    setValue('')
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('expirationDialogTitle')}</DialogTitle>
          <DialogDescription>{t('expirationDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="exp-date">{t('expirationLabel')}</Label>
          <Input
            id="exp-date"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
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
  isAdmin,
  orgId,
  onUpdated,
}: {
  contact: ContactRow
  defs: OrgMembershipStatusDef[]
  isAdmin: boolean
  orgId: string
  onUpdated: () => void
}) {
  const t = useTranslations('OrgMemberships')
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

  function handleExpiryConfirm(date: Date | null) {
    setShowExpiry(false)
    if (pending) applyStatus(pending, date)
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
        <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">
          {contact.teamName ?? '—'}
        </td>
        <td className="px-4 py-3">
          {isAdmin ? (
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
        <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
          {formatExpiry(contact.org_membership_expiration as { toDate(): Date } | null | undefined, t('noExpiration'))}
        </td>
      </tr>
      <ExpirationDialog
        open={showExpiry}
        onConfirm={handleExpiryConfirm}
        onCancel={() => { setShowExpiry(false); setPending(null) }}
      />
    </>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function OrgMembershipsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgMemberships')
  const { isAdmin, membershipTerm } = useOrg()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('__all__')

  const { data: teams, isLoading: teamsLoading } = useOrgTeamIds(orgId)
  const { data: contacts, isLoading: contactsLoading } = useOrgContacts(teams)
  const { data: rawDefs } = useStatusDefs(orgId)

  const defs: OrgMembershipStatusDef[] = rawDefs ?? DEFAULT_ORG_MEMBERSHIP_STATUSES
  const isLoading = teamsLoading || contactsLoading

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

  // Counts per status for filter pills
  const countsByStatus = useMemo(() => {
    const map: Record<string, number> = {}
    contacts?.forEach((c) => {
      const s = c.org_membership_status ?? 'guest'
      map[s] = (map[s] ?? 0) + 1
    })
    return map
  }, [contacts])

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['org-contacts'] })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{membershipTerm}</h2>
          {contacts && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', { total: contacts.length, active: totalActive })}
            </p>
          )}
        </div>
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
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">{t('noContacts')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colName')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">{t('colTeam')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3">{t('colStatus')}</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">{t('colExpires')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  defs={defs}
                  isAdmin={isAdmin}
                  orgId={orgId}
                  onUpdated={invalidate}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
