'use client'

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useOpenTabs } from '@/contexts/OpenTabsContext'
import {
  collection, query, where, orderBy, getDocs, getDoc, addDoc, updateDoc,
  doc, serverTimestamp, Timestamp, deleteField, onSnapshot, deleteDoc, setDoc,
  arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CONTACTS_COLLECTION, TEAMS_COLLECTION, CONTACT_REQUESTS_SUBCOLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION, ORGANIZATIONS_COLLECTION,
  ORG_AFFILIATION_STATUSES_SUBCOLLECTION, DEFAULT_ORG_AFFILIATION_STATUSES,
  CONTACT_FILTERS_SUBCOLLECTION, contactUsageForPlan, PLAN_ORDER, contactOverageForPlan,
  planHasHardContactCap,
} from '@linyup/shared'
import type { Contact, ContactGroup, AcquisitionStage, ContactEntry, ContactSource, ContactRequest, RankingSystem, SubscriptionType, OrgAffiliationStatusDef, SaasPlan, EngagementBand, EngagementThresholds } from '@linyup/shared'
import { ACQUISITION_STAGES, CONTACT_ENTRIES, CONTACT_SOURCES, ENGAGEMENT_BANDS, computeEngagementBand } from '@linyup/shared'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useContactGroups, expandGroupSelection, flattenGroupTree } from '@/plugins/contact-groups/hooks'
import { BulkGroupsDialog } from '@/plugins/contact-groups/BulkGroupsDialog'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Search, UserPlus, X,
  AlertCircle, ChevronDown, ChevronUp, ChevronRight, Archive, Trash2, RotateCcw,
  MoreHorizontal, ArrowRightLeft, Mail, Pencil, Award, CreditCard, Tag,
  Check, Bookmark, BookmarkPlus, BarChart2, Pin, FolderTree, ShieldCheck, UserCheck,
} from 'lucide-react'
import type { Route } from 'next'
import { RosterCard } from '@/components/dashboard/RosterCard'
import { DemographicsCard } from '@/components/dashboard/DemographicsCard'
import { SectionIntro } from '@/components/onboarding/SectionIntro'
import { getPrimaryRank } from '@/lib/rank-utils'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}


const MEMBERSHIP_COLOR_CLASSES: Record<string, string> = {
  gray:   'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  green:  'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  red:    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate(): Date }).toDate()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number') return new Date((ts as { seconds: number }).seconds * 1000)
  return null
}

function daysUntilAnonymisation(deletedAt: unknown): number | null {
  const deleted = tsToDate(deletedAt)
  if (!deleted) return null
  const deadline = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
}

// ─── schema ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  /** Which door they came through — determines birth stage */
  entry: z.enum(['booking', 'walk_in', 'signup', 'import', 'form'] as const),
  source: z.enum(['website', 'referral', 'social', 'event', 'import', 'other'] as const).optional(),
  source_detail: z.string().max(200).optional(),
})
type CreateValues = z.infer<typeof createSchema>

/** Map entry choice → initial acquisition_stage + milestone timestamps. Off-funnel
 *  entries ('shop' / 'form') get NO stage — they're not on the trial funnel. */
function entryToStage(entry: ContactEntry): {
  acquisition_stage?: AcquisitionStage
  trial_attended_at?: ReturnType<typeof serverTimestamp>
  converted_at?: ReturnType<typeof serverTimestamp>
} {
  switch (entry) {
    case 'booking': return { acquisition_stage: 'trial_booked' }
    case 'walk_in': return { acquisition_stage: 'trial_attended', trial_attended_at: serverTimestamp() }
    case 'signup':
    case 'import': return { acquisition_stage: 'joined', converted_at: serverTimestamp() }
    case 'form':
    case 'shop': return {} // off-funnel entry — no acquisition stage
  }
}

// ─── data hooks ───────────────────────────────────────────────────────────────

// `coachScopeUid` restricts the list to a coach's own book (uid in
// assigned_coach_ids). Own-scoped members (coaches) may only read their assigned
// contacts per the Firestore rules, so a broad query would be denied — we filter by
// assignee and do the active/archived filtering + sort client-side (a coach's book is small).
function useActiveContacts(teamId: string | null, coachScopeUid?: string | null) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId, coachScopeUid ?? 'all'],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      if (coachScopeUid) {
        const snap = await getDocs(
          query(
            collection(db, CONTACTS_COLLECTION),
            where('teamId', '==', teamId),
            where('assigned_coach_ids', 'array-contains', coachScopeUid),
          ),
        )
        return snap.docs
          .map((d) => ({ ...d.data(), id: d.id }) as Contact)
          .filter((c) => !c.deleted_at && !c.archived_at)
          .sort((a, b) =>
            (a.lastname ?? '').localeCompare(b.lastname ?? '') ||
            (a.firstname ?? '').localeCompare(b.firstname ?? ''),
          )
      }
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
        orderBy('firstname'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
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
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
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
        where('anonymized_at', '==', null),
        where('teamId', '==', teamId),
        where('deleted_at', '!=', null),
        orderBy('deleted_at', 'desc'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
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
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ContactRequest)
    },
  })
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as SubscriptionType)
    },
  })
}

function useOrgAffiliationStatuses(orgId: string | null | undefined) {
  return useQuery<OrgAffiliationStatusDef[]>({
    queryKey: ['org-membership-statuses', orgId ?? null],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!orgId) return DEFAULT_ORG_AFFILIATION_STATUSES
      const snap = await getDocs(
        collection(db, ORGANIZATIONS_COLLECTION, orgId, ORG_AFFILIATION_STATUSES_SUBCOLLECTION),
      )
      if (snap.empty) return DEFAULT_ORG_AFFILIATION_STATUSES
      const defs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as OrgAffiliationStatusDef))
      const byId = Object.fromEntries(DEFAULT_ORG_AFFILIATION_STATUSES.map((s) => [s.id, s]))
      defs.forEach((d) => { byId[d.id] = d })
      return Object.values(byId).sort((a, b) => a.order - b.order)
    },
  })
}

function useOrgRankingSystems(orgId: string | null | undefined) {
  return useQuery<RankingSystem[] | null>({
    queryKey: ['org-ranking-systems', orgId ?? null],
    enabled: !!orgId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (!orgId) return null
      const snap = await getDoc(doc(db, ORGANIZATIONS_COLLECTION, orgId))
      if (!snap.exists()) return null
      const systems = snap.data().ranking_systems as RankingSystem[] | undefined
      return systems?.length ? systems : null
    },
  })
}

// ─── create dialog ────────────────────────────────────────────────────────────

