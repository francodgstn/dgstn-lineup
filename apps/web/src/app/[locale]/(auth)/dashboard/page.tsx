'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import { ContactsOverviewCard } from '@/components/dashboard/ContactsOverviewCard'
import { ContactsSummaryCard } from '@/components/dashboard/ContactsSummaryCard'
import { BookingsTrendCard } from '@/components/dashboard/BookingsTrendCard'
import { SessionsHeatmapCard } from '@/components/dashboard/SessionsHeatmapCard'
import { TopActivitiesCard } from '@/components/dashboard/TopActivitiesCard'
import { EngagementMatrixCard } from '@/components/dashboard/EngagementMatrixCard'
import { useExperimentalFeatures } from '@/hooks/useExperimentalFeatures'
import {
  DashboardFinanceFigures,
  DashboardFinanceTrends,
  DashboardRecentPayments,
} from '@/components/dashboard/DashboardFinanceSection'
// Temporarily hidden — restore alongside the commented rows in TrendsSection:
// import { TrialFunnelCard } from '@/components/dashboard/TrialFunnelCard'
// import { CorrelationExplorerCard } from '@/components/dashboard/CorrelationExplorerCard'
import { DiscoverPanel } from '@/components/dashboard/DiscoverPanel'
import { TeamNotificationsBanner } from '@/components/dashboard/TeamNotificationsBanner'
import { FirstRunCard } from '@/components/dashboard/FirstRunCard'
import { PlanUpgradeNotice } from '@/components/plan/PlanUpgradeNotice'
import { useSetupChecklist } from '@/hooks/useSetupChecklist'
import { usePlan } from '@/hooks/usePlan'

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

/**
 * THE SIGN-OFF, and it used to be a claim on the first screen.
 *
 * It sat in the greeting row's right half, which is precisely where the quick
 * actions belong — so the greeting and the actions each got a line of their own
 * and the pair cost 90px of the best band to say two things that fit on one.
 * The quote is a mood piece and it is the last word on the page now: zero
 * vertical cost above the fold, nothing deleted.
 */
