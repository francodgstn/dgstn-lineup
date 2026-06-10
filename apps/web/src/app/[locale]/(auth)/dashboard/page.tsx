'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  collection, query, where, orderBy, limit,
  getDocs, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { PlanGate } from '@/components/plan/PlanGate'
import { useUpgradeModal } from '@/contexts/UpgradeModalContext'
import {
  Users, TrendingUp, BookOpen, CreditCard,
  Plus, UserPlus, ArrowRight, Clock, Lock, ChevronDown, Zap,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import type { Contact, Session, RankingSystem, SubscriptionType, UserProfile, Team } from '@linyup/shared'
import { getDailyQuote } from '@/data/quotes'
import { CONTACTS_COLLECTION, SESSIONS_COLLECTION, TEAMS_COLLECTION } from '@linyup/shared'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useMembershipTerm } from '@/hooks/useMembershipTerm'
import { SectionIntro } from '@/components/onboarding/SectionIntro'
import { SetupChecklist } from '@/components/onboarding/SetupChecklist'
import { RosterCard } from '@/components/dashboard/RosterCard'
import { DemographicsCard } from '@/components/dashboard/DemographicsCard'
import { ContactsSummaryCard } from '@/components/dashboard/ContactsSummaryCard'
import { BookingsTrendCard } from '@/components/dashboard/BookingsTrendCard'
import { SessionsHeatmapCard } from '@/components/dashboard/SessionsHeatmapCard'
import { TopActivitiesCard } from '@/components/dashboard/TopActivitiesCard'
import { TrialFunnelCard } from '@/components/dashboard/TrialFunnelCard'
import { WeeklyTrendsCard } from '@/components/dashboard/WeeklyTrendsCard'
import { CorrelationExplorerCard } from '@/components/dashboard/CorrelationExplorerCard'
import { EngagementMatrixCard } from '@/components/dashboard/EngagementMatrixCard'

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStart(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

function weekStart(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return d
}

function formatTime(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: { toDate(): Date } | null | undefined, labels: { today: string; tomorrow: string }): string {
  if (!ts) return ''
  const d = ts.toDate()
  const today = new Date(), tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return labels.today
  if (d.toDateString() === tomorrow.toDateString()) return labels.tomorrow
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useContacts(teamId: string | null) {
  return useQuery({
    queryKey: ['contacts', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
      ))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Contact))
    },
  })
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery({
    queryKey: ['subscription_types', teamId],
    enabled: !!teamId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(collection(db, TEAMS_COLLECTION, teamId!, 'subscription_types'))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as SubscriptionType))
    },
  })
}

function useUpcomingSessions(teamId: string | null) {
  return useQuery({
    queryKey: ['sessions', 'upcoming', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        where('start', '>=', Timestamp.fromDate(todayStart())),
        orderBy('start', 'asc'),
        limit(8),
      ))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Session))
    },
  })
}


// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, subtitle, icon: Icon, loading, href, secondary }: {
  title: string; value: number | null | undefined; subtitle: string
  icon: React.ElementType; loading?: boolean; href?: string
  secondary?: { label: string; value: number | null }
}) {
  const inner = (
    <Card variant="accent" className={href ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <Icon className="h-4 w-4 text-primary/60" />
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {loading ? <Skeleton className="h-8 w-14" /> : (
            <p className="text-3xl font-black leading-none">{value ?? '—'}</p>
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{subtitle}</p>
            {secondary && (
              <p className="text-xs text-muted-foreground/60">
                +{secondary.value ?? '—'} {secondary.label}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href as Route}>{inner}</Link> : inner
}

// ─── dashboard hero ───────────────────────────────────────────────────────────

function DashboardHero({ profile, team }: { profile: UserProfile | null; team: Team | null }) {
  const t = useTranslations('Dashboard')
  const locale = useLocale()

  const now = new Date()
  const hour = now.getHours()
  const greetingKey = hour < 12 ? 'greetingMorning' : hour < 17 ? 'greetingAfternoon' : 'greetingEvening'

  const firstName = profile?.firstname ?? profile?.displayName?.split(' ')[0] ?? ''

  const dateStr = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-0.5">
      <h1 className="text-2xl font-bold tracking-tight">
        {t(greetingKey)}{firstName ? `, ${firstName}` : ''} 👋
      </h1>
      <p className="text-sm text-muted-foreground">
        {dateStr}{team?.name ? ` · ${team.name}` : ''}
      </p>
    </div>
  )
}

function DailyQuote() {
  const quote = getDailyQuote()
  return (
    <p className="shrink-0 text-xs text-muted-foreground/60 italic md:max-w-xs md:pt-1 md:text-right">
      &ldquo;{quote.text}&rdquo; — {quote.author}
    </p>
  )
}

// ─── section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
      <Separator className="mt-1.5" />
    </div>
  )
}

// ─── agenda: today's sessions ─────────────────────────────────────────────────

function SessionRow({ session, dateLabels }: { session: Session; dateLabels: { today: string; tomorrow: string } }) {
  const t = useTranslations('Dashboard')
  const bookings = session.bookings_count ?? 0
  const trials   = session.trial_bookings_count ?? 0
  const attended = session.participants_count ?? 0
  return (
    <Link href={`/sessions/${session.id}` as Route}
      className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-muted/50 transition-colors">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/8 flex items-center justify-center">
        <Clock className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{session.activityName ?? t('sessionFallback')}</p>
        <p className="text-xs text-muted-foreground">
          {formatDate(session.start as Parameters<typeof formatDate>[0], dateLabels)}
          {' · '}{formatTime(session.start as Parameters<typeof formatTime>[0])}
          {session.location ? ` · ${session.location}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {bookings > 0 && (
          <Badge variant="secondary" className="text-xs">{t('bookings', { count: bookings })}</Badge>
        )}
        {trials > 0 && (
          <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">{t('trials', { count: trials })}</Badge>
        )}
        {attended > 0 && (
          <span className="text-xs text-muted-foreground">{t('attended', { count: attended })}</span>
        )}
      </div>
    </Link>
  )
}

function AgendaCard({ teamId }: { teamId: string | null }) {
  const { data: sessions, isLoading } = useUpcomingSessions(teamId)
  const t = useTranslations('Dashboard')
  const tCommon = useTranslations('Common')
  const dateLabels = { today: tCommon('today'), tomorrow: tCommon('tomorrow') }

  const todaySessions = sessions?.filter((s) => {
    if (!s.start) return false
    return (s.start as { toDate(): Date }).toDate().toDateString() === new Date().toDateString()
  }) ?? []
  const futureSessions = sessions?.filter((s) => {
    if (!s.start) return false
    return (s.start as { toDate(): Date }).toDate().toDateString() !== new Date().toDateString()
  }) ?? []

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{t('upcomingSessions')}</CardTitle>
          <Link href="/sessions" className="text-xs text-primary hover:underline flex items-center gap-0.5">
            {t('allSessions')} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[380px] overflow-y-auto px-6 pb-4">
          {isLoading ? (
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-20" /></div>
                </div>
              ))}
            </div>
          ) : sessions?.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('noUpcomingSessions')}</div>
          ) : (
            <div className="space-y-1">
              {todaySessions.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground px-1 pb-1 pt-2">{tCommon('today')}</p>
                  {todaySessions.map((s) => <SessionRow key={s.id} session={s} dateLabels={dateLabels} />)}
                </>
              )}
              {futureSessions.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground px-1 pb-1 pt-3">{t('sectionUpcoming')}</p>
                  {futureSessions.map((s) => <SessionRow key={s.id} session={s} dateLabels={dateLabels} />)}
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── quick actions + recent bookings ─────────────────────────────────────────

function QuickActions({ teamSlug }: { teamSlug?: string }) {
  const t = useTranslations('Dashboard')
  const router = useRouter()
  const actions: { label: string; icon: React.ElementType; href: Route }[] = [
    { label: t('actionNewContact'), icon: UserPlus, href: '/contacts' as Route },
    { label: t('actionNewSession'), icon: Plus, href: '/sessions' as Route },
    { label: t('actionViewPortal'), icon: BookOpen, href: (teamSlug ? `/portal/${teamSlug}` : '/team/portal') as Route },
  ]

  const chipClass =
    'inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/60 hover:shadow-md transition-all'

  return (
    <>
      {/* ≥sm: individual action pills */}
      <div className="hidden sm:flex flex-wrap gap-2">
        {actions.map((a) => (
          <Link key={String(a.href)} href={a.href} className={chipClass}>
            <a.icon className="h-3.5 w-3.5 text-primary" />{a.label}
          </Link>
        ))}
      </div>

      {/* <sm: single "Quick actions" chip with a dropdown */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger className={chipClass}>
            <Zap className="h-3.5 w-3.5 text-primary" />
            {t('quickActions')}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {actions.map((a) => (
              <DropdownMenuItem key={String(a.href)} onClick={() => router.push(a.href)}>
                <a.icon className="h-4 w-4 text-primary" />
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}


// ─── contacts snapshot ────────────────────────────────────────────────────────

function ContactsSnapshot({
  contacts, loading, rankingSystems,
}: {
  contacts: Contact[] | undefined
  loading: boolean
  rankingSystems?: RankingSystem[]
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    )
  }

  const all = contacts ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <RosterCard contacts={all} />
      <DemographicsCard contacts={all} rankingSystems={rankingSystems} />
      <TriggeredAlertsCard contacts={all} />
    </div>
  )
}

function TriggeredAlertsCard({ contacts }: { contacts: Contact[] }) {
  const t = useTranslations('Dashboard')

  // Find contacts with total_sessions ≥ any sessions_countdown alert value
  // We approximate this client-side using total_sessions on the contact doc.
  // Contacts whose session count crosses a round milestone (10, 20, 30…) are flagged.
  const milestones = [10, 20, 30, 50, 75, 100, 150, 200]
  const flagged = contacts
    .filter((c) => {
      const s = c.total_sessions ?? 0
      return milestones.some((m) => s >= m && s < m + 3)
    })
    .slice(0, 5)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{t('snapshotAlerts')}</CardTitle>
          <Link href="/contacts" className="text-xs text-primary hover:underline flex items-center gap-0.5">
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {flagged.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('snapshotNoAlerts')}</p>
        ) : (
          <div className="space-y-2.5">
            {flagged.map((c) => {
              const initials = `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
              return (
                <Link key={c.id} href={`/contacts/${c.id}` as Route}
                  className="flex items-center gap-2.5 rounded-lg hover:bg-muted/50 transition-colors p-1 -mx-1">
                  <div className="h-7 w-7 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-orange-600">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.firstname} {c.lastname}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0 border-orange-300 text-orange-600">
                    {c.total_sessions} sessions
                  </Badge>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── trends upsell (Coach plan) ──────────────────────────────────────────────

function TrendsUpsell() {
  const t = useTranslations('Dashboard')
  const { openUpgradeModal } = useUpgradeModal()
  return (
    <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
      <TrendingUp className="h-8 w-8 mx-auto text-muted-foreground/40" />
      <p className="text-sm font-medium">{t('sectionTrends')}</p>
      <p className="text-xs text-muted-foreground max-w-xs mx-auto">{t('trendsUpsell')}</p>
      <button
        onClick={() => openUpgradeModal({ minPlan: 'club' })}
        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Lock className="h-3 w-3" />
        See upgrade options
      </button>
    </div>
  )
}

// ─── trends section (Club+ only) ─────────────────────────────────────────────

type CompareWith = 'none' | 'prev_period' | 'last_year'
const WEEKS_OPTIONS = [4, 8, 13, 26, 52]

function TrendsSection({ teamId }: { teamId: string | null }) {
  const [trendsWeeks, setTrendsWeeks] = useState<number>(13)
  const [compareWith, setCompareWith] = useState<CompareWith>('none')

  const data = useDashboardData(teamId, trendsWeeks, compareWith)

  const sharedProps = { trendsWeeks, compareWith }

  return (
    <div className="space-y-6">
      {/* Period controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Period:</span>
          <Select value={String(trendsWeeks)} onValueChange={(v) => setTrendsWeeks(Number(v))}>
            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEEKS_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>{w} weeks</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Compare:</span>
          <Select value={compareWith} onValueChange={(v) => setCompareWith(v as CompareWith)}>
            <SelectTrigger className="h-7 text-xs w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No comparison</SelectItem>
              <SelectItem value="prev_period">Previous period</SelectItem>
              <SelectItem value="last_year">Same period last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 1: TopActivities + Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          <TopActivitiesCard
            sessions={data.sessions}
            allBookings={data.allBookings}
            newContactBookings={data.newContactBookings}
            activities={data.activities}
            comparisonSessions={data.comparisonSessions}
            comparisonAllBookings={data.comparisonAllBookings}
            comparisonNewContactBookings={data.comparisonNewContactBookings}
            compareWith={compareWith}
          />
        </div>
        <div className="lg:col-span-8">
          <SessionsHeatmapCard
            sessions={data.sessions}
            newContactBookings={data.newContactBookings}
            compareWith={compareWith}
            comparisonSessions={data.comparisonSessions}
            comparisonNewContactBookings={data.comparisonNewContactBookings}
          />
        </div>
      </div>

      {/* Row 2: Contacts trend + Bookings trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ContactsSummaryCard
          weeklyReports={data.weeklyReports}
          comparisonWeeklyReports={data.comparisonWeeklyReports}
          subscriptionTypes={data.subscriptionTypes}
          {...sharedProps}
        />
        <BookingsTrendCard
          sessions={data.sessions}
          allBookings={data.allBookings}
          newContactBookings={data.newContactBookings}
          weeklyReports={data.weeklyReports}
          comparisonWeeklyReports={data.comparisonWeeklyReports}
          comparisonSessions={data.comparisonSessions}
          comparisonAllBookings={data.comparisonAllBookings}
          comparisonNewContactBookings={data.comparisonNewContactBookings}
          {...sharedProps}
        />
      </div>

      {/* Row 3: Trial funnel + Weekly trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrialFunnelCard
          weeklyReports={data.weeklyReports}
          comparisonWeeklyReports={data.comparisonWeeklyReports}
          {...sharedProps}
        />
        <WeeklyTrendsCard
          weeklyReports={data.weeklyReports}
          trendsWeeks={trendsWeeks}
        />
      </div>

      {/* Row 4: Correlation explorer + Engagement matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CorrelationExplorerCard
          weeklyReports={data.weeklyReports}
          sessions={data.sessions}
          allBookings={data.allBookings}
          newContactBookings={data.newContactBookings}
          trendsWeeks={trendsWeeks}
        />
        <EngagementMatrixCard
          weeklyReports={data.weeklyReports}
          trendsWeeks={trendsWeeks}
        />
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentTeamId, profile, team } = useAuth()
  const t = useTranslations('Dashboard')
  const membershipTerm = useMembershipTerm()

  const { data: contacts, isLoading: contactsLoading } = useContacts(currentTeamId)
  const { data: sessions, isLoading: sessionsLoading } = useUpcomingSessions(currentTeamId)
  const { data: subTypes = [] } = useSubscriptionTypes(currentTeamId)

  const activeMembers = contacts?.filter(
    (c) => c.membership_status === 'active' && !c.archived_at
  ).length ?? null
  const thisWeek = weekStart()
  const prevWeek = new Date(thisWeek); prevWeek.setDate(prevWeek.getDate() - 7)
  const engagedThisWeek = contacts?.filter((c) => {
    if (!c.last_session_at) return false
    return (c.last_session_at as { toDate(): Date }).toDate() >= thisWeek
  }).length ?? null
  const engagedPrevWeek = contacts?.filter((c) => {
    if (!c.last_session_at) return false
    const d = (c.last_session_at as { toDate(): Date }).toDate()
    return d >= prevWeek && d < thisWeek
  }).length ?? null
  const upcomingBookingsCount = sessions?.reduce(
    (sum, s) => sum + (s.bookings_count ?? 0), 0,
  ) ?? null
  const upcomingTrialsCount = sessions?.reduce(
    (sum, s) => sum + (s.trial_bookings_count ?? 0), 0,
  ) ?? null

  const aggregatorIds = new Set(subTypes.filter((s) => s.source === 'aggregator').map((s) => s.id))
  const withSub = contacts?.filter((c) => !!c.subscription_type_id) ?? null
  const internalSubCount = withSub?.filter((c) => !aggregatorIds.has(c.subscription_type_id!)).length ?? null
  const aggregatorSubCount = withSub?.filter((c) => aggregatorIds.has(c.subscription_type_id!)).length ?? null

  const teamSlug = team?.slug ?? (profile as { slug?: string } | null)?.slug
  const statsLoading = contactsLoading || sessionsLoading

  return (
    <div className="space-y-8">
      {/* ── 0. Setup checklist (new teams only; auto-hides when done/dismissed) ── */}
      <SetupChecklist />

      {/* ── 1. Welcome row: greeting left, daily quote right ── */}
      <section className="space-y-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex items-start gap-1.5 min-w-0">
            <DashboardHero profile={profile} team={team} />
            <SectionIntro sectionKey="dashboard" />
          </div>
          <DailyQuote />
        </div>

        {/* ── 2. Quick actions (single dropdown chip on very small screens) ── */}
        <QuickActions teamSlug={teamSlug} />

        {/* ── 3. Highlights ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title={t('statEngaged')} value={engagedThisWeek} subtitle={t('statEngagedSub')}
            icon={TrendingUp} loading={statsLoading} href="/contacts"
            secondary={{ label: t('statEngagedPrev'), value: engagedPrevWeek }} />
          <StatCard title={t('statBookings')} value={upcomingBookingsCount} subtitle={t('statBookingsSub')}
            icon={BookOpen} loading={sessionsLoading} href="/bookings"
            secondary={upcomingTrialsCount !== null ? { label: t('statBookingsTrial'), value: upcomingTrialsCount } : undefined} />
          <StatCard title={t('statSubscribed')} value={internalSubCount} subtitle={t('statSubscribedSub')}
            icon={CreditCard} loading={statsLoading} href="/contacts"
            secondary={aggregatorSubCount !== null ? { label: t('statSubscribedAgg'), value: aggregatorSubCount } : undefined} />
          <StatCard title={membershipTerm} value={activeMembers} subtitle={t('statActiveMembersSub')}
            icon={Users} loading={statsLoading} href="/contacts" />
        </div>

        {/* ── 4. Agenda ── */}
        <AgendaCard teamId={currentTeamId} />
      </section>

      {/* ── 3. Contacts snapshot ── */}
      <section className="space-y-5">
        <SectionHeading>{t('sectionContactsSnapshot')}</SectionHeading>
        <ContactsSnapshot
          contacts={contacts}
          loading={contactsLoading}
          rankingSystems={team?.ranking_systems}
        />
      </section>

      {/* ── 4. Trends (Club+ only) ── */}
      <section className="space-y-5">
        <SectionHeading>{t('sectionTrends')}</SectionHeading>
        <PlanGate minPlan="club" fallback={<TrendsUpsell />}>
          <TrendsSection teamId={currentTeamId} />
        </PlanGate>
      </section>
    </div>
  )
}