function CreateContactDialog({
  open, onOpenChange, teamId, userId, onSaved, atHardCap = false,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  teamId: string; userId: string; onSaved: () => void
  /** Backstop for the Free plan's hard cap — the open buttons already divert
   *  to the upgrade dialog, this guards a dialog left open across the limit. */
  atHardCap?: boolean
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue, control } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    // Default: "Existing member" — manual coach adds are usually existing members
    defaultValues: { entry: 'signup' },
  })
  const entry = watch('entry')
  // At the hard cap only 'booking' is selectable — snap the default onto it.
  useEffect(() => {
    if (open && atHardCap && entry !== 'booking') setValue('entry', 'booking')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, atHardCap])
  // A coach (own-scoped) creating a contact auto-assigns it to themselves so it
  // lands in their own book and satisfies the own-scope Firestore rules.
  const { ownScoped } = useCapabilities()
  // entry options: booking (trial), walk_in (trial attended), signup (member), import (member)
  const ENTRIES = ['booking', 'walk_in', 'signup'] as const

  const onSubmit = async (values: CreateValues) => {
    // At the Free hard cap only counting entries are blocked — a trial 'booking'
    // lead is PROVISIONAL (doesn't consume allowance) and stays allowed, matching
    // the public booking page which keeps working at cap.
    if (atHardCap && values.entry !== 'booking') {
      onOpenChange(false)
      return
    }
    const stageData = entryToStage(values.entry)
    await addDoc(collection(db, CONTACTS_COLLECTION), {
      teamId,
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      entry: values.entry,
      source: values.source || null,
      source_detail: values.source_detail || null,
      ...stageData,
      // A never-attended trial lead doesn't count toward the cap; attendance /
      // payment / promotion materializes it. See Contact.provisional.
      ...(values.entry === 'booking' ? { provisional: true } : {}),
      acquisition_stage_updated_at: serverTimestamp(),
      lead_acknowledged: false,
      createdBy: userId,
      assigned_coach_ids: ownScoped ? [userId] : [],
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
        <form onSubmit={handleSubmit(onSubmit)} className="contents">
          <div className="space-y-4 pt-1">
            {/* Entry choice — determines birth stage. At the Free hard cap, only
                'booking' (a non-counting provisional lead) stays selectable. */}
            <div className="flex gap-2">
              {ENTRIES.map((v) => {
                const capBlocked = atHardCap === true && v !== 'booking'
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={capBlocked}
                    onClick={() => setValue('entry', v)}
                    className={`flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      entry === v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : capBlocked
                          ? 'bg-background text-muted-foreground/40 cursor-not-allowed'
                          : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(`entry_${v}`)}
                  </button>
                )
              })}
            </div>
            {atHardCap && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('capEntryHint')}</p>
            )}

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
            {/* Optional source */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldAcquisitionSource')}</label>
                <Controller
                  control={control}
                  name="source"
                  render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        {CONTACT_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>{t(`source_${s}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('fieldAcquisitionSourceDetail')}</label>
                <Input {...register('source_detail')} placeholder="—" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              {t('cancel')}
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isSubmitting ? tCommon('loading') : t('createContact')}
            </button>
          </DialogFooter>
        </form>
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

// ─── overview panel ───────────────────────────────────────────────────────────

function OverviewPanel({
  contacts, loading, rankingSystems, engagementThresholds,
}: {
  contacts: Contact[]
  loading: boolean
  rankingSystems?: RankingSystem[]
  engagementThresholds?: EngagementThresholds
}) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(false)

  const activeCount = contacts.filter((c) => c.affiliation_summary?.has_active === true).length
  const trialBookedCount = contacts.filter((c) => c.acquisition_stage === 'trial_booked').length

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg border border-dashed border-border/50 hover:border-border hover:bg-muted/30 transition-colors group"
      >
        <BarChart2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">{t('statsTitle')}</span>
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        {!open && !loading && contacts.length > 0 && (
          <div className="flex items-center gap-3 ml-1 text-xs text-muted-foreground/60">
            <span>{contacts.length} contacts</span>
            {activeCount > 0 && <span>{activeCount} active</span>}
            {trialBookedCount > 0 && <span>{trialBookedCount} {t('statsTrialBooked').toLowerCase()}</span>}
          </div>
        )}
      </button>
      {open && (
        loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-52 rounded-xl" />
            <Skeleton className="h-52 rounded-xl" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <RosterCard contacts={contacts} thresholds={engagementThresholds} />
            <DemographicsCard contacts={contacts} rankingSystems={rankingSystems} />
          </div>
        )
      )}
    </div>
  )
}

// ─── filter panel ─────────────────────────────────────────────────────────────

type InactivityPreset = 'never' | '30d' | '60d' | '90d'

type RankFilter = Record<string, number[]> // systemId → selected level values

interface Filters {
  stages: string[]           // AcquisitionStage values
  sources: string[]          // ContactSource values
  statuses: string[]
  subscriptions: string[]    // subscription_type_id values; 'none' = no subscription
  groups: string[]           // contact_groups IDs (Contact Groups plugin); parents include subgroups
  engagement: EngagementBand[] // derived band: active / low / at_risk / inactive
  hasAlerts: boolean
  // Paid a 'full'-mode purchase but hasn't completed the full signup (profile+consent)
  pendingSignup: boolean
  sessionsMin: number | null
  sessionsMax: number | null
  inactivity: InactivityPreset | null
  rankFilter: RankFilter | null
}
const EMPTY_FILTERS: Filters = {
  stages: [], sources: [], statuses: [], subscriptions: [], groups: [], engagement: [],
  hasAlerts: false, pendingSignup: false, sessionsMin: null, sessionsMax: null, inactivity: null,
  rankFilter: null,
}

function countActiveFilters(f: Filters): number {
  return f.stages.length + f.sources.length + f.statuses.length + f.subscriptions.length + f.groups.length
    + f.engagement.length
    + (f.hasAlerts ? 1 : 0)
    + (f.pendingSignup ? 1 : 0)
    + (f.sessionsMin != null || f.sessionsMax != null ? 1 : 0)
    + (f.inactivity ? 1 : 0)
    + (f.rankFilter && Object.values(f.rankFilter).some((l) => l.length > 0) ? 1 : 0)
}

// ─── filter chips ─────────────────────────────────────────────────────────────

interface SavedQuery { id: string; name: string; filters: Filters; pinned?: boolean }

const FILTER_PRESETS: SavedQuery[] = [
  { id: 'p-active', name: 'Affiliated',       filters: { ...EMPTY_FILTERS, statuses: ['active'] } },
  { id: 'p-nosub',  name: 'No subscription', filters: { ...EMPTY_FILTERS, subscriptions: ['none'] } },
  { id: 'p-trials', name: 'Trials',          filters: { ...EMPTY_FILTERS, stages: ['trial_booked', 'trial_attended'] } },
  { id: 'p-alerts', name: 'Has alerts',      filters: { ...EMPTY_FILTERS, hasAlerts: true } },
  { id: 'p-pending-signup', name: 'Pending signup', filters: { ...EMPTY_FILTERS, pendingSignup: true } },
]

function useScrollLockOnOpen() {
  const [open, setOpen] = useState(false)
  const savedY = useRef(0)
  function onOpenChange(v: boolean) {
    if (v) savedY.current = window.scrollY
    setOpen(v)
  }
  useLayoutEffect(() => {
    if (!open) return
    const y = savedY.current
    window.scrollTo(0, y)
    const restore = () => window.scrollTo(0, y)
    window.addEventListener('scroll', restore)
    let r2: number
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => window.removeEventListener('scroll', restore))
    })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); window.removeEventListener('scroll', restore) }
  }, [open])
  return { open, onOpenChange }
}

