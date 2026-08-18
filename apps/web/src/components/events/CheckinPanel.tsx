'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Check, Search, Download, UserPlus, ClipboardList } from 'lucide-react'
import { CONTACTS_COLLECTION, CHECKINS_COLLECTION } from '@linyup/shared'
import type { Contact, EventCheckin, RankingSystem, EventType, Team } from '@linyup/shared'
import { GenericCheckinForm } from './forms/GenericCheckinForm'
import { CampCheckinForm } from './forms/CampCheckinForm'
import { ExamCheckinForm } from './forms/ExamCheckinForm'
import { PLUGIN_REGISTRY } from '@/plugins/registry'
import { pluginSlot } from '@/plugins/slots'
import type { ComponentType } from 'react'

interface PluginCheckinFormProps {
  contact: Contact
  eventId: string
  existing?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  busy?: boolean
}

type MinContact = { id: string; firstname: string; lastname: string }

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: MinContact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

function exportCsv(t: ReturnType<typeof useTranslations>, checkins: EventCheckin[], eventTitle: string) {
  const rows: string[][] = [[
    t('csvHeaderFirstName'), t('csvHeaderLastName'), t('csvHeaderStatus'), t('csvHeaderCheckedInAt'),
  ]]
  for (const c of checkins) {
    const at = c.created_at
      ? new Date((c.created_at as { toDate(): Date }).toDate()).toLocaleString()
      : ''
    rows.push([
      c.contact.firstname,
      c.contact.lastname,
      c.is_completed ? t('statusConfirmed') : t('statusPending'),
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
  if (plugin?.eventType?.hasCheckinForm) return { pluginId: plugin.id, eventTypeId: plugin.eventType.id }
  if (eventType === 'camp') return 'camp'
  if (eventType === 'exam') return 'exam'
  return 'generic'
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useCheckins(eventId: string) {
  return useQuery<EventCheckin[]>({
    queryKey: ['event-checkins', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, CHECKINS_COLLECTION),
        where('event.id', '==', eventId),
      ))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventCheckin)
    },
  })
}

function useOrgTeams(orgId: string | undefined, enabled: boolean) {
  return useQuery<Pick<Team, 'id' | 'name'>[]>({
    queryKey: ['org-teams', orgId],
    enabled: !!orgId && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, 'teams'),
        where('org_id', '==', orgId),
      ))
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name as string }))
    },
  })
}

// ─── add checkin dialog ───────────────────────────────────────────────────────
// Loads contacts lazily — only when the dialog is open.

