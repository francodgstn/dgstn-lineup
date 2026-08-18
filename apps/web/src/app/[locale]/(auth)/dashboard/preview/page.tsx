'use client'

/**
 * THE PREVIEW DASHBOARD — the incumbent's top-area ARRANGEMENT, in this page's
 * style.
 *
 * ── THE COMPOSITION ──────────────────────────────────────────────────────────
 *
 *      ┌────────────────────────────┐  Snapshot
 *      │  TODAY          (accent)   │  ENGAGED    ·  BOOKINGS
 *      │  7/12 · 280px              │  SUBSCRIBED ·  AFFILIATION
 *      └────────────────────────────┘  REVENUE    ·  UNASSIGNED
 *      ┌────────────────────────────┐  Contacts   [view ▾]
 *      │  WAITING ON YOU (accent)   │   ◕  legend rows
 *      │  7/12 · 232px              │      beside the ring
 *      └────────────────────────────┘
 *                  “ the quote — the working area's sign-off
 *      ──────────────  Trends (cards, Studio+)  ──────────────
 *
 * Row 1: the day beside six figures in two columns. Row 2: the queue beside the
 * contacts donut. Left column framed (work), right column unframed (reference).
 * That is the incumbent's layout; everything about how it is drawn is this
 * page's.
 *
 * ── WHAT THIS COST, stated rather than buried ────────────────────────────────
 *
 * **Hierarchy from size is now width-only, and that is a real loss.** The rule
 * was: exactly one primary block, bigger than everything else in BOTH
 * dimensions. The day is still the widest single object (594px against 417px)
 * and still the tallest framed one — but the figure block opposite it is now a
 * six-cell grid, so the top of the page is a PAIR rather than a subject and its
 * margin. The frame is what keeps them apart: it still marks WORK, not
 * importance and not position, which is why six figures and a donut sit
 * opposite two accent panels without acquiring one.
 *
 * **The "add only by replacing" note was a warning, and the warning came
 * true.** It said four facts is a glance and eight is a wall between the day
 * and the people. This is six facts plus a chart, and the queue has moved from
 * beside the day to beneath it — so the wall is now real: the eye reaches the
 * people after crossing six numbers. It is still above the fold, at full width,
 * with one-line rows, which is why this reads as reordering rather than
 * demotion. But the note is no longer a caution about a hypothetical; it is a
 * description of the page, and the honest version of it is: **the right-hand
 * column is full.** Anything further goes below the fold or replaces something.
 *
 * ── WHAT IT STILL DROPS ──────────────────────────────────────────────────────
 *
 *   - **Recent payments.** A five-row copy of the /payments list. The one thing
 *     about payments that is a MORNING task — money with nobody attached to it
 *     — is a figure AND a queue row, not a table.
 *   - **Discover.** Tips and plugin upsells: a shelf you go to, not a thing you
 *     are handed while finding out whether the 09:00 is full.
 *   - **The setup checklist as a band.** On day one it is the whole page (see
 *     `isFirstRun` — it SUBSTITUTES rather than stacking). After day one it is
 *     one row in the queue, because that is what it is: work waiting on a human.
 *   - **The demographics half of the contacts card**, and the multi-valued
 *     roster views with it — see `RosterDonut` for why a bar list cannot share
 *     the chart-left/legend-right geometry.
 *   - **The subscription/affiliation overlap bar**, removed by decision. Its job
 *     passes to the two subtitles, which are now load-bearing copy.
 */