function CheckOption({ label, checked, onToggle, dot }: { label: string; checked: boolean; onToggle: () => void; dot?: string }) {
  return (
    <button type="button" onClick={onToggle}
      className="flex items-center gap-2.5 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left"
    >
      <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary border-primary' : 'border-input'}`}>
        {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </span>
      {dot && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />}
      <span className="truncate">{label}</span>
    </button>
  )
}

// Band → dot colour for the engagement filter (mirrors the meter on the contact page).
const ENGAGEMENT_DOT: Record<EngagementBand, string> = {
  active: 'bg-emerald-500',
  low: 'bg-amber-500',
  at_risk: 'bg-red-500',
  inactive: 'bg-muted-foreground/40',
}

function FilterChip({ label, activeLabel, isActive, onClear, children }: {
  label: string; activeLabel?: string; isActive: boolean; onClear?: () => void; children: React.ReactNode
}) {
  const { open, onOpenChange } = useScrollLockOnOpen()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border outline-none transition-colors ${
        isActive
          ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
          : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
      }`}>
        <span>{isActive && activeLabel ? activeLabel : label}</span>
        {isActive ? (
          <span role="button" aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onClear?.() }}
            className="rounded-full p-0.5 hover:bg-primary/20 transition-colors -mr-0.5"
          ><X className="h-3 w-3" /></span>
        ) : (
          <ChevronDown className="h-3 w-3 opacity-40" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-auto min-w-[180px] p-1.5">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function useSavedQueries(teamId: string | null) {
  const { user } = useAuth()
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [pinnedPresets, setPinnedPresets] = useState<string[]>([])

  useEffect(() => {
    if (!teamId) return
    const colRef = collection(db, TEAMS_COLLECTION, teamId, CONTACT_FILTERS_SUBCOLLECTION)
    return onSnapshot(colRef, (snap) => {
      const presetPinsDoc = snap.docs.find((d) => d.id === '_preset_pins')
      setPinnedPresets(presetPinsDoc?.data()?.ids ?? [])
      setSaved(
        snap.docs
          .filter((d) => d.id !== '_preset_pins')
          .map((d) => ({
            id: d.id,
            name: d.data().name as string,
            // Older saved filters may predate newer keys (e.g. groups) — backfill defaults.
            filters: { ...EMPTY_FILTERS, ...(d.data().filters as Partial<Filters>) },
            pinned: d.data().pinned ?? false,
          }))
      )
    })
  }, [teamId])

  function save(name: string, filters: Filters) {
    if (!teamId || !user) return
    addDoc(collection(db, TEAMS_COLLECTION, teamId, CONTACT_FILTERS_SUBCOLLECTION), {
      name, filters, pinned: false,
      created_at: serverTimestamp(),
      created_by: user.uid,
    })
  }
  function remove(id: string) {
    if (!teamId) return
    deleteDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_FILTERS_SUBCOLLECTION, id))
  }
  function togglePin(id: string) {
    if (!teamId) return
    const current = saved.find((q) => q.id === id)
    if (!current) return
    updateDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_FILTERS_SUBCOLLECTION, id), { pinned: !current.pinned })
  }
  function togglePresetPin(id: string) {
    if (!teamId) return
    const next = pinnedPresets.includes(id)
      ? pinnedPresets.filter((p) => p !== id)
      : [...pinnedPresets, id]
    setDoc(doc(db, TEAMS_COLLECTION, teamId, CONTACT_FILTERS_SUBCOLLECTION, '_preset_pins'), { ids: next })
  }

  return { saved, save, remove, togglePin, pinnedPresets, togglePresetPin }
}

function SavedMenu({ filters, onChange, saved, save, remove, togglePin, pinnedPresets, togglePresetPin }: {
  filters: Filters; onChange: (f: Filters) => void
  saved: SavedQuery[]; save: (name: string, filters: Filters) => void
  remove: (id: string) => void; togglePin: (id: string) => void
  pinnedPresets: string[]; togglePresetPin: (id: string) => void
}) {
  const { open, onOpenChange } = useScrollLockOnOpen()
  const [saveName, setSaveName] = useState('')
  const hasActive = countActiveFilters(filters) > 0

  function apply(q: SavedQuery) { onChange(q.filters); onOpenChange(false) }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:border-border outline-none transition-colors">
        <Bookmark className="h-3 w-3" />
        Saved
        <ChevronDown className="h-3 w-3 opacity-40" />
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-52 p-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1 pb-0.5">Presets</p>
        {FILTER_PRESETS.map((q) => {
          const isPinned = pinnedPresets.includes(q.id)
          return (
            <div key={q.id} className="flex items-center gap-1 rounded hover:bg-accent group px-1">
              <button type="button" onClick={() => apply(q)} className="flex-1 px-1 py-1.5 text-sm text-left truncate">{q.name}</button>
              <button type="button" onClick={() => togglePresetPin(q.id)}
                className={`shrink-0 p-1 transition-all ${isPinned ? 'text-primary opacity-100' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary'}`}
                title={isPinned ? 'Unpin' : 'Pin to filter bar'}
              ><Pin className="h-3 w-3" /></button>
            </div>
          )
        })}
        {saved.length > 0 && (
          <>
            <div className="my-1 border-t mx-1" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-0.5">Saved</p>
            {saved.map((q) => (
              <div key={q.id} className="flex items-center gap-1 rounded hover:bg-accent group px-1">
                <button type="button" onClick={() => apply(q)} className="flex-1 px-1 py-1.5 text-sm text-left truncate">{q.name}</button>
                <button type="button" onClick={() => togglePin(q.id)}
                  className={`shrink-0 p-1 transition-all ${q.pinned ? 'text-primary opacity-100' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary'}`}
                  title={q.pinned ? 'Unpin' : 'Pin to filter bar'}
                ><Pin className="h-3 w-3" /></button>
                <button type="button" onClick={() => remove(q.id)}
                  className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                ><X className="h-3 w-3" /></button>
              </div>
            ))}
          </>
        )}
        {hasActive && (
          <>
            <div className="my-1 border-t mx-1" />
            <div className="flex items-center gap-1.5 px-1 py-1">
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && saveName.trim()) { save(saveName.trim(), filters); setSaveName(''); onOpenChange(false) } }}
                placeholder="Save as…" className="h-7 text-xs"
              />
              <button type="button" disabled={!saveName.trim()}
                onClick={() => { if (saveName.trim()) { save(saveName.trim(), filters); setSaveName(''); onOpenChange(false) } }}
                className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              ><BookmarkPlus className="h-3.5 w-3.5" /></button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function RankFilterContent({ rankingSystems, rankFilter, onChange }: {
  rankingSystems: RankingSystem[]
  rankFilter: RankFilter | null
  onChange: (rf: RankFilter | null) => void
}) {
  const firstActiveId = rankFilter ? Object.keys(rankFilter).find((id) => rankFilter[id].length > 0) : null
  const defaultId = firstActiveId ?? rankingSystems.find((s) => s.is_primary)?.id ?? rankingSystems[0]?.id ?? ''
  const [activeId, setActiveId] = useState(defaultId)
  const system = rankingSystems.find((s) => s.id === activeId) ?? rankingSystems[0]
  const selected = rankFilter?.[activeId] ?? []

  function toggle(value: number) {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    const newFilter: RankFilter = { ...(rankFilter ?? {}), [activeId]: next }
    // Remove empty entries
    Object.keys(newFilter).forEach((k) => { if (!newFilter[k].length) delete newFilter[k] })
    onChange(Object.keys(newFilter).length ? newFilter : null)
  }

  return (
    <div className="min-w-[160px]">
      {rankingSystems.length > 1 && (
        <div className="flex gap-0.5 p-1 border-b mb-1">
          {rankingSystems.map((s) => {
            const count = rankFilter?.[s.id]?.length ?? 0
            return (
              <button key={s.id} type="button" onClick={() => setActiveId(s.id)}
                className={`relative flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                  activeId === s.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {s.name}
                {count > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      )}
      {system?.levels.map((level) => (
        <button key={level.value} type="button" onClick={() => toggle(level.value)}
          className="flex items-center gap-2.5 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left"
        >
          <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            selected.includes(level.value) ? 'bg-primary border-primary' : 'border-input'
          }`}>
            {selected.includes(level.value) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
          </span>
          {level.color && (
            <span className="h-3 w-3 rounded-full shrink-0 border border-border/30"
              style={{ backgroundColor: level.color }} />
          )}
          <span>{level.label}</span>
        </button>
      ))}
    </div>
  )
}

function FilterChips({
  filters, onChange, subscriptionTypes, teamId, rankingSystems, contactGroups,
}: {
  filters: Filters; onChange: (f: Filters) => void
  subscriptionTypes: SubscriptionType[]; teamId: string | null
  rankingSystems: RankingSystem[]
  contactGroups: ContactGroup[] | null  // null = plugin not installed
}) {
  const t = useTranslations('Contacts')
  const { saved, save, remove, togglePin, pinnedPresets, togglePresetPin } = useSavedQueries(teamId)
  const pinnedQueries = [
    ...FILTER_PRESETS.filter((q) => pinnedPresets.includes(q.id)),
    ...saved.filter((q) => q.pinned),
  ]

  const STAGE_OPTS  = (ACQUISITION_STAGES as readonly AcquisitionStage[]).map((v) => ({ value: v, label: t(`stage_${v}` as Parameters<typeof t>[0]) }))
  const SOURCE_OPTS = (CONTACT_SOURCES as readonly ContactSource[]).map((v) => ({ value: v, label: t(`source_${v}` as Parameters<typeof t>[0]) }))
  const AFFIL_OPTS = [
    { value: 'active', label: t('filterAffiliationActive') },
    { value: 'none', label: t('filterAffiliationNone') },
  ]
  const SUB_OPTS    = [{ value: 'none', label: t('filterSubscriptionNone') }, ...subscriptionTypes.map((s) => ({ value: s.id, label: s.name }))]
  const INACTIVITY_OPTS: { value: InactivityPreset; label: string }[] = [
    { value: 'never', label: t('filterInactivityNever') },
    { value: '30d',   label: t('filterInactivity30d') },
    { value: '60d',   label: t('filterInactivity60d') },
    { value: '90d',   label: t('filterInactivity90d') },
  ]
  const ENGAGEMENT_OPTS = (ENGAGEMENT_BANDS as readonly EngagementBand[]).map((v) => ({
    value: v, label: t(`engagement_${v}` as Parameters<typeof t>[0]), dot: ENGAGEMENT_DOT[v],
  }))

  function chip(arr: string[], opts: { value: string; label: string }[], noun: string) {
    if (!arr.length) return ''
    return arr.length === 1 ? (opts.find((o) => o.value === arr[0])?.label ?? arr[0]) : `${arr.length} ${noun}`
  }

  const activityParts: string[] = []
  if (filters.inactivity) activityParts.push(INACTIVITY_OPTS.find((o) => o.value === filters.inactivity)?.label ?? '')
  if (filters.sessionsMin != null && filters.sessionsMax != null) activityParts.push(`${filters.sessionsMin}–${filters.sessionsMax} sessions`)
  else if (filters.sessionsMin != null) activityParts.push(`${filters.sessionsMin}+ sessions`)
  else if (filters.sessionsMax != null) activityParts.push(`≤${filters.sessionsMax} sessions`)

  function toggle<T extends string>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
  }

  const activityIsActive = filters.inactivity !== null || filters.sessionsMin !== null || filters.sessionsMax !== null

  // Combined "Acquisition" chip label: stage and source parts joined.
  const acqParts: string[] = []
  if (filters.stages.length) acqParts.push(chip(filters.stages, STAGE_OPTS, 'stages'))
  if (filters.sources.length) acqParts.push(chip(filters.sources, SOURCE_OPTS, 'sources'))
  const acqActiveLabel = acqParts.join(' · ')

  const rankActiveLabel = (() => {
    const rf = filters.rankFilter
    if (!rf) return ''
    const active = Object.entries(rf).filter(([, lvls]) => lvls.length > 0)
    if (!active.length) return ''
    const total = active.reduce((n, [, lvls]) => n + lvls.length, 0)
    if (active.length === 1) {
      const [systemId, levels] = active[0]
      const sys = rankingSystems.find((s) => s.id === systemId)
      if (sys && levels.length === 1)
        return sys.levels.find((l) => l.value === levels[0])?.label ?? '1 rank'
      const prefix = rankingSystems.length > 1 ? `${sys?.name ?? ''}: ` : ''
      return `${prefix}${levels.length} ranks`
    }
    return `${total} ranks`
  })()

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SavedMenu filters={filters} onChange={onChange} saved={saved} save={save} remove={remove} togglePin={togglePin} pinnedPresets={pinnedPresets} togglePresetPin={togglePresetPin} />
      {pinnedQueries.length > 0 && (
        <>
          {pinnedQueries.map((q) => {
            const isActive = JSON.stringify(filters) === JSON.stringify(q.filters)
            return (
              <button key={q.id} type="button"
                onClick={() => onChange(isActive ? EMPTY_FILTERS : q.filters)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Pin className="h-3 w-3 opacity-50 shrink-0" />
                {q.name}
                {isActive && (
                  <span role="button" aria-label="Clear"
                    onClick={(e) => { e.stopPropagation(); onChange(EMPTY_FILTERS) }}
                    className="rounded-full p-0.5 hover:bg-primary/20 -mr-0.5"
                  ><X className="h-3 w-3" /></span>
                )}
              </button>
            )
          })}
        </>
      )}
      <div className="h-5 w-px bg-border/50 shrink-0 mx-0.5" />
      {/* Acquisition — stage + source in one chip, split by a light divider */}
      <FilterChip label={t('filterAcquisition')} activeLabel={acqActiveLabel}
        isActive={filters.stages.length > 0 || filters.sources.length > 0}
        onClear={() => onChange({ ...filters, stages: [], sources: [] })}>
        <div className="p-1 space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 py-0.5">{t('filterStage')}</p>
          {STAGE_OPTS.map((o) => <CheckOption key={o.value} label={o.label} checked={filters.stages.includes(o.value)}
            onToggle={() => onChange({ ...filters, stages: toggle(filters.stages, o.value) })} />)}
          <div className="border-t my-1.5 mx-1" />
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 py-0.5">{t('filterSource')}</p>
          {SOURCE_OPTS.map((o) => <CheckOption key={o.value} label={o.label} checked={filters.sources.includes(o.value)}
            onToggle={() => onChange({ ...filters, sources: toggle(filters.sources, o.value) })} />)}
        </div>
      </FilterChip>

      <FilterChip label={t('filterAffiliation')} activeLabel={chip(filters.statuses, AFFIL_OPTS, 'statuses')}
        isActive={filters.statuses.length > 0} onClear={() => onChange({ ...filters, statuses: [] })}>
        {AFFIL_OPTS.map((o) => <CheckOption key={o.value} label={o.label} checked={filters.statuses.includes(o.value)}
          onToggle={() => onChange({ ...filters, statuses: toggle(filters.statuses, o.value) })} />)}
      </FilterChip>

      {rankingSystems.length > 0 && (
        <FilterChip label={t('filterRank')} activeLabel={rankActiveLabel}
          isActive={!!filters.rankFilter && Object.values(filters.rankFilter).some((l) => l.length > 0)}
          onClear={() => onChange({ ...filters, rankFilter: null })}>
          <RankFilterContent
            rankingSystems={rankingSystems}
            rankFilter={filters.rankFilter}
            onChange={(rf) => onChange({ ...filters, rankFilter: rf })}
          />
        </FilterChip>
      )}

      <FilterChip label={t('filterSubscription')} activeLabel={chip(filters.subscriptions, SUB_OPTS, 'subscriptions')}
        isActive={filters.subscriptions.length > 0} onClear={() => onChange({ ...filters, subscriptions: [] })}>
        {SUB_OPTS.map((o) => <CheckOption key={o.value} label={o.label} checked={filters.subscriptions.includes(o.value)}
          onToggle={() => onChange({ ...filters, subscriptions: toggle(filters.subscriptions, o.value) })} />)}
      </FilterChip>

      {/* Contact Groups plugin — chip only when installed and groups exist */}
      {contactGroups && contactGroups.length > 0 && (
        <FilterChip label={t('filterGroups')}
          activeLabel={chip(filters.groups, contactGroups.map((g) => ({ value: g.id, label: g.name })), 'groups')}
          isActive={filters.groups.length > 0} onClear={() => onChange({ ...filters, groups: [] })}>
          {flattenGroupTree(contactGroups).map(({ group, depth }) => (
            <div key={group.id} style={{ paddingLeft: `${depth * 14}px` }}>
              <CheckOption label={group.name} checked={filters.groups.includes(group.id)}
                onToggle={() => onChange({ ...filters, groups: toggle(filters.groups, group.id) })} />
            </div>
          ))}
        </FilterChip>
      )}

      <FilterChip label={t('filterActivity')} activeLabel={activityParts.join(' · ')}
        isActive={activityIsActive}
        onClear={() => onChange({ ...filters, inactivity: null, sessionsMin: null, sessionsMax: null })}>
        <div className="p-1 space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 py-0.5">{t('filterLastActive')}</p>
          {INACTIVITY_OPTS.map((o) => (
            <button key={o.value} type="button"
              onClick={() => onChange({ ...filters, inactivity: filters.inactivity === o.value ? null : o.value })}
              className={`flex items-center gap-2.5 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left ${filters.inactivity === o.value ? 'font-medium' : 'text-muted-foreground'}`}
            >
              <span className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${filters.inactivity === o.value ? 'bg-primary border-primary' : 'border-input'}`}>
                {filters.inactivity === o.value && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
              </span>
              {o.label}
            </button>
          ))}
          <div className="border-t my-1.5 mx-1" />
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 py-0.5">{t('filterSessions')}</p>
          <div className="flex items-center gap-1.5 px-1 pb-1">
            <Input type="number" min="0" placeholder={t('filterSessionsMin')}
              value={filters.sessionsMin ?? ''}
              onChange={(e) => onChange({ ...filters, sessionsMin: e.target.value ? Number(e.target.value) : null })}
              className="h-7 text-xs w-20" />
            <span className="text-xs text-muted-foreground">–</span>
            <Input type="number" min="0" placeholder={t('filterSessionsMax')}
              value={filters.sessionsMax ?? ''}
              onChange={(e) => onChange({ ...filters, sessionsMax: e.target.value ? Number(e.target.value) : null })}
              className="h-7 text-xs w-20" />
          </div>
        </div>
      </FilterChip>

      <FilterChip label={t('filterEngagement')} activeLabel={chip(filters.engagement, ENGAGEMENT_OPTS, 'bands')}
        isActive={filters.engagement.length > 0} onClear={() => onChange({ ...filters, engagement: [] })}>
        {ENGAGEMENT_OPTS.map((o) => <CheckOption key={o.value} label={o.label} dot={o.dot}
          checked={filters.engagement.includes(o.value)}
          onToggle={() => onChange({ ...filters, engagement: toggle(filters.engagement, o.value) })} />)}
      </FilterChip>

      <button type="button"
        onClick={() => onChange({ ...filters, hasAlerts: !filters.hasAlerts })}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
          filters.hasAlerts
            ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
            : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
        }`}>
        <AlertCircle className="h-3 w-3" />
        {t('filterAlertsLabel')}
        {filters.hasAlerts && (
          <span role="button" aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange({ ...filters, hasAlerts: false }) }}
            className="rounded-full p-0.5 hover:bg-primary/20 -mr-0.5">
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {/* Pending signup — paid a 'full'-mode purchase, full profile+consent still owed */}
      <button type="button"
        onClick={() => onChange({ ...filters, pendingSignup: !filters.pendingSignup })}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
          filters.pendingSignup
            ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
            : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
        }`}>
        <UserCheck className="h-3 w-3" />
        {t('filterPendingSignup')}
        {filters.pendingSignup && (
          <span role="button" aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange({ ...filters, pendingSignup: false }) }}
            className="rounded-full p-0.5 hover:bg-primary/20 -mr-0.5">
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {countActiveFilters(filters) > 0 && (
        <>
          <div className="h-5 w-px bg-border/50 shrink-0 mx-0.5" />
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border border-destructive/30 text-destructive/80 hover:text-destructive hover:bg-destructive/5 hover:border-destructive/50 transition-colors">
            <X className="h-3 w-3" />{t('clearFilters')}
          </button>
        </>
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
  rankingSystems = [],
}: {
  contact: Contact
  selectable: boolean
  selected: boolean
  onSelect: (id: string) => void
  rankingSystems?: RankingSystem[]
}) {
  const router = useRouter()
  const { openInNewTab } = useOpenTabs()
  const t = useTranslations('Contacts')
  const isNew = contact.lead_acknowledged === false
  const contactHref = `/contacts/${contact.id}`
  const contactLabel = `${contact.firstname ?? ''} ${contact.lastname ?? ''}`.trim() || contactHref
  // ctrl/⌘/middle-click opens the contact in a background tab (keeps the list).
  const openContactInNewTab = () => openInNewTab(contactHref, contactLabel, 'contact')
  const rankColor = rankingSystems.length > 0
    ? getPrimaryRank(contact, rankingSystems)?.level.color
    : undefined

  return (
    <div className="flex items-center border-b last:border-0 hover:bg-muted/50 transition-colors">
      <button
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            openContactInNewTab()
            return
          }
          router.push(contactHref as Route)
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            openContactInNewTab()
          }
        }}
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
      >
        {/* Avatar */}
        <div className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center bg-muted text-muted-foreground text-sm font-semibold relative">
          {initials(contact)}
          {rankColor && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background"
              style={{ background: rankColor }}
            />
          )}
        </div>

        {/* Text block */}
        <div className="flex-1 min-w-0 space-y-0.5">
          {/* Line 1: name */}
          <p className="font-medium text-sm truncate">
            {contact.firstname} {contact.lastname}
            {isNew && (
              <span className="ml-2 text-xs font-semibold text-blue-500">{t('newBadge')}</span>
            )}
          </p>
          {/* Line 2: email */}
          <p className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
            <span className="truncate">{contact.email ?? contact.phone ?? '—'}</span>
          </p>
          {/* Line 3: stage + affiliation + subscription chips */}
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {contact.acquisition_stage && contact.acquisition_stage !== 'joined' && (
              <Badge variant="outline" className="text-xs">{t(`stage_${contact.acquisition_stage}` as Parameters<typeof t>[0])}</Badge>
            )}
            {contact.pending_signup && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {t('pendingSignup')}
              </span>
            )}
            {/* Shop registration awaiting payment — the ONLY provisional kind with a
                purge deadline; trial/form leads show their normal stage badges. */}
            {contact.provisional === true && contact.provisional_expires_at != null && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {t('unconfirmedBadge', {
                  days: Math.max(
                    0,
                    Math.ceil(
                      ((contact.provisional_expires_at?.toDate?.().getTime() ?? Date.now()) - Date.now()) /
                        86_400_000
                    )
                  ),
                })}
              </span>
            )}
            {contact.affiliation_summary?.has_active && (
              <span
                title={`${t('affiliationChip')}${contact.affiliation_summary.types.length ? `: ${contact.affiliation_summary.types.join(', ')}` : ''}`}
                className="inline-flex items-center text-emerald-600 dark:text-emerald-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
            )}
            {(contact.active_subscriptions?.length ?? 0) > 0 ? (
              <Badge variant="secondary" className="text-xs font-normal">
                {contact.active_subscriptions![0].subscription_type_name ??
                  contact.subscription_type_name}
                {contact.active_subscriptions!.length > 1 &&
                  ` +${contact.active_subscriptions!.length - 1}`}
              </Badge>
            ) : contact.subscription_type_name ? (
              <Badge variant="secondary" className="text-xs font-normal">
                {contact.subscription_type_name}
              </Badge>
            ) : null}
          </div>
        </div>
      </button>

      {/* Alerts indicator */}
      {(contact.alerts_count ?? 0) > 0 && (
        <div className="flex items-center gap-1 shrink-0 px-3 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-semibold">{contact.alerts_count}</span>
        </div>
      )}

      {/* Checkbox — right side */}
      {selectable && (
        <label className="pr-4 pl-2 py-3 cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(contact.id)}
            className="h-4 w-4 rounded border-border"
          />
        </label>
      )}
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
      <div className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center bg-muted text-muted-foreground text-sm font-semibold">
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

// Fields a contact may submit in a data-update request (mirrors the function's
// ALLOWED_UPDATE_FIELDS). Used to render the current → requested comparison.
const REQUEST_FIELDS = [
  'firstname', 'lastname', 'phone', 'birthdate', 'gender',
  'birthplace', 'residence', 'emergencyContact', 'notes',
] as const

function formatRequestValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Timestamp) return v.toDate().toLocaleDateString()
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && x !== '')
      .map((x) => String(x))
      .join(' · ')
  }
  return String(v)
}

function ContactRequestDialog({
  request, teamId, onClose, onActioned,
}: {
  request: ContactRequest | null
  teamId: string
  onClose: () => void
  onActioned: () => void
}) {
  const t = useTranslations('Contacts')
  const [busy, setBusy] = useState<null | 'approve' | 'discard'>(null)
  const [error, setError] = useState(false)

  // Current contact values, to show what each requested field would change.
  const { data: contact } = useQuery<Record<string, unknown> | null>({
    queryKey: ['contact-doc', request?.contact_id],
    enabled: !!request?.contact_id,
    queryFn: async () => {
      if (!request?.contact_id) return null
      const snap = await getDoc(doc(db, CONTACTS_COLLECTION, request.contact_id))
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null
    },
  })

  useEffect(() => { setError(false); setBusy(null) }, [request?.id])

  const submitted = request?.submitted_data ?? {}
  const rows = REQUEST_FIELDS
    .map((field) => ({ field, requested: formatRequestValue(submitted[field]) }))
    .filter((r) => r.requested !== '')

  async function act(action: 'approve' | 'discard') {
    if (!request) return
    setBusy(action)
    setError(false)
    try {
      const fn = httpsCallable(functions, 'manageContactUpdateRequest')
      await fn({ teamId, requestId: request.id, action })
      onActioned()
      onClose()
    } catch (e) {
      console.error('manageContactUpdateRequest failed', e)
      setError(true)
      setBusy(null)
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reqTitle')}</DialogTitle>
        </DialogHeader>
        {request && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">{request.contact_name ?? request.contact_id}</p>
              {request.contact_email && (
                <p className="text-xs text-muted-foreground">{request.contact_email}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {request.requested_at?.toDate().toLocaleString()}
              </p>
            </div>

            {request.note && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">{t('reqNote')}</p>
                <p className="text-sm whitespace-pre-wrap">{request.note}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">{t('reqChanges')}</p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('reqNoChanges')}</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {rows.map((r) => {
                    const current = formatRequestValue(contact?.[r.field])
                    const changed = current !== r.requested
                    return (
                      <div key={r.field} className="px-3 py-2">
                        <p className="text-xs font-medium">{t(`reqf_${r.field}`)}</p>
                        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
                          <div className="min-w-0">
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                              {t('reqCurrent')}
                            </span>
                            <p className="truncate text-muted-foreground">
                              {current || t('reqEmptyValue')}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                              {t('reqRequested')}
                            </span>
                            <p className={`truncate ${changed ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                              {r.requested || t('reqEmptyValue')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{t('reqError')}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => act('discard')} disabled={busy !== null}>
            {busy === 'discard' ? t('reqProcessing') : t('reqDiscard')}
          </Button>
          <Button onClick={() => act('approve')} disabled={busy !== null}>
            {busy === 'approve' ? t('reqProcessing') : t('reqApprove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestsTab({ teamId }: { teamId: string }) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: allRequests = [], isLoading } = useContactRequests(teamId)
  const requests = allRequests.filter((r) => (r.status ?? 'pending') === 'pending')
  const [selected, setSelected] = useState<ContactRequest | null>(null)

  if (isLoading) return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )
  if (requests.length === 0) return (
    <div className="py-16 text-center text-muted-foreground text-sm">{t('reqEmpty')}</div>
  )
  return (
    <>
      <div className="rounded-xl border overflow-hidden bg-card">
        {requests.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelected(r)}
            className="flex w-full items-start gap-3 px-4 py-3 border-b last:border-0 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{r.contact_name ?? r.contact_id}</p>
              {r.note && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.note}</p>}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {r.requested_at?.toDate().toLocaleDateString()}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
      <ContactRequestDialog
        request={selected}
        teamId={teamId}
        onClose={() => setSelected(null)}
        onActioned={() => qc.invalidateQueries({ queryKey: ['contact-requests', teamId] })}
      />
    </>
  )
}

// ─── bulk edit dialogs ────────────────────────────────────────────────────────

function BulkSetRankDialog({
  open, onOpenChange, rankingSystems, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  rankingSystems: RankingSystem[]; count: number
  onConfirm: (systemId: string, value: number | null) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const [systemId, setSystemId] = useState(rankingSystems[0]?.id ?? '')
  const [level, setLevel] = useState<number | 'clear' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setSystemId(rankingSystems[0]?.id ?? ''); setLevel(null) }
  }, [open, rankingSystems])

  const system = rankingSystems.find((s) => s.id === systemId)
  const useButtons = (system?.levels.length ?? 0) <= 6

  const handleConfirm = async () => {
    if (!systemId || level === null) return
    setBusy(true)
    try { await onConfirm(systemId, level === 'clear' ? null : level); onOpenChange(false) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('bulkSetRankTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          {rankingSystems.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('bulkRankSystem')}</p>
              <div className="flex flex-wrap gap-1.5">
                {rankingSystems.map((s) => (
                  <button key={s.id}
                    onClick={() => { setSystemId(s.id); setLevel(null) }}
                    className={`px-3 py-1 rounded-lg border text-sm font-medium transition-colors ${
                      systemId === s.id ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >{s.name}</button>
                ))}
              </div>
            </div>
          )}

          {system && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('bulkRankLevel')}</p>
              {useButtons ? (
                <div className="flex flex-wrap gap-1.5">
                  {system.levels.map((l) => (
                    <button key={l.value}
                      onClick={() => setLevel(level === l.value ? null : l.value)}
                      className={`flex items-center gap-1.5 py-1 px-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        level === l.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {l.color && <div className="h-2.5 w-2.5 rounded-full shrink-0 border border-border" style={{ background: l.color }} />}
                      {l.label}
                    </button>
                  ))}
                </div>
              ) : (
                <Select
                  value={typeof level === 'number' ? String(level) : ''}
                  onValueChange={(v) => setLevel(v === '' ? null : Number(v))}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {system.levels.map((l) => (
                      <SelectItem key={l.value} value={String(l.value)}>
                        <span className="flex items-center gap-2">
                          {l.color && <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" style={{ background: l.color }} />}
                          {l.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                onClick={() => setLevel(level === 'clear' ? null : 'clear')}
                className={`text-xs transition-colors ${level === 'clear' ? 'text-destructive font-medium' : 'text-muted-foreground hover:text-destructive'}`}
              >
                {t('bulkClearRank')}
              </button>
            </div>
          )}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || level === null}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkSetSubscriptionDialog({
  open, onOpenChange, subscriptionTypes, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  subscriptionTypes: SubscriptionType[]; count: number
  onConfirm: (type: SubscriptionType | null) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const tSettings = useTranslations('TeamSettings')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) setPicked(null) }, [open])

  const handleConfirm = async () => {
    if (!picked) return
    setBusy(true)
    const type = picked === 'none' ? null : subscriptionTypes.find((s) => s.id === picked) ?? null
    try { await onConfirm(type); onOpenChange(false) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('bulkSetSubscriptionTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-1 py-1 max-h-72 overflow-y-auto">
          <button
            onClick={() => setPicked(picked === 'none' ? null : 'none')}
            className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${picked === 'none' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
          >
            <p className="font-medium text-muted-foreground">{t('bulkSubscriptionNone')}</p>
          </button>
          {subscriptionTypes.map((st) => (
            <button key={st.id}
              onClick={() => setPicked(picked === st.id ? null : st.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${picked === st.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
            >
              <div className="flex items-center gap-2">
                <p className="font-medium flex-1">{st.name}</p>
                <Badge variant={st.source === 'aggregator' ? 'secondary' : 'outline'} className="text-xs shrink-0">
                  {tSettings(st.source === 'aggregator' ? 'subTypeSourceAggregator' : 'subTypeSourceInternal')}
                </Badge>
              </div>
              {st.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{st.description}</p>}
            </button>
          ))}
          {subscriptionTypes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{t('bulkNoSubscriptions')}</p>
          )}
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || !picked}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkPromoteStageDialog({
  open, onOpenChange, count, onConfirm,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  count: number
  onConfirm: (stage: AcquisitionStage) => Promise<void>
}) {
  const t = useTranslations('Contacts')
  const [selected, setSelected] = useState<AcquisitionStage | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) setSelected(null) }, [open])

  const handleConfirm = async () => {
    if (!selected) return
    setBusy(true)
    try { await onConfirm(selected); onOpenChange(false) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>{t('bulkSetStageTitle')}</DialogTitle></DialogHeader>
        <div className="py-1">
          <div className="flex gap-2">
            {(ACQUISITION_STAGES as readonly AcquisitionStage[]).map((v) => (
              <button key={v}
                onClick={() => setSelected(selected === v ? null : v)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  selected === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`stage_${v}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">{t('cancel')}</button>
          <button onClick={handleConfirm} disabled={busy || !selected}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            {t('bulkApplyTo', { count })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── bulk action bar ──────────────────────────────────────────────────────────

interface MoreAction {
  label: string
  icon: React.ElementType
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

function BulkBar({
  count, tab, onArchive, onDelete, onRestore, onConfirm, onClear, moreActions = [], editActions = [],
}: {
  count: number; tab: TabId
  onArchive?: () => void; onDelete?: () => void; onRestore?: () => void
  /** Unconfirmed tab: manually confirm provisional contacts (clears the purge deadline). */
  onConfirm?: () => void
  onClear: () => void
  moreActions?: MoreAction[]
  editActions?: MoreAction[]
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border rounded-full shadow-lg px-4 py-2">
      <span className="text-sm font-medium mr-2">{t('bulkSelected', { count })}</span>

      {editActions.length > 0 && (
        <>
          <Popover>
            <PopoverTrigger className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors">
              <Pencil className="h-3.5 w-3.5" />
              {t('bulkEditFields')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-52 p-1">
              {editActions.map((action) => (
                <button key={action.label} onClick={action.onClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors text-left">
                  <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {action.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
        </>
      )}

      {onConfirm && (
        <button onClick={onConfirm}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors">
          <UserCheck className="h-3.5 w-3.5" />{t('bulkConfirm')}
        </button>
      )}
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

      {moreActions.length > 0 && (
        <>
          <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
          <Popover>
            <PopoverTrigger
              className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground"
              aria-label={t('bulkMore')}
            >
              <MoreHorizontal className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-52 p-1">
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.disabled ? undefined : action.onClick}
                  disabled={action.disabled}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    action.disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : action.destructive
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'hover:bg-muted'
                  }`}
                >
                  <action.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{action.label}</span>
                  {action.disabled && (
                    <span className="text-xs text-muted-foreground">{tCommon('comingSoon')}</span>
                  )}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </>
      )}

      <button onClick={onClear}
        className="p-1.5 rounded-full hover:bg-muted transition-colors ml-0.5 text-muted-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── tab types ────────────────────────────────────────────────────────────────

type TabId = 'active' | 'leads' | 'archived' | 'deleted' | 'requests'

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { currentTeamId, user, team } = useAuth()
  const { isAtLeast, plan } = usePlan()
  const { ownScoped } = useCapabilities()
  const { openUpgradeModal } = useUpgradeModal()
  const qc = useQueryClient()
  const t = useTranslations('Contacts')

  // Coaches (own-scoped) see only their assigned contacts and have no
  // archived/deleted admin views (those queries would be denied by the rules).
  const coachScopeUid = ownScoped ? (user?.uid ?? null) : null
  const { data: allActive = [], isLoading: loadingActive } = useActiveContacts(currentTeamId, coachScopeUid)
  // PROVISIONAL contacts — the not-yet-materialized leads (shop registrations
  // awaiting payment, trial bookings never attended, form leads) — live in the
  // "Leads" tab and don't count toward the plan cap; the Active tab therefore
  // equals the counted roster. Mirrors server-side canCreateContact (contactCap.ts).
  const active = useMemo(() => allActive.filter((c) => c.provisional !== true), [allActive])
  const leads = useMemo(() => allActive.filter((c) => c.provisional === true), [allActive])
  const { data: archived = [], isLoading: loadingArchived } = useArchivedContacts(ownScoped ? null : currentTeamId)
  const { data: deleted = [], isLoading: loadingDeleted } = useDeletedContacts(ownScoped ? null : currentTeamId)
  const { data: requests = [] } = useContactRequests(currentTeamId)
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(currentTeamId)
  const { isInstalled } = useInstalledPlugins()
  const groupsEnabled = isInstalled('contact-groups')
  const { data: contactGroups = [] } = useContactGroups(groupsEnabled ? currentTeamId : null)
  const inOrg = !!team?.org_id

  // Contact cap usage: counts active = non-archived, non-deleted. Over-cap
  // behaviour is tier-specific (contactOverageForPlan) and never per-contact
  // metered: Free hard-blocks manual adds (portal signups still land), Coach is
  // prompted to upgrade, Studio can buy +contact blocks. Org is unlimited.
  const usage = contactUsageForPlan(plan, active.length)
  const overage = contactOverageForPlan(plan)
  const freeCapBlocked = planHasHardContactCap(plan) && usage.atOrOverLimit && !loadingActive
  const planIdx = plan ? PLAN_ORDER.indexOf(plan) : -1
  const nextPlan: SaasPlan | null = planIdx >= 0 && planIdx < PLAN_ORDER.length - 1 ? PLAN_ORDER[planIdx + 1] : null

  const [tab, setTab] = useState<TabId>('active')
  // The Unconfirmed tab only exists while provisional contacts do — hop back to
  // Active when the last one is confirmed/deleted (its tab entry disappears).
  useEffect(() => {
    if (tab === 'leads' && !loadingActive && leads.length === 0) setTab('active')
  }, [tab, loadingActive, leads.length])
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)

  // The create dialog always opens — at the Free hard cap it restricts the entry
  // choice to 'booking' (a non-counting provisional lead) instead of blocking.
  const openCreateDialog = () => setDialogOpen(true)
  const [bulkEditMode, setBulkEditMode] = useState<'rank' | 'subscription' | 'stage' | 'group-add' | 'group-remove' | null>(null)

  // confirm dialogs
  const [confirmArchive, setConfirmArchive] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string[]>([])
  const [confirmRestore, setConfirmRestore] = useState<string[]>([])

  const invalidateContacts = () => qc.invalidateQueries({ queryKey: ['contacts'] })
  const invalidateAll = () => { invalidateContacts(); setSelected(new Set()) }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── filter + search ───────────────────────────────────────────────────────

  function applyFiltersAndSearch(list: Contact[], f: Filters, q: string): Contact[] {
    let result = list

    if (f.stages.length > 0)
      result = result.filter((c) => c.acquisition_stage && f.stages.includes(c.acquisition_stage))

    if (f.sources.length > 0)
      result = result.filter((c) => c.source && f.sources.includes(c.source))

    // Affiliation filter: statuses now carries 'active' (has_active) or 'none' (not affiliated)
    if (f.statuses.length > 0)
      result = result.filter((c) => {
        if (f.statuses.includes('active') && !f.statuses.includes('none')) {
          return c.affiliation_summary?.has_active === true
        }
        if (f.statuses.includes('none') && !f.statuses.includes('active')) {
          return !c.affiliation_summary?.has_active
        }
        return true // both selected = no filter
      })

    if (f.subscriptions.length > 0) {
      result = result.filter((c) => {
        if (f.subscriptions.includes('none')) {
          if (!c.subscription_type_id) return true
        }
        return c.subscription_type_id && f.subscriptions.includes(c.subscription_type_id)
      })
    }

    if (f.groups.length > 0) {
      // Selecting a parent group also matches members of its subgroups
      const wanted = expandGroupSelection(contactGroups, f.groups)
      result = result.filter((c) => (c.group_ids ?? []).some((gid) => wanted.has(gid)))
    }

    if (f.hasAlerts)
      result = result.filter((c) => (c.alerts_count ?? 0) > 0)

    if (f.pendingSignup)
      result = result.filter((c) => c.pending_signup === true)

    if (f.sessionsMin != null)
      result = result.filter((c) => (c.total_sessions ?? 0) >= f.sessionsMin!)
    if (f.sessionsMax != null)
      result = result.filter((c) => (c.total_sessions ?? 0) <= f.sessionsMax!)

    if (f.inactivity) {
      const now = Date.now()
      result = result.filter((c) => {
        const last = c.last_session_at
          ? (c.last_session_at as { toDate(): Date }).toDate().getTime()
          : null
        if (f.inactivity === 'never') return last === null
        const days = f.inactivity === '30d' ? 30 : f.inactivity === '60d' ? 60 : 90
        const cutoff = now - days * 86400000
        return last === null || last < cutoff
      })
    }

    if (f.rankFilter && Object.values(f.rankFilter).some((l) => l.length > 0)) {
      result = result.filter((c) =>
        Object.entries(f.rankFilter!).some(([systemId, levels]) => {
          const rank = c.ranks?.[systemId]
          return rank != null && levels.includes(rank)
        })
      )
    }

    // Engagement band — derived on the fly from attendance recency (last attended
    // session, falling back to join date), measured against the team's thresholds.
    if (f.engagement.length > 0) {
      const now = Date.now()
      const thresholds = team?.engagement_thresholds
      result = result.filter((c) => {
        const refMs = tsToDate(c.last_session_at)?.getTime() ?? tsToDate(c.created_at)?.getTime() ?? null
        return f.engagement.includes(computeEngagementBand(refMs, thresholds, now))
      })
    }

    const sq = q.trim().toLowerCase()
    if (sq)
      result = result.filter((c) =>
        `${c.firstname} ${c.lastname}`.toLowerCase().includes(sq) ||
        (c.email ?? '').toLowerCase().includes(sq)
      )

    return result
  }

  /* eslint-disable react-hooks/exhaustive-deps -- applyFiltersAndSearch closes over contactGroups + team thresholds */
  const engagementThresholds = team?.engagement_thresholds
  const filteredActive   = useMemo(() => applyFiltersAndSearch(active,   filters, search), [active,   filters, search, contactGroups, engagementThresholds])
  const filteredLeads = useMemo(() => applyFiltersAndSearch(leads, filters, search), [leads, filters, search, contactGroups, engagementThresholds])
  const filteredArchived = useMemo(() => applyFiltersAndSearch(archived, filters, search), [archived, filters, search, contactGroups, engagementThresholds])
  const filteredDeleted  = useMemo(() => applyFiltersAndSearch(deleted,  filters, search), [deleted,  filters, search, contactGroups, engagementThresholds])
  /* eslint-enable react-hooks/exhaustive-deps */

  // ── current list & loading state ──────────────────────────────────────────

  const currentList =
    tab === 'active' ? filteredActive
    : tab === 'leads' ? filteredLeads
    : tab === 'archived' ? filteredArchived
    : filteredDeleted
  const isLoading =
    tab === 'active' || tab === 'leads' ? loadingActive
    : tab === 'archived' ? loadingArchived
    : loadingDeleted

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

  // Manually confirm provisional (shop-registered) contacts — the "keep" action of
  // the Unconfirmed tab. Clears the flags so the purge task leaves them alone;
  // normally a first payment does this via the webhook.
  const confirmProvisional = async (ids: string[]) => {
    await Promise.all(ids.map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        provisional: deleteField(),
        provisional_expires_at: deleteField(),
      })
    ))
    invalidateAll()
  }

  const { data: orgRankingSystems } = useOrgRankingSystems(team?.org_id)
  // Org-level ranking systems override team-level ones (per CLAUDE.md spec)
  const rankingSystems = orgRankingSystems ?? team?.ranking_systems ?? []

  const bulkSetRank = async (systemId: string, value: number | null) => {
    const fieldKey = `ranks.${systemId}`
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        [fieldKey]: value !== null ? value : deleteField(),
        updatedAt: serverTimestamp(),
      })
    ))
    invalidateContacts()
  }

  const bulkSetSubscription = async (type: SubscriptionType | null) => {
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        subscription_type_id: type?.id ?? null,
        subscription_type_name: type?.name ?? null,
        // Assigning a subscription materializes a provisional lead (offline-paid
        // members count toward the cap too). See Contact.provisional.
        ...(type ? { provisional: deleteField(), provisional_expires_at: deleteField() } : {}),
        updatedAt: serverTimestamp(),
      })
    ))
    invalidateContacts()
  }

  const bulkGroupUpdate = async (groupId: string, op: 'add' | 'remove') => {
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        group_ids: op === 'add' ? arrayUnion(groupId) : arrayRemove(groupId),
      })
    ))
    invalidateContacts()
  }

  const bulkPromoteStage = async (stage: AcquisitionStage) => {
    const now = serverTimestamp()
    await Promise.all([...selected].map((id) =>
      updateDoc(doc(db, CONTACTS_COLLECTION, id), {
        acquisition_stage: stage,
        acquisition_stage_updated_at: now,
        ...(stage === 'trial_attended' ? { trial_attended_at: now } : {}),
        ...(stage === 'joined' ? { converted_at: now } : {}),
        // Promoting past 'trial_booked' MATERIALIZES a provisional lead — it now
        // counts toward the contact cap. See Contact.provisional.
        ...(stage === 'trial_attended' || stage === 'joined'
          ? { provisional: deleteField(), provisional_expires_at: deleteField() }
          : {}),
        updatedAt: now,
      })
    ))
    invalidateContacts()
  }

  // ── select all ────────────────────────────────────────────────────────────

  const allSelected = currentList.length > 0 && (currentList as Contact[]).every((c) => selected.has(c.id))
  const someSelected = !allSelected && (currentList as Contact[]).some((c) => selected.has(c.id))
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set((currentList as Contact[]).map((c) => c.id)))
    }
  }

  // ── tabs ──────────────────────────────────────────────────────────────────

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: 'active',   label: t('tabActive'),   count: active.length },
    // Leads = ALL provisional contacts (trial bookings never attended, form leads,
    // shop registrations awaiting payment) — the cap-exclusion set. Shown whenever
    // any exist, INCLUDING for own-scoped coaches (their assigned leads live here).
    ...(leads.length === 0
      ? []
      : [{ id: 'leads' as TabId, label: t('tabLeads'), count: leads.length }]),
    // Archived/deleted are studio-admin views — hidden for own-scoped coaches.
    ...(ownScoped ? [] : [{ id: 'archived' as TabId, label: t('tabArchived'), count: archived.length }]),
    ...(ownScoped ? [] : [{ id: 'deleted' as TabId, label: t('tabDeleted'), count: deleted.length }]),
    { id: 'requests', label: t('tabRequests'),  count: requests.filter((r) => (r.status ?? 'pending') === 'pending').length },
  ]

  const selectable = tab === 'active' || tab === 'leads' || tab === 'archived' || tab === 'deleted'
  const selectedList = [...selected]

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <SectionIntro sectionKey="contacts" />
          </div>
          {!loadingActive && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle', {
                total: active.length + archived.length,
                active: active.filter((c) => c.affiliation_summary?.has_active === true).length,
              })}
            </p>
          )}
          {!loadingActive && !usage.isUnlimited && (
            <div className="mt-1.5 flex items-center gap-2 max-w-xs">
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${usage.atOrOverLimit ? 'bg-destructive' : 'bg-primary'}`}
                  style={{ width: `${usage.percent}%` }}
                />
              </div>
              <span className={`text-xs tabular-nums ${usage.atOrOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                {t('usageMeter', { used: usage.used, included: usage.included ?? 0 })}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={openCreateDialog}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          {t('addContact')}
        </button>
      </div>

      {/* Contact-cap warning. Tier-specific, never per-contact metered: Free
          hard-blocks (portal signups still arrive), Coach is prompted to
          upgrade, Studio can buy +contact blocks. Org is unlimited (no banner). */}
      {!loadingActive && usage.atOrOverLimit && !usage.isUnlimited && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] px-4 py-3 flex items-start justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">{t('capWarnTitle')}</p>
            <p className="text-muted-foreground">
              {overage.kind === 'hard'
                ? t('capWarnBodyFreeHard', { used: usage.used, included: usage.included ?? 0 })
                : overage.kind === 'block'
                  ? t('capWarnBodyBlock', {
                      used: usage.used,
                      included: usage.included ?? 0,
                      blockSize: overage.block.size,
                      blockPrice: overage.block.monthly,
                    })
                  : t('capWarnBodyUpgrade', { used: usage.used, included: usage.included ?? 0 })}
            </p>
          </div>
          {nextPlan && (
            <button
              type="button"
              onClick={() => openUpgradeModal({ minPlan: nextPlan })}
              className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {t('capWarnCta')}
            </button>
          )}
        </div>
      )}

      {/* Overview — collapsed by default, always visible */}
      <OverviewPanel
        contacts={active}
        loading={loadingActive}
        rankingSystems={team?.ranking_systems}
        engagementThresholds={team?.engagement_thresholds}
      />

      {/* Search — sticky, clears with × */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9 h-11 bg-white dark:bg-zinc-900"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {tab !== 'requests' && (
        <FilterChips
          filters={filters}
          onChange={setFilters}
          subscriptionTypes={subscriptionTypes}
          teamId={currentTeamId}
          rankingSystems={rankingSystems}
          contactGroups={groupsEnabled ? contactGroups : null}
        />
      )}

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
          {/* Select-all header */}
          {!isLoading && currentList.length > 0 && selectable && (
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="font-medium tabular-nums">{currentList.length}</span>
                {selected.size > 0 ? t('selectAllCount', { count: selected.size, total: currentList.length }) : t('selectAll')}
              </span>
              <label className="cursor-pointer pr-0.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-border"
                />
              </label>
            </div>
          )}

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
              {search || filters.stages.length || filters.sources.length || filters.statuses.length ? t('emptySearch') : t('empty')}
            </div>
          )}

          {!isLoading && tab !== 'deleted' && (currentList as Contact[]).map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              selectable={selectable}
              selected={selected.has(c.id)}
              onSelect={toggleSelect}
              rankingSystems={rankingSystems}
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
          onClick={openCreateDialog}
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
          onArchive={tab === 'active' || tab === 'leads' ? () => setConfirmArchive(selectedList) : undefined}
          onConfirm={tab === 'leads' ? () => confirmProvisional(selectedList) : undefined}
          onRestore={tab === 'archived' || tab === 'deleted' ? () => setConfirmRestore(selectedList) : undefined}
          onDelete={tab !== 'deleted' ? () => setConfirmDelete(selectedList) : undefined}
          onClear={() => setSelected(new Set())}
          editActions={tab !== 'deleted' ? [
            ...(rankingSystems.length > 0 ? [{ label: t('bulkSetRank'), icon: Award, onClick: () => setBulkEditMode('rank') }] : []),
            { label: t('bulkSetSubscription'), icon: CreditCard, onClick: () => setBulkEditMode('subscription') },
            { label: t('bulkSetStage'), icon: Tag, onClick: () => setBulkEditMode('stage') },
            ...(groupsEnabled ? [
              { label: t('bulkAddToGroup'),      icon: FolderTree, onClick: () => setBulkEditMode('group-add') },
              { label: t('bulkRemoveFromGroup'), icon: FolderTree, onClick: () => setBulkEditMode('group-remove') },
            ] : []),
          ] : []}
          moreActions={tab === 'active' && isAtLeast('studio') ? [
            { label: t('bulkMove'),     icon: ArrowRightLeft, onClick: () => {}, disabled: true },
            { label: t('bulkOutreach'), icon: Mail,           onClick: () => {}, disabled: true },
          ] : []}
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
          atHardCap={freeCapBlocked}
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

      <BulkSetRankDialog
        open={bulkEditMode === 'rank'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        rankingSystems={rankingSystems}
        count={selected.size}
        onConfirm={bulkSetRank}
      />

      <BulkSetSubscriptionDialog
        open={bulkEditMode === 'subscription'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        subscriptionTypes={subscriptionTypes}
        count={selected.size}
        onConfirm={bulkSetSubscription}
      />

      <BulkPromoteStageDialog
        open={bulkEditMode === 'stage'}
        onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
        count={selected.size}
        onConfirm={bulkPromoteStage}
      />

      {groupsEnabled && (
        <BulkGroupsDialog
          open={bulkEditMode === 'group-add' || bulkEditMode === 'group-remove'}
          onOpenChange={(v) => { if (!v) setBulkEditMode(null) }}
          mode={bulkEditMode === 'group-remove' ? 'remove' : 'add'}
          groups={contactGroups}
          count={selected.size}
          onConfirm={(groupId) => bulkGroupUpdate(groupId, bulkEditMode === 'group-remove' ? 'remove' : 'add')}
        />
      )}
    </div>
  )
}