function AddCheckinDialog({
  teamId,
  checkedInIds,
  onSelect,
  onClose,
}: {
  teamId: string
  checkedInIds: Set<string>
  onSelect: (contact: Contact) => void
  onClose: () => void
}) {
  const t = useTranslations('CheckinPanel')
  const [search, setSearch] = useState('')

  const contactsQ = useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
        orderBy('firstname'),
      ))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
    },
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (contactsQ.data ?? [])
      .filter((c) => !checkedInIds.has(c.id))
      .filter((c) =>
        !q ||
        `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
      )
  }, [contactsQ.data, checkedInIds, search])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addCheckinDialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t('searchContactsPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
          {contactsQ.isLoading && (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))
          )}
          {!contactsQ.isLoading && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? t('noContactsMatch') : t('allContactsCheckedIn')}
            </p>
          )}
          {!contactsQ.isLoading && visible.map((c) => (
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
  eventDate = '',
  rankingSystems = [],
  orgId,
}: {
  eventId: string
  eventTitle: string
  eventType: EventType
  eventDate?: string
  rankingSystems?: RankingSystem[]
  orgId?: string
}) {
  const t = useTranslations('CheckinPanel')
  const { currentTeamId, isOrgAdmin } = useAuth()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  // sheetTarget: the contact + optional existing checkin shown in the side sheet
  const [sheetTarget, setSheetTarget] = useState<{
    contact: MinContact
    existing?: EventCheckin
    teamId: string
  } | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  // selectedAddTeamId: which team's contacts to pick from when adding (org admins can switch)
  const [selectedAddTeamId, setSelectedAddTeamId] = useState<string>(currentTeamId ?? '')
  const [busy, setBusy] = useState(false)

  const { data: checkins = [], isLoading } = useCheckins(eventId)

  // Org teams — only queried for org admins with an orgId
  const orgTeamsQ = useOrgTeams(orgId, isOrgAdmin)
  const showTeamSelector = isOrgAdmin && (orgTeamsQ.data?.length ?? 0) > 1

  const checkedInIds = useMemo(() => new Set(checkins.map((c) => c.contact.id)), [checkins])

  const filteredCheckins = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return checkins
    return checkins.filter((c) =>
      `${c.contact.firstname} ${c.contact.lastname}`.toLowerCase().includes(q),
    )
  }, [checkins, search])

  const formType = resolveFormType(eventType)

  const PluginCheckinForm = useMemo((): ComponentType<PluginCheckinFormProps> | null => {
    if (typeof formType === 'object') {
      return pluginSlot<PluginCheckinFormProps>(formType.pluginId, 'CheckinForm')
    }
    return null
  }, [formType])

  // Plugin-provided lineup exports (e.g. fighting cup PDF + competitors CSV).
  // Replaces the generic CSV button when the event type declares export support.
  const exportPlugin = useMemo(
    () =>
      PLUGIN_REGISTRY.find(
        (p) =>
          p.eventType?.id === eventType &&
          (p.eventType.hasPdfExport || p.eventType.hasCsvExport),
      ),
    [eventType],
  )

  const PluginExports = useMemo((): ComponentType<{
    eventId: string
    eventTitle: string
    eventDate: string
    checkins: EventCheckin[]
  }> | null => {
    if (!exportPlugin) return null
    return pluginSlot(exportPlugin.id, 'Exports')
  }, [exportPlugin])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['event-checkins', eventId] })

  async function handleSubmit(data: Record<string, unknown>) {
    if (!sheetTarget) return
    setBusy(true)
    try {
      const fn = httpsCallable<unknown, { id: string; is_completed: boolean }>(
        functions, 'addEventCheckin',
      )
      await fn({
        eventId,
        contactId: sheetTarget.contact.id,
        contact: {
          firstname: sheetTarget.contact.firstname,
          lastname: sheetTarget.contact.lastname,
        },
        checkinData: data,
        checkinTeamId: sheetTarget.teamId,
      })
      await invalidate()
      setSheetTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggleComplete(checkin: EventCheckin, e: React.MouseEvent) {
    e.stopPropagation()
    await updateDoc(doc(db, CHECKINS_COLLECTION, checkin.id), {
      is_completed: !checkin.is_completed,
      updated_at: serverTimestamp(),
    })
    invalidate()
  }

  const confirmedCount = checkins.filter((c) => c.is_completed).length
  const pendingCount = checkins.length - confirmedCount

  return (
    <div className="space-y-4">
      {/* Summary bar — sticky so "Add checkin" stays visible while list scrolls.
          `top-14` on mobile clears the sticky app header (see MobileHeader). */}
      <div className="sticky top-14 md:top-0 z-10 bg-background py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t.rich('checkinsCount', { count: checkins.length, strong: (chunks) => <strong className="text-foreground">{chunks}</strong> })}</span>
          {confirmedCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {t.rich('confirmedCount', { count: confirmedCount, strong: (chunks) => <strong className="text-foreground">{chunks}</strong> })}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              {t.rich('pendingCount', { count: pendingCount, strong: (chunks) => <strong className="text-foreground">{chunks}</strong> })}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {PluginExports ? (
            <PluginExports
              eventId={eventId}
              eventTitle={eventTitle}
              eventDate={eventDate}
              checkins={checkins}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCsv(t, checkins, eventTitle)}
              disabled={checkins.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t('exportCsvButton')}
            </Button>
          )}
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            {t('addCheckinButton')}
          </Button>
        </div>
      </div>

      {/* Org team selector — visible to org admins when event has multiple teams */}
      {showTeamSelector && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">{t('showingTeamLabel')}</span>
          <Select value={selectedAddTeamId} onValueChange={(v) => { if (v) setSelectedAddTeamId(v) }}>
            <SelectTrigger className="h-8 text-xs w-48">
              <SelectValue placeholder={orgTeamsQ.data?.find((team) => team.id === selectedAddTeamId)?.name ?? selectedAddTeamId}>
                {orgTeamsQ.data?.find((team) => team.id === selectedAddTeamId)?.name ?? selectedAddTeamId}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {orgTeamsQ.data?.map((team) => (
                <SelectItem key={team.id} value={team.id} className="text-xs">{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Search */}
      {checkins.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t('searchCheckinsPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Checkins list — only contacts with a checkin record */}
      {isLoading && (
        <div className="rounded-xl border overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && checkins.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <ClipboardList className="h-8 w-8 opacity-30" />
          <p className="text-sm">{t('noCheckinsYet')}</p>
          <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            {t('addFirstCheckinButton')}
          </Button>
        </div>
      )}

      {!isLoading && filteredCheckins.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {filteredCheckins.map((checkin) => (
            <div
              key={checkin.id}
              className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
              onClick={() => setSheetTarget({
                contact: checkin.contact,
                existing: checkin,
                teamId: checkin.teamId,
              })}
            >
              {/* Avatar */}
              <div className={`h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ${
                checkin.is_completed ? 'bg-green-500' : 'bg-amber-400'
              }`}>
                <Check className="h-4 w-4" />
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {checkin.contact.firstname} {checkin.contact.lastname}
                </p>
                {checkin.teamId && checkin.teamId !== currentTeamId && (
                  <p className="text-xs text-muted-foreground truncate">
                    {orgTeamsQ.data?.find((team) => team.id === checkin.teamId)?.name ?? checkin.teamId}
                  </p>
                )}
              </div>

              {/* Status + confirm toggle */}
              <div className="shrink-0 flex items-center gap-2">
                {checkin.is_completed ? (
                  <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-600">{t('statusConfirmed')}</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs text-amber-600 border-amber-200 bg-amber-50">{t('statusPending')}</Badge>
                )}
                <button
                  onClick={(e) => toggleComplete(checkin, e)}
                  className={`p-1.5 rounded-full border transition-colors ${
                    checkin.is_completed
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-border hover:bg-muted'
                  }`}
                  title={checkin.is_completed ? t('markPending') : t('markConfirmed')}
                >
                  <Check className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && filteredCheckins.length === 0 && checkins.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">{t('noCheckinsMatchSearch')}</p>
      )}

      {/* Add checkin dialog */}
      {addDialogOpen && currentTeamId && (
        <AddCheckinDialog
          teamId={selectedAddTeamId || currentTeamId}
          checkedInIds={checkedInIds}
          onSelect={(contact) => {
            setSheetTarget({
              contact,
              existing: undefined,
              teamId: selectedAddTeamId || currentTeamId,
            })
          }}
          onClose={() => setAddDialogOpen(false)}
        />
      )}

      {/* Checkin form sheet */}
      <Sheet open={!!sheetTarget} onOpenChange={(o) => { if (!o) setSheetTarget(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md px-6">
          <SheetHeader className="mb-4">
            <SheetTitle>{sheetTarget?.existing ? t('sheetTitleUpdate') : t('sheetTitleAdd')}</SheetTitle>
            {sheetTarget && (
              <p className="text-sm text-muted-foreground">
                {sheetTarget.contact.firstname} {sheetTarget.contact.lastname}
              </p>
            )}
          </SheetHeader>

          {sheetTarget && (
            <>
              {formType === 'generic' && (
                <GenericCheckinForm
                  contact={sheetTarget.contact}
                  existing={sheetTarget.existing?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSheetTarget(null)}
                  busy={busy}
                />
              )}
              {formType === 'camp' && (
                <CampCheckinForm
                  contact={sheetTarget.contact}
                  existing={sheetTarget.existing?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSheetTarget(null)}
                  busy={busy}
                />
              )}
              {formType === 'exam' && (
                <ExamCheckinForm
                  contact={sheetTarget.contact}
                  rankingSystems={rankingSystems}
                  existing={sheetTarget.existing?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSheetTarget(null)}
                  busy={busy}
                />
              )}
              {typeof formType === 'object' && PluginCheckinForm && (
                <PluginCheckinForm
                  contact={sheetTarget.contact as Contact}
                  eventId={eventId}
                  existing={sheetTarget.existing?.checkin_data}
                  onSubmit={handleSubmit}
                  onCancel={() => setSheetTarget(null)}
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
