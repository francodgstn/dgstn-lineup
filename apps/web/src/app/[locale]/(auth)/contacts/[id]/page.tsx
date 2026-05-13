'use client'

import { useState, use, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  doc, getDoc, updateDoc, collection, query, where, orderBy, collectionGroup,
  getDocs, addDoc, deleteDoc, serverTimestamp, Timestamp, limit,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import {
  CONTACTS_COLLECTION, TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION,
  CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION, CONTACT_ALERTS_SUBCOLLECTION,
  ALERT_PRESETS_SUBCOLLECTION, TEAM_ACTIVITY_LOG_SUBCOLLECTION,
  CONTACT_WEEKLY_REPORTS_SUBCOLLECTION,
} from '@lineup/shared'
import type {
  Contact, MembershipStatus, ContactType, ContactGender,
  SubscriptionType, SubscriptionHistoryEntry, ContactAlert, AlertScheduleType,
  RankingSystem, ActivityLogEntry, ActivityEventType,
} from '@lineup/shared'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft, CalendarDays, Mail, Phone, StickyNote, Star, Flame,
  BookOpen, Award, ChevronDown, ChevronUp, Plus, Trash2, Trophy,
  Bell, Timer, Activity, ArchiveRestore, AlertTriangle,
  UserPlus, Archive, RotateCcw, ArrowRightLeft, CheckCircle, XCircle,
  CalendarCheck, CalendarX, CreditCard, BarChart2, Lock,
} from 'lucide-react'
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary', requested: 'outline', under_review: 'outline',
  almost_ready: 'outline', active: 'default', expired: 'destructive',
}

function formatDate(ts: { toDate(): Date } | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

function tsToDate(ts: unknown): Date | undefined {
  if (!ts) return undefined
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && 'toDate' in (ts as object)) return (ts as { toDate(): Date }).toDate()
  return undefined
}

// ─── schema ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  firstname: z.string().min(1).max(60),
  lastname: z.string().min(1).max(60),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  gender: z.enum(['M', 'F', 'other']).optional(),
  birthdate: z.date().optional(),
  birthplace: z.string().max(100).optional(),
  weight: z.coerce.number().min(0).max(500).optional(),
  type: z.enum(['trial', 'student', 'external']).optional(),
  membership_status: z.enum(['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']).optional(),
  subscription_type_id: z.string().optional(),
  subscription_recurrence: z.string().optional(),
  address_route: z.string().max(100).optional(),
  address_street_number: z.string().max(20).optional(),
  address_postal_code: z.string().max(20).optional(),
  address_locality: z.string().max(100).optional(),
  acquisition_channel: z.string().max(100).optional(),
  acquisition_notes: z.string().max(500).optional(),
  ranks: z.record(z.string(), z.number()).optional(),
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

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION)
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionType)
    },
  })
}

function useTeamRankingSystems(teamId: string | null) {
  return useQuery<RankingSystem[]>({
    queryKey: ['team-ranking-systems', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return (snap.data()?.ranking_systems as RankingSystem[] | undefined) ?? []
    },
  })
}

function useSubscriptionHistory(contactId: string) {
  return useQuery<SubscriptionHistoryEntry[]>({
    queryKey: ['subscription-history', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION),
          orderBy('start_date', 'desc'),
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionHistoryEntry)
    },
  })
}

interface BookingSummary {
  id: string
  sessionId: string
  sessionLabel: string
  sessionStart: { toDate(): Date } | null
  joinedAt: { toDate(): Date } | null
}

function useContactBookings(contactId: string, teamId: string | null) {
  return useQuery<BookingSummary[]>({
    queryKey: ['contact-bookings', contactId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collectionGroup(db, 'bookings'),
          where('teamId', '==', teamId),
          where('contactId', '==', contactId),
          orderBy('joinedAt', 'desc'),
        )
      )
      return snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          sessionId: d.ref.parent.parent?.id ?? '',
          sessionLabel: data.sessionLabel ?? data.activityName ?? 'Session',
          sessionStart: data.sessionStart ?? null,
          joinedAt: data.joinedAt ?? null,
        }
      })
    },
  })
}

const PAGE_SIZE = 50

function useContactActivityLog(contactId: string, teamId: string | null) {
  return useQuery<ActivityLogEntry[]>({
    queryKey: ['contact-activity-log', contactId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, TEAM_ACTIVITY_LOG_SUBCOLLECTION),
          where('refs.contact', '==', contactId),
          orderBy('created_at', 'desc'),
          limit(PAGE_SIZE),
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityLogEntry)
    },
  })
}

interface RecentSession { id: string; joinedAt: { toDate(): Date } | null }

function useContactRecentSessions(contactId: string, count: number) {
  return useQuery<RecentSession[]>({
    queryKey: ['contact-recent-sessions', contactId, count],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collectionGroup(db, 'participants'),
          where('contactId', '==', contactId),
          orderBy('joinedAt', 'desc'),
          limit(count),
        )
      )
      return snap.docs.map((d) => ({ id: d.id, joinedAt: d.data().joinedAt ?? null }))
    },
  })
}

interface WeeklyReport { iso_week: string; sessions_count: number }

function useContactWeeklyReports(contactId: string) {
  return useQuery<WeeklyReport[]>({
    queryKey: ['contact-weekly-reports', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_WEEKLY_REPORTS_SUBCOLLECTION),
          orderBy('iso_week', 'desc'),
          limit(16),
        )
      )
      return snap.docs
        .map((d) => ({ iso_week: d.data().iso_week as string, sessions_count: (d.data().sessions_count as number) ?? 0 }))
        .reverse()
    },
  })
}

