'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlanGate } from '@/components/plan/PlanGate'
import {
  Users,
  TrendingUp,
  BookOpen,
  CreditCard,
  Plus,
  UserPlus,
  ArrowRight,
  Clock,
  ChevronDown,
  Zap,
  ChevronLeft,
  ChevronRight,
  Globe,
  CheckCircle2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import type {
  Contact,
  Session,
  RankingSystem,
  SubscriptionType,
  UserProfile,
  Team,
  EngagementThresholds,
  ContactAttentionReason,
  ContactFilterContext,
} from '@linyup/shared'
import { compareContactsByAttention, contactAttentionReasons } from '@linyup/shared'
import { getDailyQuote } from '@/data/quotes'
import { CONTACTS_COLLECTION, SESSIONS_COLLECTION, TEAMS_COLLECTION } from '@linyup/shared'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useAffiliationTerm } from '@/hooks/useAffiliationTerm'
import { usePublicSurfaces } from '@/hooks/usePublicSurfaces'
import { SetupChecklist } from '@/components/onboarding/SetupChecklist'
import { Figure, FigureNote, FigureNumber, FigureRail } from '@/components/dashboard/Figure'
import { RosterCard } from '@/components/dashboard/RosterCard'
import { DemographicsCard } from '@/components/dashboard/DemographicsCard'
import { ContactsSummaryCard } from '@/components/dashboard/ContactsSummaryCard'
import { BookingsTrendCard } from '@/components/dashboard/BookingsTrendCard'
import { SessionsHeatmapCard } from '@/components/dashboard/SessionsHeatmapCard'
import { TopActivitiesCard } from '@/components/dashboard/TopActivitiesCard'
import { EngagementMatrixCard } from '@/components/dashboard/EngagementMatrixCard'
import { useExperimentalFeatures } from '@/hooks/useExperimentalFeatures'
import { DashboardFinanceSection } from '@/components/dashboard/DashboardFinanceSection'
// Temporarily hidden — restore alongside the commented rows in TrendsSection:
// import { TrialFunnelCard } from '@/components/dashboard/TrialFunnelCard'
// import { CorrelationExplorerCard } from '@/components/dashboard/CorrelationExplorerCard'
import { DiscoverPanel } from '@/components/dashboard/DiscoverPanel'
import { TeamNotificationsBanner } from '@/components/dashboard/TeamNotificationsBanner'
import { FirstRunCard } from '@/components/dashboard/FirstRunCard'
import { PlanUpgradeNotice } from '@/components/plan/PlanUpgradeNotice'
import { useSetupChecklist } from '@/hooks/useSetupChecklist'

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function weekStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return d
}

function formatTime(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Sessions scoped to a single calendar day — backs the agenda day navigator
// (including past days). Reuses the existing (teamId, start) composite index.
function useSessionsForDay(teamId: string | null, day: Date) {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return useQuery({
    queryKey: ['sessions', 'day', teamId, dayStart.toISOString()],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, SESSIONS_COLLECTION),
          where('teamId', '==', teamId),
          where('start', '>=', Timestamp.fromDate(dayStart)),
          where('start', '<', Timestamp.fromDate(dayEnd)),
          orderBy('start', 'asc')
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
    },
  })
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useContacts(teamId: string | null) {
  return useQuery({
    queryKey: ['contacts', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION),
          where('teamId', '==', teamId),
          where('deleted_at', '==', null)
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
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
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as SubscriptionType)
    },
  })
}

function useUpcomingSessions(teamId: string | null) {
  return useQuery({
    queryKey: ['sessions', 'upcoming', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, SESSIONS_COLLECTION),
          where('teamId', '==', teamId),
          where('start', '>=', Timestamp.fromDate(todayStart())),
          orderBy('start', 'asc'),
          limit(8)
        )
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Session)
    },
  })
}

// ─── dashboard hero ───────────────────────────────────────────────────────────

