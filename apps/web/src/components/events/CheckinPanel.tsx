'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, query, where, getDocs, updateDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Check, Search, UserCheck, Download, UserPlus } from 'lucide-react'
import {
  CONTACTS_COLLECTION, CHECKINS_COLLECTION, BUILTIN_EVENT_TYPES,
} from '@lineup/shared'
import type { Contact, EventCheckin, RankingSystem, EventType } from '@lineup/shared'
import { GenericCheckinForm } from './forms/GenericCheckinForm'
import { CampCheckinForm } from './forms/CampCheckinForm'
import { ExamCheckinForm } from './forms/ExamCheckinForm'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

interface PluginCheckinFormProps {
  contact: Contact
  eventId: string
  existing?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

function exportCsv(checkins: EventCheckin[], eventTitle: string) {
  const rows: string[][] = [['First name', 'Last name', 'Status', 'Checked in at']]
  for (const c of checkins) {
    const at = c.created_at ? new Date((c.created_at as { toDate(): Date }).toDate()).toLocaleString() : ''
    rows.push([
      c.contact.firstname,
      c.contact.lastname,
      c.is_completed ? 'Confirmed' : 'Pending',
      at,
    ])
  }
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${eventTitle.replace(/[^a-z0-9]/gi, '_')}_checkins.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── form type router ─────────────────────────────────────────────────────────

type FormType = 'generic' | 'camp' | 'exam' | { pluginId: string; eventTypeId: string }

function resolveFormType(eventType: EventType): FormType {
  const plugin = PLUGIN_REGISTRY.find((p) => p.eventType?.id === eventType)
  if (plugin?.eventType?.hasCheckinForm) {
    return { pluginId: plugin.id, eventTypeId: plugin.eventType.id }
  }
  if (eventType === 'camp') return 'camp'
  if (eventType === 'exam') return 'exam'
  return 'generic'
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useContacts(teamId: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
      ))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact)
    },
  })
}

function useCheckins(eventId: string) {
  return useQuery<EventCheckin[]>({
    queryKey: ['event-checkins', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, CHECKINS_COLLECTION),
        where('event.id', '==', eventId),
      ))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EventCheckin)
    },
  })
}

// ─── add checkin dialog (contact picker for un-checked-in contacts) ───────────