function useContactAlerts(contactId: string) {
  return useQuery<ContactAlert[]>({
    queryKey: ['contact-alerts', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_ALERTS_SUBCOLLECTION),
          orderBy('created_at', 'desc'),
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContactAlert)
    },
  })
}

interface AlertPresetRecord {
  id: string
  name: string
  schedule_type: AlertScheduleType
  schedule_value?: number
  message: string
  show_in_app?: boolean
}

function useAlertPresets(teamId: string | null) {
  return useQuery<AlertPresetRecord[]>({
    queryKey: ['alert-presets', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId, ALERT_PRESETS_SUBCOLLECTION))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AlertPresetRecord)
    },
  })
}

// ─── field wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, children, error }: {
  label: string; required?: boolean; children: React.ReactNode; error?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-1">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ─── read-only detail row ─────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value || '—'}</span>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-4 pb-1 first:pt-0">
      {children}
    </h3>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function FormBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

// ─── header stats panel ───────────────────────────────────────────────────────

type StatsPanelTab = 'attendance' | 'training'

function isoWeekLabel(isoWeek: string) {
  // "2024-W03" → parse to a date and show "Jan 15"
  const [year, week] = isoWeek.split('-W').map(Number)
  if (!year || !week) return isoWeek
  // ISO week 1 is the week containing Jan 4
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const weekStart = new Date(jan4)
  weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7)
  return weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function StatsPanel({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const [panelTab, setPanelTab] = useState<StatsPanelTab>('attendance')
  const { data: weeklyReports = [], isLoading: reportsLoading } = useContactWeeklyReports(contact.id)

  const chartData = weeklyReports.map((r) => ({
    label: isoWeekLabel(r.iso_week),
    sessions: r.sessions_count,
  }))

  return (
    <div className="flex flex-col h-full">
      {/* Tab strip */}
      <div className="flex border-b shrink-0">
        {(['attendance', 'training'] as StatsPanelTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setPanelTab(tab)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              panelTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'attendance' ? t('statsPanelAttendance') : t('statsPanelTraining')}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {panelTab === 'attendance' && (
          <div>
            {/* Trend chart */}
            <div className="pt-3 px-1">
              {reportsLoading ? (
                <div className="h-[90px] rounded-md bg-muted animate-pulse" />
              ) : chartData.length === 0 ? (
                <div className="h-[90px] flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">{t('noActivity')}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={90}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
                      formatter={(v) => [v, t('statTotalSessions')]}
                      labelStyle={{ display: 'none' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="sessions"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Key stats */}
            <div className="grid grid-cols-3 gap-2 text-center px-4 py-3 border-t">
              <div>
                <p className="text-xl font-bold tabular-nums">{contact.total_sessions ?? 0}</p>
                <p className="text-[10px] leading-tight text-muted-foreground mt-0.5">{t('statTotalSessions')}</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">
                  {contact.current_streak ?? 0}<span className="text-xs font-normal">w</span>
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground mt-0.5">{t('statStreak')}</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">{contact.current_month_score ?? 0}</p>
                <p className="text-[10px] leading-tight text-muted-foreground mt-0.5">{t('statMonthScore')}</p>
              </div>
            </div>
          </div>
        )}

        {panelTab === 'training' && (
          <div className="flex flex-col items-center justify-center gap-3 h-full min-h-[160px] px-5 py-6 text-center">
            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('trainingProfileLockedTitle')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('trainingProfileLockedDesc')}</p>
            </div>
            <button
              type="button"
              className="mt-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              {t('upgradeToClub')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MobileStatsToggle({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const [open, setOpen] = useState(false)
  return (
    <div className="lg:hidden border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4" />
          {t('statsPanelTitle')}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-5">
          <StatsPanel contact={contact} teamId={teamId} />
        </div>
      )}
    </div>
  )
}

// ─── profile tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  contact, teamId, onSaved,
}: {
  contact: Contact; teamId: string | null; onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const { data: subTypes = [] } = useSubscriptionTypes(teamId)
  const { data: rankingSystems = [] } = useTeamRankingSystems(teamId)

  const TYPES: ContactType[] = ['trial', 'student', 'external']
  const STATUSES: MembershipStatus[] = ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']
  const GENDERS: ContactGender[] = ['M', 'F', 'other']

  const RECURRENCES = ['per_class', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

  const { register, handleSubmit, control, formState: { errors, isSubmitting, isDirty } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstname: contact.firstname,
      lastname: contact.lastname,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      gender: contact.gender,
      birthdate: tsToDate(contact.birthdate),
      birthplace: contact.birthplace ?? '',
      weight: contact.weight,
      type: contact.type,
      membership_status: contact.membership_status,
      subscription_type_id: contact.subscription_type_id ?? '',
      subscription_recurrence: contact.subscription_recurrence ?? '',
      address_route: contact.address?.route ?? '',
      address_street_number: contact.address?.street_number ?? '',
      address_postal_code: contact.address?.postal_code ?? '',
      address_locality: contact.address?.locality ?? '',
      acquisition_channel: contact.acquisition?.channel ?? '',
      acquisition_notes: contact.acquisition?.notes ?? '',
      ranks: contact.ranks ?? {},
    },
  })

  const onSubmit = async (values: ProfileValues) => {
    await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      gender: values.gender || null,
      birthdate: values.birthdate ? Timestamp.fromDate(values.birthdate) : null,
      birthplace: values.birthplace || null,
      weight: values.weight || null,
      type: values.type || null,
      membership_status: values.membership_status || 'guest',
      subscription_type_id: values.subscription_type_id || null,
      subscription_recurrence: values.subscription_recurrence || null,
      address: {
        route: values.address_route || null,
        street_number: values.address_street_number || null,
        postal_code: values.address_postal_code || null,
        locality: values.address_locality || null,
      },
      acquisition: {
        channel: values.acquisition_channel || null,
        notes: values.acquisition_notes || null,
        acknowledged: contact.acquisition?.acknowledged ?? false,
      },
      ranks: values.ranks ?? {},
      updatedAt: serverTimestamp(),
    })
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-24">
      {/* Contact type — segmented control, full width */}
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('colType')}</p>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div className="inline-flex items-center rounded-lg border bg-background p-1 gap-0.5">
              {TYPES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => field.onChange(v)}
                  className={`px-4 py-1 rounded-md text-sm font-medium transition-all duration-150 ${
                    field.value === v
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`type_${v}`)}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* 2-col section blocks on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* Subscription & membership */}
        <FormBlock title={t('sectionMembership')}>
          <Field label={t('colStatus')}>
            <Controller
              control={control}
              name="membership_status"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value ? t(`status_${field.value}`) : <span className="text-muted-foreground">—</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`status_${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {subTypes.length > 0 && (
            <Field label={t('subscriptionTypeName')}>
              <Controller
                control={control}
                name="subscription_type_id"
                render={({ field }) => {
                  const selected = subTypes.find((st) => st.id === field.value)
                  return (
                    <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                      <SelectTrigger className="w-full">
                        <span className="flex flex-1 text-left text-sm truncate">
                          {selected ? selected.name : <span className="text-muted-foreground">—</span>}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        {subTypes.filter((st) => st.active !== false).map((st) => (
                          <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                }}
              />
            </Field>
          )}
          <Field label={t('subscriptionRecurrence')}>
            <Controller
              control={control}
              name="subscription_recurrence"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value ? t(`recurrence_${field.value}`) : <span className="text-muted-foreground">—</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {RECURRENCES.map((r) => (
                      <SelectItem key={r} value={r}>{t(`recurrence_${r}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </FormBlock>

        {/* Personal information */}
        <FormBlock title={t('sectionPersonalInfo')}>
          <Field label={t('fieldFirstname')} required error={errors.firstname?.message}>
            <Input {...register('firstname')} autoCapitalize="words" />
          </Field>
          <Field label={t('fieldLastname')} required error={errors.lastname?.message}>
            <Input {...register('lastname')} autoCapitalize="words" />
          </Field>
          <Field label={t('fieldGender')}>
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val || undefined)}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {field.value ? t(`gender_${field.value}`) : <span className="text-muted-foreground">—</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>{t(`gender_${g}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label={t('fieldBirthdate')}>
            <Controller
              control={control}
              name="birthdate"
              render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
            />
          </Field>
          <Field label={t('fieldBirthplace')}>
            <Input {...register('birthplace')} />
          </Field>
          <Field label={t('fieldWeight')}>
            <Input type="number" step="0.1" min="0" max="500" inputMode="decimal" {...register('weight')} />
          </Field>
        </FormBlock>

        {/* Ranks */}
        {rankingSystems.length > 0 && (
          <FormBlock title={t('sectionRanks')}>
            <Controller
              control={control}
              name="ranks"
              render={({ field }) => (
                <div className="space-y-3">
                  {rankingSystems.map((system) => {
                    const currentValue = field.value?.[system.id]
                    const useButtons = system.levels.length <= 6
                    return (
                      <div key={system.id} className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {system.name}
                          {system.is_primary && <span className="ml-1.5 text-primary">·</span>}
                        </p>
                        {useButtons ? (
                          <div className="flex flex-wrap gap-1.5">
                            {system.levels.map((level) => {
                              const selected = currentValue === level.value
                              return (
                                <button
                                  key={level.value}
                                  type="button"
                                  onClick={() => {
                                    const next = { ...field.value }
                                    if (selected) { delete next[system.id] } else { next[system.id] = level.value }
                                    field.onChange(next)
                                  }}
                                  className={`flex items-center gap-1.5 py-1 px-2.5 rounded-lg border text-sm font-medium transition-colors ${
                                    selected
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-background text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  <div className="h-2.5 w-2.5 rounded-full shrink-0 border border-border" style={{ background: level.color }} />
                                  {level.label}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <Select
                            value={currentValue !== undefined ? String(currentValue) : ''}
                            onValueChange={(val) => {
                              const next = { ...field.value }
                              if (val === '') { delete next[system.id] } else { next[system.id] = Number(val) }
                              field.onChange(next)
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <span className="flex flex-1 text-left text-sm truncate">
                                {currentValue !== undefined
                                  ? (() => {
                                      const lvl = system.levels.find((l) => l.value === currentValue)
                                      return lvl ? (
                                        <span className="flex items-center gap-2">
                                          {lvl.color && <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 border border-border" style={{ background: lvl.color }} />}
                                          {lvl.label}
                                        </span>
                                      ) : String(currentValue)
                                    })()
                                  : <span className="text-muted-foreground">—</span>}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">—</SelectItem>
                              {system.levels.map((level) => (
                                <SelectItem key={level.value} value={String(level.value)}>
                                  <span className="flex items-center gap-2">
                                    {level.color && (
                                      <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 border border-border" style={{ background: level.color }} />
                                    )}
                                    {level.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            />
          </FormBlock>
        )}

        {/* Contact */}
        <FormBlock title={t('sectionContact')}>
          <Field label={t('colEmail')}>
            <Input type="email" {...register('email')} inputMode="email" />
          </Field>
          <Field label={t('fieldPhone')}>
            <Input type="tel" {...register('phone')} inputMode="tel" />
          </Field>
          <Field label={t('fieldStreet')}>
            <Input {...register('address_route')} />
          </Field>
          <Field label={t('fieldStreetNumber')}>
            <Input {...register('address_street_number')} />
          </Field>
          <Field label={t('fieldPostalCode')}>
            <Input {...register('address_postal_code')} />
          </Field>
          <Field label={t('fieldLocality')}>
            <Input {...register('address_locality')} />
          </Field>
        </FormBlock>

        {/* Acquisition */}
        <FormBlock title={t('sectionAcquisition')}>
          <Field label={t('fieldAcquisitionChannel')}>
            <Input {...register('acquisition_channel')} />
          </Field>
          <Field label={t('fieldAcquisitionNotes')}>
            <Textarea {...register('acquisition_notes')} rows={3} />
          </Field>
        </FormBlock>

      </div>

      {/* Floating save */}
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? tCommon('loading') : t('saveChanges')}
          </button>
        </div>
      )}
    </form>
  )
}

// ─── notes tab ────────────────────────────────────────────────────────────────

function NotesTab({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [saving, setSaving] = useState(false)
  const isDirty = notes !== (contact.notes ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        notes: notes || null,
        updatedAt: serverTimestamp(),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={12}
        placeholder={t('noNotes')}
        className="resize-none"
      />
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? tCommon('loading') : t('saveChanges')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── bookings tab ─────────────────────────────────────────────────────────────

function BookingsTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const { data: bookings = [], isLoading } = useContactBookings(contact.id, teamId)

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )
  if (bookings.length === 0) return (
    <div className="py-12 text-center text-muted-foreground text-sm">{t('noBookings')}</div>
  )
  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg border">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{b.sessionLabel}</p>
            <p className="text-xs text-muted-foreground">
              {b.sessionStart ? formatDate(b.sessionStart) : b.joinedAt ? formatDate(b.joinedAt) : '—'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── subscriptions tab ────────────────────────────────────────────────────────

function SubscriptionsTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: history = [], isLoading } = useSubscriptionHistory(contact.id)
  const { data: subTypes = [] } = useSubscriptionTypes(teamId)
  const [addOpen, setAddOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscription-history', contact.id] })

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted transition-colors"
        >
          <Plus className="h-4 w-4" />{t('addSubscription')}
        </button>
      </div>

      {history.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">{t('noSubscriptions')}</div>
      ) : (
        <div className="space-y-2">
          {history.map((entry) => {
            const isActive = !entry.end_date
            const typeName = subTypes.find((s) => s.id === entry.subscription_type_id)?.name
              ?? entry.subscription_type_name ?? '—'
            return (
              <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className={`h-2 w-2 rounded-full mt-2 shrink-0 ${isActive ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{typeName}</p>
                    {isActive && <Badge variant="default" className="text-xs">{t('subscriptionActiveLabel')}</Badge>}
                  </div>
                  {entry.recurrence && (
                    <p className="text-xs text-muted-foreground">{entry.recurrence.replace('_', ' ')}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDate(entry.start_date)} – {entry.end_date ? formatDate(entry.end_date) : t('subscriptionEndNone')}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await deleteDoc(doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION, entry.id))
                    invalidate()
                  }}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <AddSubscriptionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        contactId={contact.id}
        subTypes={subTypes}
        onSaved={invalidate}
      />
    </div>
  )
}

function AddSubscriptionDialog({
  open, onOpenChange, contactId, subTypes, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  contactId: string; subTypes: SubscriptionType[]; onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const [typeId, setTypeId] = useState('')
  const [recurrence, setRecurrence] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [saving, setSaving] = useState(false)

  const RECURRENCES = ['per_class', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

  const save = async () => {
    setSaving(true)
    try {
      const typeName = subTypes.find((s) => s.id === typeId)?.name ?? ''
      await addDoc(
        collection(db, CONTACTS_COLLECTION, contactId, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION),
        {
          subscription_type_id: typeId || null,
          subscription_type_name: typeName || null,
          recurrence: recurrence || null,
          start_date: startDate ? Timestamp.fromDate(startDate) : null,
          end_date: endDate ? Timestamp.fromDate(endDate) : null,
          created_at: serverTimestamp(),
        }
      )
      onSaved()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('addSubscription')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {subTypes.length > 0 && (
            <Field label={t('subscriptionTypeName')}>
              <Select value={typeId} onValueChange={(v) => setTypeId(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">—</SelectItem>
                  {subTypes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('subscriptionRecurrence')}>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {RECURRENCES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('subscriptionStart')}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label={t('subscriptionEnd')}>
            <DatePicker value={endDate} onChange={setEndDate} placeholder={t('subscriptionEndNone')} />
          </Field>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
            {t('cancel')}
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? tCommon('loading') : t('saveChanges')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── gamification tab ─────────────────────────────────────────────────────────

function GamificationTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const tG = useTranslations('Gamification')
  const qc = useQueryClient()

  // Load coach badges from team settings
  const { data: team } = useQuery({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const d = await getDoc(doc(db, 'teams', teamId))
      return d.exists() ? d.data() : null
    },
  })

  const coachBadges: Array<{ key: string; label: string }> =
    team?.settings?.gamification?.coach_badges ?? []

  const assignedBadges: string[] = contact.custom_badges ?? []

  const toggleBadge = async (key: string) => {
    const next = assignedBadges.includes(key)
      ? assignedBadges.filter((b) => b !== key)
      : [...assignedBadges, key]
    await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), { custom_badges: next })
    qc.invalidateQueries({ queryKey: ['contact', contact.id] })
  }

  return (
    <div className="space-y-6">
      {/* Score summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.current_month_score ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Star className="h-3 w-3 text-yellow-500" />{tG('sortPoints')}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.current_streak ?? 0}w</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Flame className="h-3 w-3 text-orange-500" />{tG('sortStreak')}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.total_sessions ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />Sessions
          </p>
        </div>
      </div>

      {/* Coach badges */}
      <div>
        <p className="text-sm font-medium mb-3">{tG('coachBadgesSection')}</p>
        {coachBadges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('badgeNone')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coachBadges.map((badge) => {
              const assigned = assignedBadges.includes(badge.key)
              return (
                <button
                  key={badge.key}
                  onClick={() => toggleBadge(badge.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                    assigned
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Award className="h-3.5 w-3.5" />
                  {badge.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── activity tab ─────────────────────────────────────────────────────────────

type EventMeta = { Icon: React.ElementType; bg: string; fg: string }

const EVENT_META: Record<ActivityEventType, EventMeta> = {
  contact_add:                 { Icon: UserPlus,        bg: 'bg-green-500/10',  fg: 'text-green-600'  },
  contact_archive:             { Icon: Archive,         bg: 'bg-yellow-500/10', fg: 'text-yellow-600' },
  contact_unarchive:           { Icon: RotateCcw,       bg: 'bg-green-500/10',  fg: 'text-green-600'  },
  contact_delete:              { Icon: Trash2,          bg: 'bg-red-500/10',    fg: 'text-red-600'    },
  contact_type_change:         { Icon: ArrowRightLeft,  bg: 'bg-yellow-500/10', fg: 'text-yellow-600' },
  rank_change:                 { Icon: Award,           bg: 'bg-yellow-500/10', fg: 'text-yellow-600' },
  subscription_change:         { Icon: CreditCard,      bg: 'bg-yellow-500/10', fg: 'text-yellow-600' },
  session_participant_add:     { Icon: CalendarCheck,   bg: 'bg-green-500/10',  fg: 'text-green-600'  },
  session_participant_delete:  { Icon: CalendarX,       bg: 'bg-red-500/10',    fg: 'text-red-600'    },
  booking_created:             { Icon: CalendarDays,    bg: 'bg-blue-500/10',   fg: 'text-blue-600'   },
  booking_confirmed:           { Icon: CheckCircle,     bg: 'bg-blue-500/10',   fg: 'text-blue-600'   },
  booking_cancelled:           { Icon: XCircle,         bg: 'bg-red-500/10',    fg: 'text-red-600'    },
  booking_rebooked:            { Icon: CalendarDays,    bg: 'bg-blue-500/10',   fg: 'text-blue-600'   },
  contact_login:               { Icon: Activity,        bg: 'bg-green-500/10',  fg: 'text-green-600'  },
  outreach_email_sent:         { Icon: Mail,            bg: 'bg-blue-500/10',   fg: 'text-blue-600'   },
  contact_anonymized:          { Icon: Trash2,          bg: 'bg-muted',         fg: 'text-muted-foreground' },
}

function formatActivityTimestamp(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '—'
  const d = ts.toDate()
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffHrs = diffMs / 3_600_000

  if (diffHrs < 1) {
    const mins = Math.max(1, Math.round(diffMs / 60_000))
    return `${mins}m ago`
  }
  if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`
  if (diffHrs < 48) return `Yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function dateDayLabel(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  const d = ts.toDate()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = (today.getTime() - day.getTime()) / 86_400_000
  if (diffDays < 1) return 'Today'
  if (diffDays < 2) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
}

function ActivityTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const { data: entries = [], isLoading } = useContactActivityLog(contact.id, teamId)

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
    </div>
  )
  if (entries.length === 0) return (
    <div className="py-12 text-center text-muted-foreground text-sm">{t('noActivity')}</div>
  )

  // Group by calendar day
  const groups: { label: string; items: ActivityLogEntry[] }[] = []
  let currentLabel = ''
  for (const entry of entries) {
    const label = dateDayLabel(entry.created_at as { toDate(): Date } | null | undefined)
    if (label !== currentLabel) {
      groups.push({ label, items: [] })
      currentLabel = label
    }
    groups[groups.length - 1].items.push(entry)
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium text-muted-foreground px-1 mb-2">{group.label}</p>
          <div className="space-y-1.5">
            {group.items.map((entry) => {
              const meta = EVENT_META[entry.event] ?? { Icon: Activity, bg: 'bg-muted', fg: 'text-muted-foreground' }
              const { Icon, bg, fg } = meta
              return (
                <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border">
                  <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`h-4 w-4 ${fg}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{entry.parameters.description as string}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatActivityTimestamp(entry.created_at as { toDate(): Date } | null | undefined)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {entries.length === PAGE_SIZE && (
        <p className="text-center text-xs text-muted-foreground py-2">{t('activityLoadMore')}</p>
      )}
    </div>
  )
}

// ─── alerts tab ───────────────────────────────────────────────────────────────

const alertSchema = z.object({
  schedule_type: z.enum(['sessions_countdown', 'datetime']),
  schedule_value_sessions: z.coerce.number().min(1).optional(),
  schedule_value_date: z.date().optional(),
  message: z.string().min(1).max(500),
  show_in_app: z.boolean().optional(),
})
type AlertFormValues = z.infer<typeof alertSchema>

function AlertDialog({
  open, onOpenChange, contactId, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  contactId: string; onSaved: () => void
}) {
  const t = useTranslations('Contacts')

  const { register, handleSubmit, watch, control, reset, formState: { isSubmitting } } = useForm<AlertFormValues>({
    resolver: zodResolver(alertSchema),
    defaultValues: { schedule_type: 'sessions_countdown', schedule_value_sessions: 10, show_in_app: false },
  })

  const scheduleType = watch('schedule_type')

  async function onSubmit(data: AlertFormValues) {
    const payload: Record<string, unknown> = {
      schedule_type: data.schedule_type,
      message: data.message,
      show_in_app: data.show_in_app ?? false,
      archived_at: null,
      created_at: serverTimestamp(),
    }
    if (data.schedule_type === 'sessions_countdown') {
      payload.schedule_value = Number(data.schedule_value_sessions)
    } else if (data.schedule_value_date) {
      payload.schedule_value = Timestamp.fromDate(data.schedule_value_date)
    }
    await addDoc(collection(db, CONTACTS_COLLECTION, contactId, CONTACT_ALERTS_SUBCOLLECTION), payload)
    onSaved()
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('addAlert')}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 py-1">
          {/* Trigger type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('alertScheduleType')}</label>
            <div className="flex gap-2">
              {(['sessions_countdown', 'datetime'] as AlertScheduleType[]).map((type) => (
                <label key={type} className="flex-1 cursor-pointer">
                  <input type="radio" value={type} {...register('schedule_type')} className="sr-only" />
                  <div className={`flex items-center gap-1.5 justify-center py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                    scheduleType === type
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}>
                    {type === 'sessions_countdown' ? <Timer className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                    {type === 'sessions_countdown' ? t('alertTypeSessionsCountdown') : t('alertTypeDatetime')}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {scheduleType === 'sessions_countdown' ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('alertSessionCount')}</label>
              <Input type="number" min="1" {...register('schedule_value_sessions')} />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('alertDate')}</label>
              <Controller
                control={control}
                name="schedule_value_date"
                render={({ field }) => (
                  <DatePicker value={field.value} onChange={field.onChange} />
                )}
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">{t('alertMessage')}</label>
            <Textarea {...register('message')} rows={2} placeholder="e.g. Give welcome gift" />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" {...register('show_in_app')} className="rounded border-input" />
            {t('alertShowInApp')}
          </label>

          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {t('addAlert')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AlertPresetPicker({
  open, onOpenChange, presets, onSelect,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  presets: AlertPresetRecord[]; onSelect: (p: AlertPresetRecord, date?: Date) => void
}) {
  const [dateStep, setDateStep] = useState<AlertPresetRecord | null>(null)
  const [pickedDate, setPickedDate] = useState<Date | undefined>()

  const handleSelect = (p: AlertPresetRecord) => {
    if (p.schedule_type === 'datetime') {
      setDateStep(p)
    } else {
      onSelect(p)
      onOpenChange(false)
    }
  }

  return (
    <>
      <Dialog open={open && !dateStep} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apply preset</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border text-left hover:bg-muted transition-colors"
              >
                <div className="shrink-0 text-muted-foreground">
                  {p.schedule_type === 'sessions_countdown' ? <Timer className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{p.message}</p>
                </div>
                {p.schedule_type === 'sessions_countdown' && (
                  <Badge variant="outline" className="text-xs shrink-0">{p.schedule_value} sessions</Badge>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Date picker for date-based presets */}
      <Dialog open={!!dateStep} onOpenChange={() => { setDateStep(null); setPickedDate(undefined) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Select date for "{dateStep?.name}"</DialogTitle></DialogHeader>
          <div className="py-2">
            <DatePicker value={pickedDate} onChange={setPickedDate} />
          </div>
          <DialogFooter>
            <button onClick={() => { setDateStep(null); setPickedDate(undefined) }}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              disabled={!pickedDate}
              onClick={() => {
                if (dateStep && pickedDate) {
                  onSelect(dateStep, pickedDate)
                  setDateStep(null)
                  setPickedDate(undefined)
                  onOpenChange(false)
                }
              }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Apply
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AlertsTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: alerts = [], isLoading } = useContactAlerts(contact.id)
  const { data: presets = [] } = useAlertPresets(teamId)
  const [addOpen, setAddOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contact-alerts', contact.id] })

  const handleDeleteAlert = async (id: string) => {
    await deleteDoc(doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_ALERTS_SUBCOLLECTION, id))
    invalidate()
  }

  const applyPreset = async (preset: AlertPresetRecord, date?: Date) => {
    const payload: Record<string, unknown> = {
      schedule_type: preset.schedule_type,
      message: preset.message,
      show_in_app: preset.show_in_app ?? false,
      archived_at: null,
      created_at: serverTimestamp(),
    }
    if (preset.schedule_type === 'sessions_countdown') {
      payload.schedule_value = preset.schedule_value ?? 10
    } else if (date) {
      payload.schedule_value = Timestamp.fromDate(date)
    }
    await addDoc(collection(db, CONTACTS_COLLECTION, contact.id, CONTACT_ALERTS_SUBCOLLECTION), payload)
    invalidate()
  }

  const isAlertFired = (alert: ContactAlert): boolean => {
    if (alert.schedule_type === 'sessions_countdown') {
      return (contact.total_sessions ?? 0) >= (alert.schedule_value as number)
    }
    if (alert.schedule_type === 'datetime') {
      const ts = alert.schedule_value as { toDate(): Date } | null
      if (!ts) return false
      return ts.toDate() <= new Date()
    }
    return false
  }

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )

  return (
    <div className="space-y-4 pb-24">
      <div className="flex gap-2 justify-end">
        {presets.length > 0 && (
          <button
            onClick={() => setPresetOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted transition-colors"
          >
            <BookOpen className="h-4 w-4" />From preset
          </button>
        )}
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted transition-colors"
        >
          <Plus className="h-4 w-4" />{t('addAlert')}
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">{t('noAlerts')}</div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const fired = isAlertFired(alert)
            return (
              <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${fired ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20' : ''}`}>
                <div className={`mt-0.5 shrink-0 ${fired ? 'text-orange-500' : 'text-muted-foreground'}`}>
                  {alert.schedule_type === 'sessions_countdown'
                    ? <Timer className="h-4 w-4" />
                    : <CalendarDays className="h-4 w-4" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {alert.schedule_type === 'sessions_countdown' ? (
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('alertTypeSessionsCountdown')}: {alert.schedule_value as number}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {(alert.schedule_value as { toDate(): Date } | null)?.toDate()
                          .toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
                        ?? '—'}
                      </span>
                    )}
                    <Badge
                      variant={fired ? 'default' : 'outline'}
                      className={`text-xs ${fired ? 'bg-orange-500 border-orange-500' : ''}`}
                    >
                      {fired ? t('alertFired') : t('alertPending')}
                    </Badge>
                    {alert.show_in_app && (
                      <Badge variant="outline" className="text-xs">App</Badge>
                    )}
                  </div>
                  <p className="text-sm mt-0.5">{alert.message}</p>
                </div>
                <button
                  onClick={() => handleDeleteAlert(alert.id)}
                  className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <AlertDialog open={addOpen} onOpenChange={setAddOpen} contactId={contact.id} onSaved={invalidate} />
      <AlertPresetPicker open={presetOpen} onOpenChange={setPresetOpen} presets={presets} onSelect={applyPreset} />
    </div>
  )
}

// ─── archived / deleted read-only view ───────────────────────────────────────

function ArchivedContactView({ contact, onAction }: { contact: Contact; onAction: () => void }) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [acting, setActing] = useState(false)

  const isDeleted = !!contact.deleted_at

  const daysLeft = useMemo(() => {
    if (!isDeleted) return null
    const deletedDate = tsToDate(contact.deleted_at)
    if (!deletedDate) return null
    const anonymiseDate = new Date(deletedDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    return Math.max(0, Math.ceil((anonymiseDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
  }, [contact.deleted_at, isDeleted])

  const handleRestore = async () => {
    setActing(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        archived_at: null,
        deleted_at: null,
        updatedAt: serverTimestamp(),
      })
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      onAction()
    } finally {
      setActing(false)
    }
  }

  const handleDelete = async () => {
    setActing(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        deleted_at: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setConfirmDelete(false)
      onAction()
    } finally {
      setActing(false)
    }
  }

  const address = contact.address
  const hasAddress = address && Object.values(address).some(Boolean)
  const hasAcquisition = contact.acquisition && (contact.acquisition.channel || contact.acquisition.notes)

  return (
    <div className="space-y-4">
      {/* Deletion countdown warning */}
      {isDeleted && daysLeft !== null && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive font-medium">
            {t('deletedDaysLeft', { days: daysLeft })}
          </p>
        </div>
      )}

      {/* Action bar + notice */}
      <div className="rounded-xl border bg-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">{t('archivedNotice')}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRestore}
            disabled={acting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <ArchiveRestore className="h-4 w-4" />
            {isDeleted ? t('bulkRestore') : t('actionUnarchive')}
          </button>
          {!isDeleted && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/30 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              {t('bulkDelete')}
            </button>
          )}
        </div>
      </div>

      {/* Core fields */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader>{t('sectionBasicInfo')}</SectionHeader>
        <DetailRow label={t('colType')} value={contact.type ? t(`type_${contact.type}`) : null} />
        <DetailRow label={t('colStatus')} value={contact.membership_status ? t(`status_${contact.membership_status}`) : null} />
        <DetailRow label={t('fieldGender')} value={contact.gender ? t(`gender_${contact.gender}`) : null} />

        <SectionHeader>{t('sectionContactInfo')}</SectionHeader>
        <DetailRow label={t('colEmail')} value={contact.email} />
        <DetailRow label={t('fieldPhone')} value={contact.phone} />

        <SectionHeader>{t('sectionPersonalInfo')}</SectionHeader>
        <DetailRow label={t('fieldBirthdate')} value={formatDate(contact.birthdate)} />
        <DetailRow label={t('fieldBirthplace')} value={contact.birthplace} />
        {(contact.weight ?? 0) > 0 && (
          <DetailRow label={t('fieldWeight')} value={`${contact.weight} kg`} />
        )}
      </div>

      {/* Address */}
      {hasAddress && (
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader>{t('sectionAddress')}</SectionHeader>
          {(address.route || address.street_number) && (
            <DetailRow
              label={t('fieldStreet')}
              value={[address.route, address.street_number].filter(Boolean).join(' ')}
            />
          )}
          {address.postal_code && <DetailRow label={t('fieldPostalCode')} value={address.postal_code} />}
          {address.locality && <DetailRow label={t('fieldLocality')} value={address.locality} />}
        </div>
      )}

      {/* Acquisition */}
      {hasAcquisition && (
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader>{t('sectionAcquisition')}</SectionHeader>
          <DetailRow label={t('fieldAcquisitionChannel')} value={contact.acquisition?.channel} />
          {contact.acquisition?.notes && (
            <DetailRow label={t('fieldAcquisitionNotes')} value={contact.acquisition.notes} />
          )}
        </div>
      )}

      {/* Statistics */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader>{t('sectionStats')}</SectionHeader>
        <DetailRow label={t('statTotalSessions')} value={String(contact.total_sessions ?? 0)} />
        {contact.created_at && (
          <DetailRow label={t('memberSince')} value={formatDate(contact.created_at)} />
        )}
        {contact.archived_at && (
          <DetailRow label={t('archivedSince')} value={formatDate(contact.archived_at)} />
        )}
      </div>

      {/* Notes */}
      {contact.notes && (
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader>{t('fieldNotes')}</SectionHeader>
          <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteContactTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('deleteContactDesc', { name: `${contact.firstname} ${contact.lastname}` })}
          </p>
          <DialogFooter>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={acting}
              className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {acting ? tCommon('loading') : t('bulkDelete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type TabId = 'profile' | 'notes' | 'activity' | 'bookings' | 'subscriptions' | 'gamification' | 'alerts'

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
    return <div className="py-16 text-center text-muted-foreground">{t('notFound')}</div>
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'profile',       label: t('tabProfile'),       icon: Mail },
    { id: 'notes',         label: t('tabNotes'),         icon: StickyNote },
    { id: 'activity',      label: t('tabActivity'),      icon: Activity },
    { id: 'alerts',        label: t('tabAlerts'),        icon: Bell },
    { id: 'bookings',      label: t('tabBookings'),      icon: CalendarDays },
    { id: 'subscriptions', label: t('tabSubscriptions'), icon: BookOpen },
    { id: 'gamification',  label: t('tabGamification'),  icon: Star },
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
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex flex-col lg:flex-row">
          {/* Identity — left */}
          <div className="p-5 flex items-start gap-4 flex-1 min-w-0">
            <div className="h-16 w-16 rounded-full shrink-0 flex items-center justify-center bg-muted text-muted-foreground text-xl font-bold">
              {initials(contact)}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold">{contact.firstname} {contact.lastname}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {contact.deleted_at ? (
                  <Badge variant="destructive">{t('deletedBadge')}</Badge>
                ) : contact.archived_at ? (
                  <Badge variant="secondary">{t('archivedBadge')}</Badge>
                ) : (
                  <>
                    {contact.membership_status && (
                      <Badge variant={STATUS_VARIANT[contact.membership_status]}>
                        {t(`status_${contact.membership_status}`)}
                      </Badge>
                    )}
                    {contact.type && (
                      <Badge variant="outline">{t(`type_${contact.type}`)}</Badge>
                    )}
                    {!contact.acquisition?.acknowledged && (
                      <Badge className="bg-blue-500 text-white border-blue-500">{t('newBadge')}</Badge>
                    )}
                  </>
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
                {(contact.current_streak ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flame className="h-3 w-3 text-orange-500" /> {contact.current_streak}w streak
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Desktop stats — right, always visible */}
          <div className="hidden lg:flex flex-col border-l w-1/3 shrink-0">
            <StatsPanel contact={contact} teamId={currentTeamId} />
          </div>
        </div>

        {/* Mobile stats — collapsible at bottom */}
        <MobileStatsToggle contact={contact} teamId={currentTeamId} />
      </div>

      {/* Archived / deleted → read-only summary; active → full tabbed view */}
      {(contact.archived_at || contact.deleted_at) ? (
        <ArchivedContactView contact={contact} onAction={invalidate} />
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-0.5 border-b overflow-x-auto">
            {TABS.map((tb) => {
              const Icon = tb.icon
              return (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
          <div>
            {tab === 'profile' && (
              <ProfileTab contact={contact} teamId={currentTeamId} onSaved={invalidate} />
            )}
            {tab === 'notes' && (
              <NotesTab contact={contact} onSaved={invalidate} />
            )}
            {tab === 'activity' && (
              <ActivityTab contact={contact} teamId={currentTeamId} />
            )}
            {tab === 'alerts' && (
              <AlertsTab contact={contact} teamId={currentTeamId} />
            )}
            {tab === 'bookings' && (
              <BookingsTab contact={contact} teamId={currentTeamId} />
            )}
            {tab === 'subscriptions' && (
              <SubscriptionsTab contact={contact} teamId={currentTeamId} />
            )}
            {tab === 'gamification' && (
              <GamificationTab contact={contact} teamId={currentTeamId} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