function DashboardHero({ profile, team }: { profile: UserProfile | null; team: Team | null }) {
  const t = useTranslations('Dashboard')
  const locale = useLocale()

  const now = new Date()
  const hour = now.getHours()
  const greetingKey =
    hour < 12 ? 'greetingMorning' : hour < 17 ? 'greetingAfternoon' : 'greetingEvening'

  const firstName = profile?.firstname ?? profile?.displayName?.split(' ')[0] ?? ''

  const dateStr = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-0.5">
      <h1 className="text-2xl font-bold tracking-tight">
        {t(greetingKey)}
        {firstName ? `, ${firstName}` : ''} 👋
      </h1>
      <p className="text-sm text-muted-foreground">
        {dateStr}
        {team?.name ? ` · ${team.name}` : ''}
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

/**
 * THE ONE TINT ON THE PAGE, and it lives only here.
 *
 * A wash on a block BODY was rejected in the sidebar, and the reason
 * generalises: a tinted thing that GROWS reads as a highlight rather than a
 * boundary, and it grows without bound. A section header band is fixed height,
 * so it cannot do that. Flat 3% primary under a 1px full-strength primary rule
 * — the same pair the sidebar settled on (`SHORTCUTS_RULE`, auth layout), not a
 * second idiom invented here. No gradient, no ramp.
 *
 * It also has to OUTRANK a figure caption, which it did not: heading and
 * caption were both `font-semibold uppercase tracking-wider text-muted-foreground`
 * at 12px and 11px, so the page's highest-level label was typeset as its
 * smallest. The heading is sentence case, foreground weight, `text-base
 * font-bold`; the caption went to `font-medium`.
 *
 * `action` is the section's one right-hand affordance (a "see all" link, a
 * period picker) — it belongs on the band, not floating above the content.
 */
function SectionHeading({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-b-md border-t border-primary bg-primary/[0.03] px-3 py-2">
      <h2 className="font-heading text-base font-bold leading-tight tracking-tight text-heading">
        {children}
      </h2>
      {action}
    </div>
  )
}

// ─── agenda: today's sessions ─────────────────────────────────────────────────

function SessionRow({ session }: { session: Session }) {
  const t = useTranslations('Dashboard')
  const bookings = session.bookings_count ?? 0
  const trials = session.trial_bookings_count ?? 0
  const attended = session.participants_count ?? 0
  return (
    <Link
      href={`/sessions/${session.id}` as Route}
      className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-muted/50 transition-colors"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/8 flex items-center justify-center">
        <Clock className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {session.activityName ?? t('sessionFallback')}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatTime(session.start as Parameters<typeof formatTime>[0])}
          {session.location ? ` · ${session.location}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {bookings > 0 && (
          <Badge variant="secondary" className="text-xs">
            {t('bookings', { count: bookings })}
          </Badge>
        )}
        {trials > 0 && (
          <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">
            {t('trials', { count: trials })}
          </Badge>
        )}
        {attended > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('attended', { count: attended })}
          </span>
        )}
      </div>
    </Link>
  )
}

function AgendaCard({ teamId }: { teamId: string | null }) {
  const t = useTranslations('Dashboard')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const [day, setDay] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })

  const { data: sessions, isLoading } = useSessionsForDay(teamId, day)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const isToday = day.getTime() === today.getTime()

  const shiftDay = (delta: number) =>
    setDay((d) => {
      const n = new Date(d)
      n.setDate(n.getDate() + delta)
      return n
    })

  const label =
    day.getTime() === today.getTime()
      ? tCommon('today')
      : day.getTime() === tomorrow.getTime()
        ? tCommon('tomorrow')
        : day.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{t('agenda')}</CardTitle>
          <Link
            href="/schedule"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            {t('allSessions')} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {/* Day navigator — compact, left-aligned; click the label to jump to today */}
        <div className="mt-1 flex w-fit items-center gap-0.5">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            aria-label={t('prevDay')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDay(today)}
            disabled={isToday}
            className="min-w-[150px] rounded-md px-2 py-1 text-center text-sm font-medium capitalize transition-colors hover:bg-muted disabled:hover:bg-transparent"
          >
            {label}
          </button>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            aria-label={t('nextDay')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* px-3 here + px-1 on a row puts a session title at 16px from the card
            edge — the same place CardHeader's px-4 puts the card title. It was
            px-6 + px-1, i.e. 28px, so the header and every row it labelled were
            visibly out of line. */}
        <div className="max-h-[440px] overflow-y-auto px-3 pb-4">
          {isLoading ? (
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (sessions?.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {isToday ? t('noSessionsToday') : t('noSessionsDay')}
            </div>
          ) : (
            <div className="space-y-1 pt-1">
              {sessions!.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
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
  const { flags } = usePublicSurfaces()
  const actions: { label: string; icon: React.ElementType; href: Route }[] = [
    { label: t('actionNewContact'), icon: UserPlus, href: '/contacts' as Route },
    { label: t('actionNewSession'), icon: Plus, href: '/schedule' as Route },
    {
      label: t('actionViewBioLink'),
      icon: BookOpen,
      href: (teamSlug ? `/public/${teamSlug}` : '/team/bio-link') as Route,
    },
    // Gated on `siteLive` (plugin installed AND a published site) rather than on
    // the plugin alone — an installed-but-unpublished website would send this
    // straight to a 404.
    ...(flags.siteLive && teamSlug
      ? [
          {
            label: t('actionViewWebsite'),
            icon: Globe,
            href: `/public/${teamSlug}/site` as Route,
          },
        ]
      : []),
  ]

  const chipClass =
    'inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/60 hover:shadow-md transition-all'

  return (
    <>
      {/* ≥sm: individual action pills */}
      <div className="hidden sm:flex flex-wrap gap-2">
        {actions.map((a) => (
          <Link key={String(a.href)} href={a.href} className={chipClass}>
            <a.icon className="h-3.5 w-3.5 text-primary" />
            {a.label}
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
//
// Two cards, and each keeps its frame for the same reason: it owns a view
// `Select`, so it is a bounded thing you page through rather than a figure. The
// third cell used to be "Triggered alerts" — see AttentionList below for where
// it went and why.

function ContactsSnapshot({
  contacts,
  loading,
  rankingSystems,
  engagementThresholds,
}: {
  contacts: Contact[] | undefined
  loading: boolean
  rankingSystems?: RankingSystem[]
  engagementThresholds?: EngagementThresholds
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    )
  }

  const all = contacts ?? []

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <RosterCard contacts={all} thresholds={engagementThresholds} />
      <DemographicsCard contacts={all} rankingSystems={rankingSystems} />
    </div>
  )
}

// ─── needs attention ──────────────────────────────────────────────────────────
//
// Replaces `TriggeredAlertsCard`, which was titled "Triggered alerts" and
// triggered nothing: it scanned `total_sessions` against a hardcoded milestone
// array with an `s >= m && s < m + 3` window, so a contact drifted in and out of
// it by attending, nothing raised or cleared it, and its badge rendered
// hardcoded English.
//
// THE PREDICATE IS NOT NEW. `contactAttentionReasons`
// (`shared/utils/contactFilter.ts`) is the one implementation — it already backs
// the contacts page's "Needs attention" sort and its filter dimension, and every
// reason reads a fact that is already on the contact document. This runs it over
// the contacts the dashboard has ALREADY loaded, so it costs zero extra reads.
//
// It is not a card: it has no interior to page through, and it is the block the
// direction's own rule matters most for. It links THROUGH to the contacts page
// rather than duplicating the full answer here — one place owns that list.
//
// EVERY ROW SAYS WHY. The reason is the point; a name with no reason is an
// urgency list nobody trusts, which is exactly what the contacts sort found when
// it shipped. Reason labels come from the `Contacts` namespace rather than a
// second copy of the same five strings.

/** How many rows show before the list defers to the contacts page. */
const ATTENTION_ROWS = 5

/** The contacts page's Needs-attention view, entered directly. */
const ATTENTION_HREF = '/contacts?attention=1' as Route

function AttentionRow({ contact, reason }: { contact: Contact; reason: ContactAttentionReason }) {
  const tc = useTranslations('Contacts')
  const initials = `${contact.firstname?.[0] ?? ''}${contact.lastname?.[0] ?? ''}`.toUpperCase() || '?'
  return (
    <Link
      href={`/contacts/${contact.id}` as Route}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
        <span className="text-xs font-semibold text-amber-600">{initials}</span>
      </div>
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {contact.firstname} {contact.lastname}
      </p>
      <Badge variant="outline" className="shrink-0 border-amber-300 text-xs text-amber-600">
        {tc(`attention_${reason}` as 'attention_alerts')}
      </Badge>
    </Link>
  )
}

type AttentionRowData = { contact: Contact; reason: ContactAttentionReason }

/**
 * The rows, derived ONCE for the whole section — the heading's count and the
 * list underneath it must never be able to disagree, and two components each
 * running their own scan is exactly how they would.
 */
function useAttentionRows(
  contacts: Contact[] | undefined,
  engagementThresholds?: EngagementThresholds
): AttentionRowData[] {
  const ctx: ContactFilterContext = useMemo(
    () => ({ engagementThresholds }),
    [engagementThresholds]
  )
  return useMemo(() => {
    const rows = (contacts ?? [])
      .filter((c) => !c.archived_at)
      .map((c) => ({ contact: c, reason: contactAttentionReasons(c, ctx)[0] }))
      .filter((r): r is AttentionRowData => !!r.reason)
    // Same comparator the contacts page sorts by, so "the top five here" and
    // "the top of that list there" are the same five people.
    rows.sort((a, b) => compareContactsByAttention(a.contact, b.contact, ctx))
    return rows
  }, [contacts, ctx])
}

function AttentionList({ rows, loading }: { rows: AttentionRowData[]; loading: boolean }) {
  const t = useTranslations('Dashboard')

  if (loading) {
    return (
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    )
  }

  // EMPTY IS A REAL STATE, AND A GOOD ONE. "Nothing needs you" is the answer a
  // studio wants; it must not read as a load that failed, so it is a stated
  // result with a tick, not a greyed placeholder.
  if (rows.length === 0) {
    return (
      <div className="flex items-start gap-3 py-1">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('attentionEmptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('attentionEmptyBody')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
      {rows.slice(0, ATTENTION_ROWS).map(({ contact, reason }) => (
        <AttentionRow key={contact.id} contact={contact} reason={reason} />
      ))}
    </div>
  )
}

/** The heading's right-hand affordance — count included, so the list can show
 *  five without hiding how many there are. */
function AttentionAction({ count }: { count: number }) {
  const t = useTranslations('Dashboard')
  if (count === 0) return null
  return (
    <Link
      href={ATTENTION_HREF}
      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
    >
      {count > ATTENTION_ROWS ? t('attentionSeeAll', { count }) : t('attentionOpenContacts')}
      <ArrowRight className="h-3 w-3" />
    </Link>
  )
}

// ─── above-tier sections ─────────────────────────────────────────────────────
// Both used to hand-roll a dashed panel with a hardcoded English "See upgrade
// options" link and no plan name. They speak through the one shared notice now
// (UX-42) — it names the tier and opens the upgrade modal.

function TrendsUpsell() {
  const t = useTranslations('Dashboard')
  return (
    <PlanUpgradeNotice
      minPlan="studio"
      title={t('sectionTrends')}
      description={t('trendsUpsell')}
    />
  )
}

function FinanceUpsell() {
  const t = useTranslations('Dashboard')
  return (
    <PlanUpgradeNotice
      minPlan="studio"
      title={t('sectionFinance')}
      description={t('financeUpsell')}
    />
  )
}

// ─── trends section (Studio+ only) ───────────────────────────────────────────

type CompareWith = 'none' | 'prev_period' | 'last_year'
const WEEKS_OPTIONS = [4, 8, 13, 26, 52]

function TrendsSection({ teamId }: { teamId: string | null }) {
  const [trendsWeeks, setTrendsWeeks] = useState<number>(13)
  const [compareWith, setCompareWith] = useState<CompareWith>('none')

  const t = useTranslations('Dashboard')
  const data = useDashboardData(teamId, trendsWeeks, compareWith)
  // The engagement matrix is an OPT-IN EXPERIMENT (Settings → Experimental
  // features), off until a studio asks for it. Visibility only: the card and its
  // data are untouched, so switching it on gets the working card.
  const { isEnabled } = useExperimentalFeatures()
  const showMatrix = isEnabled('engagement-matrix')

  const sharedProps = { trendsWeeks, compareWith }

  // UX-46: two of these charts have no empty state at all — with nothing to
  // plot they draw axes and a flat line, which reads as a broken chart rather
  // than a young studio. A trend needs history; say so once instead of drawing
  // a row of them. (This said "five of them" until the matrix became an opt-in
  // experiment below — a comment asserting a count, gone stale exactly as the
  // no-counts rule warns. Deliberately NOT gated on the period selector: no
  // reports and no sessions means no history at any width.)
  const noHistory =
    !data.isLoading && data.weeklyReports.length === 0 && data.sessions.length === 0
  if (noHistory) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <TrendingUp className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t('trendsNoHistoryTitle')}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t('trendsNoHistoryBody')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Period controls — every label here was hardcoded English until now. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('trendsPeriod')}</span>
          <Select value={String(trendsWeeks)} onValueChange={(v) => setTrendsWeeks(Number(v))}>
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKS_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {t('trendsWeeksOption', { weeks: w })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('trendsCompare')}</span>
          <Select value={compareWith} onValueChange={(v) => setCompareWith(v as CompareWith)}>
            <SelectTrigger className="h-7 w-[190px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('trendsCompareNone')}</SelectItem>
              <SelectItem value="prev_period">{t('trendsComparePrev')}</SelectItem>
              <SelectItem value="last_year">{t('trendsCompareLastYear')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ONE 2×2 GRID, not a 2-col row above a 12-col row.
          The `lg:grid-cols-12` signature is gone. In it TopActivitiesCard held
          3 (later 4) of 12 — about 230px, the same width as a stat figure — so a
          chart and a bare number occupied identical footprints, and the heatmap's
          `minWidth: 280` had to fight for the rest. Four equal cells at ~460px
          give every chart room to be a chart.

          The engagement matrix is an opt-in experiment (Settings → Experimental
          features) and is left exactly as that lane placed it: when it is on it
          is simply a fifth cell in the same grid. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
        <SessionsHeatmapCard
          sessions={data.sessions}
          newContactBookings={data.newContactBookings}
          compareWith={compareWith}
          comparisonSessions={data.comparisonSessions}
          comparisonNewContactBookings={data.comparisonNewContactBookings}
        />
        {showMatrix && (
          <EngagementMatrixCard weeklyReports={data.weeklyReports} trendsWeeks={trendsWeeks} />
        )}
      </div>

      {/* Temporarily hidden — restore the imports above to bring these back:
         Trial conversion + Correlation explorer.
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrialFunnelCard
          weeklyReports={data.weeklyReports}
          comparisonWeeklyReports={data.comparisonWeeklyReports}
          {...sharedProps}
        />
        <CorrelationExplorerCard
          weeklyReports={data.weeklyReports}
          sessions={data.sessions}
          allBookings={data.allBookings}
          newContactBookings={data.newContactBookings}
          trendsWeeks={trendsWeeks}
        />
      </div>
      */}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentTeamId, profile, team } = useAuth()
  const t = useTranslations('Dashboard')
  // The attention block's heading and its reason chips reuse the contacts
  // page's copy rather than keeping a second translation of the same words.
  const tContacts = useTranslations('Contacts')
  const affiliationTerm = useAffiliationTerm()

  const { data: contacts, isLoading: contactsLoading } = useContacts(currentTeamId)
  const { data: sessions, isLoading: sessionsLoading } = useUpcomingSessions(currentTeamId)
  const { data: subTypes = [] } = useSubscriptionTypes(currentTeamId)
  // Shared cache with the setup checklist card — no extra reads.
  const { steps: setupSteps, loading: setupLoading } = useSetupChecklist(currentTeamId)

  // UX-46: a studio with no contacts and no sessions has nothing for any of the
  // data cards to say, so it doesn't get them. `sessions` here is the checklist
  // probe (ANY session ever), not the upcoming-sessions query — a studio that
  // ran classes last month and has none booked ahead is not a new studio.
  const stepDone = (key: string) => setupSteps.find((s) => s.key === key)?.done ?? false
  const resolvingFirstRun = setupLoading || contactsLoading
  const isFirstRun = !resolvingFirstRun && !stepDone('contacts') && !stepDone('sessions')
  /** The data half of the dashboard: agenda, figures, money, roster, trends. */
  const showData = !resolvingFirstRun && !isFirstRun

  const activeMembers =
    contacts?.filter((c) => c.affiliation_summary?.has_active && !c.archived_at).length ?? null
  const thisWeek = weekStart()
  const prevWeek = new Date(thisWeek)
  prevWeek.setDate(prevWeek.getDate() - 7)
  const engagedThisWeek =
    contacts?.filter((c) => {
      if (!c.last_session_at) return false
      return (c.last_session_at as { toDate(): Date }).toDate() >= thisWeek
    }).length ?? null
  const engagedPrevWeek =
    contacts?.filter((c) => {
      if (!c.last_session_at) return false
      const d = (c.last_session_at as { toDate(): Date }).toDate()
      return d >= prevWeek && d < thisWeek
    }).length ?? null
  const upcomingBookingsCount =
    sessions?.reduce((sum, s) => sum + (s.bookings_count ?? 0), 0) ?? null
  const upcomingTrialsCount =
    sessions?.reduce((sum, s) => sum + (s.trial_bookings_count ?? 0), 0) ?? null

  const aggregatorIds = new Set(subTypes.filter((s) => s.source === 'aggregator').map((s) => s.id))
  const withSub = contacts?.filter((c) => !!c.subscription_type_id) ?? null
  const internalSubCount =
    withSub?.filter((c) => !aggregatorIds.has(c.subscription_type_id!)).length ?? null
  const aggregatorSubCount =
    withSub?.filter((c) => aggregatorIds.has(c.subscription_type_id!)).length ?? null

  // Zero extra reads: the attention list runs the shared predicate over the
  // contacts this page has already loaded.
  const attentionRows = useAttentionRows(contacts, team?.engagement_thresholds)

  const teamSlug = team?.slug ?? (profile as { slug?: string } | null)?.slug
  const statsLoading = contactsLoading || sessionsLoading

  return (
    <div className="space-y-8">
      {/* ── 0. Setup checklist — THE setup surface (UX-45). Auto-completes from
             real data, says so when it's finished, hides when dismissed. ── */}
      <SetupChecklist />

      {/* ── 0b. Team notifications (org access requests, etc.) ── */}
      <TeamNotificationsBanner />

      {/* ── 1. Welcome row: greeting left, daily quote right ── */}
      <section className="space-y-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex items-start gap-1.5 min-w-0">
            <DashboardHero profile={profile} team={team} />
          </div>
          <DailyQuote />
        </div>

        {/* ── 2. Quick actions (single dropdown chip on very small screens) ── */}
        <QuickActions teamSlug={teamSlug} />

        {/* While we're still deciding whether it IS day one. The wait used to
            be paid in a screenful of skeletons; it's one now. */}
        {resolvingFirstRun && <Skeleton className="h-64 w-full rounded-xl" />}

        {isFirstRun && (
          <div className="grid grid-cols-1 gap-6 lg:min-h-[380px] lg:grid-cols-3">
            <div className="lg:col-span-2">
              <FirstRunCard steps={setupSteps} />
            </div>
            <DiscoverPanel />
          </div>
        )}

        {/* ── 3. Agenda + discovery panel ──
            min-h gives the row a floor: both cards stretch (h-full), so without
            it the height collapses to whatever the discovery panel happens to
            need — around 275px on a quiet day, which reads as cramped. Desktop
            only; on mobile the cards stack and a floor would just add dead
            space. The agenda's own max-h (440px) is the ceiling above this. */}
        {showData && (
          <div className="grid grid-cols-1 gap-6 lg:min-h-[380px] lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AgendaCard teamId={currentTeamId} />
            </div>
            <DiscoverPanel />
          </div>
        )}
      </section>

      {showData && (
        <>
          {/* ── 4. Highlights ── The four figures. They lost their frames: a
              number has no interior to page through, so a box around one framed
              nothing. Hairline rail at lg, two-up below it. */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionHighlights')}</SectionHeading>
            <FigureRail cols={4}>
              <Figure title={t('statEngaged')} icon={TrendingUp} href="/contacts">
                <FigureNumber
                  value={engagedThisWeek}
                  subtitle={t('statEngagedSub')}
                  loading={statsLoading}
                  note={
                    <FigureNote>
                      +{engagedPrevWeek ?? '—'} {t('statEngagedPrev')}
                    </FigureNote>
                  }
                />
              </Figure>
              <Figure title={t('statBookings')} icon={BookOpen} href="/bookings">
                <FigureNumber
                  value={upcomingBookingsCount}
                  subtitle={t('statBookingsSub')}
                  loading={sessionsLoading}
                  note={
                    upcomingTrialsCount !== null ? (
                      <FigureNote>
                        +{upcomingTrialsCount} {t('statBookingsTrial')}
                      </FigureNote>
                    ) : undefined
                  }
                />
              </Figure>
              {/* These two used to ask the same question twice — "Subscribed"
                  (a `subscription_type_id`) beside the affiliation count
                  (`affiliation_summary.has_active`), both subtitled in terms of
                  subscriptions, side by side with nothing saying how they
                  differed. They count DIFFERENT things, and the subtitles now
                  say which: one of YOUR plans vs an active affiliation. */}
              <Figure title={t('statSubscribed')} icon={CreditCard} href="/contacts">
                <FigureNumber
                  value={internalSubCount}
                  subtitle={t('statSubscriptionsSub')}
                  loading={statsLoading}
                  note={
                    aggregatorSubCount !== null ? (
                      <FigureNote>
                        +{aggregatorSubCount} {t('statSubscribedAgg')}
                      </FigureNote>
                    ) : undefined
                  }
                />
              </Figure>
              <Figure title={affiliationTerm} icon={Users} href="/contacts">
                <FigureNumber
                  value={activeMembers}
                  subtitle={t('statAffiliationSub')}
                  loading={statsLoading}
                />
              </Figure>
            </FigureRail>
          </section>

          {/* ── 5. Needs attention ── Above money on purpose: it is the only
              block on the page that asks the studio to DO something today, and
              the people in it go cold while the rest of the dashboard is being
              read. On the background under its heading — no frame, because it
              defers to the contacts page rather than holding the answer. */}
          <section className="space-y-4">
            <SectionHeading action={<AttentionAction count={attentionRows.length} />}>
              {tContacts('sort_attention')}
            </SectionHeading>
            <AttentionList rows={attentionRows} loading={contactsLoading} />
          </section>

          {/* ── 6. Finance (Studio+ only) ── the question an owner opens the
              dashboard to answer, so it outranks the roster breakdown below. */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionFinance')}</SectionHeading>
            <PlanGate minPlan="studio" fallback={<FinanceUpsell />}>
              <DashboardFinanceSection teamId={currentTeamId} />
            </PlanGate>
          </section>

          {/* ── 7. Contacts snapshot ── */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionContactsSnapshot')}</SectionHeading>
            <ContactsSnapshot
              contacts={contacts}
              loading={contactsLoading}
              rankingSystems={team?.ranking_systems}
              engagementThresholds={team?.engagement_thresholds}
            />
          </section>

          {/* ── 8. Trends (Studio+ only) ── */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionTrends')}</SectionHeading>
            <PlanGate minPlan="studio" fallback={<TrendsUpsell />}>
              <TrendsSection teamId={currentTeamId} />
            </PlanGate>
          </section>
        </>
      )}
    </div>
  )
}