function DailyQuote() {
  const quote = getDailyQuote()
  return (
    <p className="text-center text-xs italic text-muted-foreground/60">
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
    /* THE CARD FILLS ITS COLUMN, in whichever direction it needs to.
       It is one grid cell beside a column holding TWO stacked figure sections,
       and which of the two is taller depends on the day: `h-full` + a
       `flex-1 min-h-0` scroll region means a quiet Tuesday's agenda GROWS to
       meet the figures column rather than leaving a hole, while a full one is
       held at the shipped 440px ceiling and the figures column is simply
       shorter. Neither side is padded to match the other.

       Its title and "all sessions" link are the SECTION BAND above it now — the
       same idiom as every other block, and ~34px of card chrome back. */
    <Card className="flex h-full flex-col gap-2 py-3">
      <CardHeader>
        {/* Day navigator — compact, left-aligned; click the label to jump to today */}
        <div className="flex w-fit items-center gap-0.5">
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
      <CardContent className="flex flex-col p-0 lg:min-h-0 lg:flex-1">
        {/* px-3 here + px-1 on a row puts a session title at 16px from the card
            edge — the same place CardHeader's px-4 puts the day navigator. It was
            px-6 + px-1, i.e. 28px, so the header and every row it labelled were
            visibly out of line. */}
        {/* `flex-1` is lg-ONLY on purpose. It is what lets the scroll region
            fill a column stretched by its neighbour — but a `flex-basis: 0` item
            inside an auto-height flex column is asking the browser to size a box
            from a box it is sizing, and below `lg` the card HAS no height. There
            it is an ordinary block. The 440px ceiling applies at EVERY width: it
            is what stops a twelve-class Saturday from setting a row height the
            figures beside it could never reach. */}
        <div className="max-h-[440px] overflow-y-auto px-3 pb-3 lg:min-h-0 lg:flex-1">
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

// TWO LINES, NOT ONE. The block lives in a third of the page now (~330px at
// 1280, ~244px between `lg` and `xl`), and a name beside a reason chip on one
// line there is a choice between truncating the person and dropping the reason.
// Both are the point: a name with no reason is an urgency list nobody trusts,
// and a reason attached to "Alexandra Baum…" is barely better. So the chip sits
// under the name — the mobile list-row shape, which is what a narrow column is.
function AttentionRow({ contact, reason }: { contact: Contact; reason: ContactAttentionReason }) {
  const tc = useTranslations('Contacts')
  const initials = `${contact.firstname?.[0] ?? ''}${contact.lastname?.[0] ?? ''}`.toUpperCase() || '?'
  return (
    <Link
      href={`/contacts/${contact.id}` as Route}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
        <span className="text-xs font-semibold text-amber-600">{initials}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">
          {contact.firstname} {contact.lastname}
        </p>
        <Badge
          variant="outline"
          className="mt-1 border-amber-300 px-1.5 py-0 text-[11px] font-normal leading-[1.35] text-amber-600"
        >
          {tc(`attention_${reason}` as 'attention_alerts')}
        </Badge>
      </div>
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

  // ONE COLUMN, always. It was `sm:grid-cols-2` from when it spanned the whole
  // page; a third of 1035px cannot hold two of these side by side.
  if (loading) {
    return (
      <div className="space-y-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
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
    <div className="space-y-0.5">
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

// Finance's refusal now stands in the first screen's figures column, under
// Highlights, where it is standing in for a 74px figure body. It drops the
// `sm:p-6` step the standalone panel takes: a gate cannot be as short as two
// numbers, but it should not be twice them either.
function FinanceUpsell() {
  const t = useTranslations('Dashboard')
  return (
    <PlanUpgradeNotice
      minPlan="studio"
      title={t('sectionFinance')}
      description={t('financeUpsell')}
      className="sm:p-4"
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
  // The recent-payments section band reuses the finance block's own strings
  // rather than keeping a second copy of "Recent payments" / "View all".
  const tFinance = useTranslations('DashboardFinance')
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
  // The second row is 2:1 only when there is something in its right third.
  // `PlanGate` can hide the card, but it cannot tell the row beside it to
  // reflow — so the plan is read here and the grid is chosen once.
  const { isAtLeast } = usePlan()
  const showPayments = isAtLeast('studio')

  return (
    <div className="space-y-8">
      {/* ── 0. Setup checklist — THE setup surface (UX-45). Auto-completes from
             real data, says so when it's finished, hides when dismissed. ── */}
      <SetupChecklist />

      {/* ── 0b. Team notifications (org access requests, etc.) ── */}
      <TeamNotificationsBanner />

      {/* ── 1. THE HEADER ROW — greeting left, quick actions right ──
             Two lines became one. The greeting and the actions were stacked
             with the daily quote parked in the greeting's right half, so the
             band between the checklist and the first content ran 164px to
             deliver a name, a date and four pills. The quote is the page's
             sign-off now (see DailyQuote) and the actions take the space it
             was holding. */}
      <section className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <DashboardHero profile={profile} team={team} />
          <QuickActions teamSlug={teamSlug} />
        </div>

        {/* While we're still deciding whether it IS day one. The wait used to
            be paid in a screenful of skeletons; it's one now. */}
        {resolvingFirstRun && <Skeleton className="h-64 w-full rounded-xl" />}

        {/* Day one keeps its own three-card shape, untouched — the Discover
            panel is the newcomer's second card there, which is the one place it
            is the point rather than an interruption. */}
        {isFirstRun && (
          <div className="grid grid-cols-1 gap-6 lg:min-h-[380px] lg:grid-cols-3">
            <div className="lg:col-span-2">
              <FirstRunCard steps={setupSteps} />
            </div>
            <DiscoverPanel />
          </div>
        )}

        {/* ── THE FIRST SCREEN — one row, two columns ──
            LEFT: the agenda. RIGHT: the figure sections, stacked.

            This shape replaced a pair of figure sections side by side, which
            Franco read as "even more confusing" — and he was right about why:
            pairing two sections of the SAME material makes their internal grids
            each other's problem, so a 2×2 of numbers had to rhyme with a 2×1 of
            numbers and neither was allowed to be what it wanted. Pairing ONE
            TALL THING with ONE COLUMN OF STACKED THINGS needs no rhyme at all.
            The agenda is a scroll region, so it can be any height; the figures
            underneath each other read top-to-bottom like a panel, which is how
            numbers are read anyway.

            50/50, and not a 2:1 in the agenda's favour: at half of 1035px every
            figure on the page lands at ~228px — the same width the old
            four-across rail gave them — so Highlights, Finance and the roster
            figures below are all one size. A 2:1 split would have squeezed the
            figures to ~145px to give width to a list of session names that does
            not need it. The two columns' section bands then start at the same
            two x-positions, which is the alignment the stacked strips never had.

            The row is NOT decreed a height. Each column takes the height it
            wants and the taller one wins: a quiet day's agenda grows to meet the
            figures (see AgendaCard), a full one is capped at its 440px ceiling
            and the figures column simply ends earlier. Nothing is padded to
            match — a stretched figure section stops looking like figures. */}
        {showData && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ── the day ── */}
            <section className="flex flex-col gap-4">
              <SectionHeading
                action={
                  <Link
                    href={'/schedule' as Route}
                    className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                  >
                    {t('allSessions')} <ArrowRight className="h-3 w-3" />
                  </Link>
                }
              >
                {t('agenda')}
              </SectionHeading>
              <div className="min-h-0 lg:flex-1">
                <AgendaCard teamId={currentTeamId} />
              </div>
            </section>

            {/* ── the numbers ── one gutter: the gap between the two sections in
                this column is the same 24px as the gap between the columns. */}
            <div className="space-y-6">
              <section className="space-y-4">
                <SectionHeading>{t('sectionHighlights')}</SectionHeading>
                <FigureRail>
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
                      (`affiliation_summary.has_active`), both subtitled in terms
                      of subscriptions, side by side with nothing saying how they
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

              <section className="space-y-4">
                <SectionHeading>{t('sectionFinance')}</SectionHeading>
                <PlanGate minPlan="studio" fallback={<FinanceUpsell />}>
                  <DashboardFinanceFigures teamId={currentTeamId} />
                </PlanGate>
              </section>
            </div>
          </div>
        )}
      </section>

      {showData && (
        <>
          {/* ── THE SECOND ROW — three equal thirds ──
              Needs attention · Recent payments · Contacts.

              THIRDS RATHER THAN A RATIO, and the merge is what paid for it: the
              roster and demographics cards were the same component twice, so
              collapsing them into one `ContactsOverviewCard` freed a column and
              pulled the last non-analytical block up out of the bottom of the
              page. What is left down there is four trend charts and nothing
              else, which is what "analytical" should have meant all along.

              330px A COLUMN, AND IT FITS — checked against what these actually
              draw. The contacts card is a 144px donut over a vertical legend,
              not a plot with axes: at 330px it has 298px of content, so the
              donut has 154px to spare and each legend row gives a label ~212px.
              A four-chart grid could not go three-up here; this can. The one
              real cost is in the affiliation and subscription views, where a
              long subscription-type name now truncates — it carries a `title`
              attribute so the full name is still reachable.

              MIXED MATERIALS, DELIBERATELY. Attention is a list on the
              background (it defers to the contacts page and holds no answer);
              payments and contacts are cards (a bounded list you click into, and
              a plotting surface). The heights differ — roughly 280 / 165 / 335
              body pixels — and NOTHING is padded to match: stretching a figure
              or a five-row ledger to meet a donut is how a block stops looking
              like what it is. The shortest sits in the middle, so the row reads
              as a valley rather than a step.

              NO SECTION SPANS TWO ROWS. Finance's figures are in the row above;
              this ledger is under its OWN band, built from the
              `recentTitle`/`recentViewAll` strings it already carried as a
              `CardTitle`. One heading governing content in two places with the
              agenda in between is a mistake even when it is intentional.

              Below Studio there is no payments card, so the row is two columns
              rather than three-with-a-hole. It is not offered a second upgrade
              notice: one for that tier already stands in the figures column. */}
          <div
            className={`grid grid-cols-1 gap-6 ${
              showPayments ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
            }`}
          >
            <section className="space-y-4">
              <SectionHeading action={<AttentionAction count={attentionRows.length} />}>
                {tContacts('sort_attention')}
              </SectionHeading>
              <AttentionList rows={attentionRows} loading={contactsLoading} />
            </section>

            {showPayments && (
              <section className="space-y-4">
                <SectionHeading
                  action={
                    <Link
                      href={'/payments' as Route}
                      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                    >
                      {tFinance('recentViewAll')} <ArrowRight className="h-3 w-3" />
                    </Link>
                  }
                >
                  {tFinance('recentTitle')}
                </SectionHeading>
                <DashboardRecentPayments teamId={currentTeamId} />
              </section>
            )}

            <section className="space-y-4">
              <SectionHeading>{t('sectionContactsSnapshot')}</SectionHeading>
              {contactsLoading ? (
                <Skeleton className="h-72 rounded-xl" />
              ) : (
                <ContactsOverviewCard
                  contacts={contacts ?? []}
                  thresholds={team?.engagement_thresholds}
                  rankingSystems={team?.ranking_systems}
                />
              )}
            </section>
          </div>

          {/* The finance plugin's charts — analytical, headless (they carry
              their own heading), and gated on the plugin inside. */}
          {showPayments && <DashboardFinanceTrends teamId={currentTeamId} />}

          {/* ── Trends (Studio+ only) ── */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionTrends')}</SectionHeading>
            <PlanGate minPlan="studio" fallback={<TrendsUpsell />}>
              <TrendsSection teamId={currentTeamId} />
            </PlanGate>
          </section>

          {/* ── Discover ── LAST, and that is Franco's call. Tips and plugin
              upsells owned half the widest row above the fold — the only block
              on the first screen that asked for nothing and answered nothing.
              Below the trends it is a shelf you go to, not a thing you are
              handed. */}
          <section className="space-y-4">
            <SectionHeading>{t('sectionDiscover')}</SectionHeading>
            <DiscoverPanel />
          </section>
        </>
      )}

      <DailyQuote />
    </div>
  )
}