function AddCheckinDialog({
  contacts,
  checkinByContact,
  onSelect,
  onClose,
}: {
  contacts: Contact[]
  checkinByContact: Map<string, EventCheckin>
  onSelect: (contact: Contact) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const unchecked = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts
      .filter((c) => !checkinByContact.has(c.id))
      .filter((c) =>
        !q || `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
      )
  }, [contacts, checkinByContact, search])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add checkin</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
          {unchecked.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? 'No contacts match' : 'All contacts are already checked in'}
            </p>
          )}
          {unchecked.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSelect(c); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                {initials(c)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.firstname} {c.lastname}</p>
                {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export function CheckinPanel({
  eventId,
  eventTitle,
  eventType,
  rankingSystems = [],
}: {
  eventId: string
  eventTitle: string
  eventType: EventType
  rankingSystems?: RankingSystem[]
}) {
  const { currentTeamId, user } = useAuth()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data: contacts = [], isLoading: contactsLoading } = useContacts(currentTeamId)
  const { data: checkins = [], isLoading: checkinsLoading } = useCheckins(eventId)

  const checkinByContact = useMemo(
    () => new Map(checkins.map((c) => [c.contact.id, c])),
    [checkins],
  )

  // Contacts list: checked-in contacts first (so managers see progress at a glance),
  // then un-checked-in contacts. Within each group, ordering is by lastname (from query).
  const sortedContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? contacts.filter((c) =>
          `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q),
        )
      : contacts
    const checked = filtered.filter((c) => checkinByContact.has(c.id))
    const unchecked = filtered.filter((c) => !checkinByContact.has(c.id))
    return [...checked, ...unchecked]
  }, [contacts, checkinByContact, search])

  const formType = resolveFormType(eventType)

  const PluginCheckinForm = useMemo((): ComponentType<PluginCheckinFormProps> | null => {
    if (typeof formType === 'object') {
      const { pluginId } = formType
      return dynamic<PluginCheckinFormProps>(
        () => import(`@/plugins/${pluginId}/CheckinForm`).then((m) => ({ default: m.CheckinForm })),
        { ssr: false },
      )
    }
    return null
  }, [formType])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['event-checkins', eventId] })

  async function handleSubmit(data: Record<string, unknown>) {
    if (!selectedContact || !currentTeamId || !user) return
    setBusy(true)
    try {
      const fn = httpsCallable<unknown, { id: string; is_completed: boolean }>(
        functions, 'addEventCheckin',
      )
      await fn({
        eventId,
        contactId: selectedContact.id,
        contact: { firstname: selectedContact.firstname, lastname: selectedContact.lastname },
        checkinData: data,
      })
      await invalidate()
      setSelectedContact(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggleComplete(checkin: EventCheckin) {
    await updateDoc(doc(db, CHECKINS_COLLECTION, checkin.id), {
      is_completed: !checkin.is_completed,
      updated_at: serverTimestamp(),
    })
    invalidate()
  }

  const selectedExisting = selectedContact ? checkinByContact.get(selectedContact.id) : undefined

  const confirmedCount = checkins.filter((c) => c.is_completed).length
  const pendingCount = checkins.length - confirmedCount

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{checkins.length}</strong> checkins
          </span>
          {confirmedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <strong className="text-foreground">{confirmedCount}</strong> confirmed
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              <strong className="text-foreground">{pendingCount}</strong> pending
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(checkins, eventTitle)}
            disabled={checkins.length === 0}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Add checkin
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Contact list — checked-in first, then unchecked */}
      <div className="rounded-xl border overflow-hidden">
        {(contactsLoading || checkinsLoading) && (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))
        )}

        {!contactsLoading && !checkinsLoading && sortedContacts.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">No contacts found</div>
        )}

        {!contactsLoading && !checkinsLoading && sortedContacts.map((contact) => {
          const checkin = checkinByContact.get(contact.id)
          return (
            <div
              key={contact.id}
              className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer group"
              onClick={() => setSelectedContact(contact)}
            >
              {/* Avatar */}
              <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                checkin?.is_completed
                  ? 'bg-green-500 text-white'
                  : checkin
                    ? 'bg-amber-400 text-white'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {checkin ? <UserCheck className="h-4 w-4" /> : initials(contact)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {contact.firstname} {contact.lastname}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {contact.email ?? contact.type ?? '—'}
                </p>
              </div>

              {/* Status + toggle */}
              <div className="shrink-0 flex items-center gap-2">
                {checkin ? (
                  <>
                    {checkin.is_completed ? (
                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-600">Confirmed</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs text-amber-600 border-amber-200 bg-amber-50">Pending</Badge>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleComplete(checkin) }}
                      className={`p-1.5 rounded-full border transition-colors ${
                        checkin.is_completed
                          ? 'bg-green-600 text-white border-green-600'
                          : 'border-border hover:bg-muted'
                      }`}
                      title={checkin.is_completed ? 'Mark pending' : 'Mark confirmed'}
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    Check in →
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add checkin dialog — shows only un-checked-in contacts */}
      {addDialogOpen && (
        <AddCheckinDialog
          contacts={contacts}
          checkinByContact={checkinByContact}
          onSelect={(c) => setSelectedContact(c)}
          onClose={() => setAddDialogOpen(false)}
        />
      )}

      {/* Checkin form sheet */}
      <Sheet open={!!selectedContact} onOpenChange={(o) => { if (!o) setSelectedContact(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="mb-4">
            <SheetTitle>
              {selectedExisting ? 'Update checkin' : 'Add checkin'}
            </SheetTitle>
            {selectedContact && (
              <p className="text-sm text-muted-foreground">
                {selectedContact.firstname} {selectedContact.lastname}
              </p>
            )}
          </SheetHeader>

          {selectedContact && (
            <>
              {formType === 'generic' && (
                <GenericCheckinForm
                  contact={selectedContact}
                  existing={selectedExisting?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSelectedContact(null)}
                  busy={busy}
                />
              )}
              {formType === 'camp' && (
                <CampCheckinForm
                  contact={selectedContact}
                  existing={selectedExisting?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSelectedContact(null)}
                  busy={busy}
                />
              )}
              {formType === 'exam' && (
                <ExamCheckinForm
                  contact={selectedContact}
                  rankingSystems={rankingSystems}
                  existing={selectedExisting?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSelectedContact(null)}
                  busy={busy}
                />
              )}
              {typeof formType === 'object' && PluginCheckinForm && (
                <PluginCheckinForm
                  contact={selectedContact}
                  eventId={eventId}
                  existing={selectedExisting?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSelectedContact(null)}
                  busy={busy}
                />
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