import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { CalendarPlus, UserPlus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { useSetupChecklist } from '@/hooks/useSetupChecklist'
import { Skeleton } from '@/components/ui/skeleton'
import { PlanUpgradeNotice } from '@/components/plan/PlanUpgradeNotice'
import { FirstRunCard } from '@/components/dashboard/FirstRunCard'
import { TeamNotificationsBanner } from '@/components/dashboard/TeamNotificationsBanner'
import { TodayPanel } from '@/components/dashboard-preview/TodayPanel'
import { QueuePanel } from '@/components/dashboard-preview/QueuePanel'
import { FiguresBlock } from '@/components/dashboard-preview/FiguresBlock'
import { RosterDonut } from '@/components/dashboard-preview/RosterDonut'
import { DailyAside } from '@/components/dashboard-preview/DailyAside'
import { WeekSection } from '@/components/dashboard-preview/WeekSection'
import { usePreviewContacts } from '@/components/dashboard-preview/preview-data'

/**
 * ONE LINE, and it is the whole header.
 *
 * A greeting, the date, the team, and the two actions a studio actually starts
 * from. It is ~41px because everything it says is context — the first thing
 * with an answer in it should be the first thing below it.
 */
function Header({ children }: { children: React.ReactNode }) {
  const t = useTranslations('NewDashboard')
  const locale = useLocale()
  const { profile, team } = useAuth()

  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? t('greetingMorning') : hour < 17 ? t('greetingAfternoon') : t('greetingEvening')
  const firstName = profile?.firstname ?? profile?.displayName?.split(' ')[0] ?? ''
  const dateStr = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-heading truncate text-xl font-bold leading-tight tracking-tight text-heading">
          {greeting}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="truncate text-xs text-muted-foreground">
          <span className="capitalize">{dateStr}</span>
          {team?.name ? ` · ${team.name}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function HeaderAction({
  href,
  icon: Icon,
  label,
}: {
  href: Route
  icon: React.ElementType
  label: string
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted/60"
    >
      <Icon className="h-3.5 w-3.5 text-primary" />
      {label}
    </Link>
  )
}

export default function DashboardPreviewPage() {
  const t = useTranslations('NewDashboard')
  const { currentTeamId, team } = useAuth()
  const { isAtLeast, isLoading: planLoading } = usePlan()

  const { data: contacts, isLoading: contactsLoading } = usePreviewContacts(currentTeamId)
  const { steps: setupSteps, loading: setupLoading } = useSetupChecklist(currentTeamId)

  const stepDone = (key: string) => setupSteps.find((s) => s.key === key)?.done ?? false
  const resolving = setupLoading || contactsLoading
  // Day one: no contacts and no sessions ever. Not "the checklist is unfinished".
  const isFirstRun = !resolving && !stepDone('contacts') && !stepDone('sessions')

  return (
    <div className="space-y-5">
      <TeamNotificationsBanner />

      <Header>
        <HeaderAction
          href={'/schedule' as Route}
          icon={CalendarPlus}
          label={t('actionNewSession')}
        />
        <HeaderAction href={'/contacts' as Route} icon={UserPlus} label={t('actionNewContact')} />
      </Header>

      {resolving && <Skeleton className="h-[264px] w-full rounded-xl" />}

      {/* DAY ONE SUBSTITUTES, it does not stack. A studio with no contacts and
          no sessions has nothing for the day, the queue, the figures or the
          donut to say, and stacking a checklist on top of four empty blocks
          teaches a new studio that this page is mostly empty. */}
      {!resolving && isFirstRun && <FirstRunCard steps={setupSteps} />}

      {!resolving && !isFirstRun && (
        <>
          {/* ── ROW 1 — the day, and the six figures ──
              7:5 of twelve: ~594px against ~417px, which is what puts each
              figure column at ~196px — the width a value-beside-its-subtitle
              cell needs, and the reason six of them fit here at all.
              280px tall (it was 320): the agenda is a bit smaller, by
              instruction, and still shows five sessions before it scrolls.
              The figure block opposite runs ~275px, so it fits the row without
              setting it — the day still owns the height. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 lg:h-[264px]">
              <TodayPanel teamId={currentTeamId} />
            </div>
            <div className="lg:col-span-5">
              <FiguresBlock
                teamId={currentTeamId}
                contacts={contacts}
                loading={contactsLoading}
              />
            </div>
          </div>

          {/* ── ROW 2 — the queue, and who the contacts are ──
              Same 7:5 columns, so the page has ONE vertical seam rather than
              two: the framed work stacks on the left, the unframed reference
              stacks on the right, and the eye only has to learn the split once.
              232px — the queue is smaller too, four one-line rows before it
              scrolls (the cap is still 8, and the header carries the count),
              and the 190px donut sits comfortably inside the same height.

              THE WHOLE OF THIS FITS 720px, quote included: 24 + 41 + 20 + 264
              + 20 + 220 + 20 + ~66 = ~655 (MEASURED: quote ends at ~710). The two heights above are the
              adjustable pair — spend them here, not on the sign-off. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 lg:h-[220px]">
              <QueuePanel
                teamId={currentTeamId}
                contacts={contacts}
                contactsLoading={contactsLoading}
                engagementThresholds={team?.engagement_thresholds}
                setupSteps={setupSteps}
                setupLoading={setupLoading}
              />
            </div>
            <div className="lg:col-span-5">
              <RosterDonut
                contacts={contacts}
                thresholds={team?.engagement_thresholds}
                loading={contactsLoading}
              />
            </div>
          </div>

          {/* The working area's sign-off — see `DailyAside` for why it lands
              here rather than under the charts. */}
          <DailyAside />

          {/* Trends are Studio+. The gate is read directly rather than through
              `PlanGate` so the tier's answer can be WAITED FOR: `usePlan`
              reports `false` while the team doc is still loading, and a page
              that flashes an upgrade notice at a paying studio every morning is
              worse than one that waits 200ms. Below Studio the page simply gets
              shorter — one notice, and no hole where four charts were. */}
          {planLoading ? null : isAtLeast('studio') ? (
            <WeekSection teamId={currentTeamId} />
          ) : (
            <PlanUpgradeNotice
              minPlan="studio"
              title={t('trendsTitle')}
              description={t('trendsUpsell')}
            />
          )}
        </>
      )}
    </div>
  )
}
