'use client'

/**
 * THE PREVIEW DASHBOARD — built from the question rather than from the
 * incumbent.
 *
 * The question: **what should a studio see when it opens this app in the
 * morning?** Three things:
 *
 *   1. The hours it is about to run, and whether they are filling.
 *   2. The people waiting on a human — because people go cold.
 *   3. Whether the business is alright — a slower question, answered in one
 *      glance rather than studied.
 *
 * Everything else a studio might want to know has a page of its own that owns
 * it properly; putting a lesser copy of it here costs the first screen and
 * teaches nobody where the real one lives.
 *
 * ── THE COMPOSITION: TWO COLUMNS, AND THE MATERIALS FOLLOW THEM ──────────────
 *
 *      ┌──────────────────────────┐   Snapshot
 *      │  TODAY        (accent)   │   (figures, unframed)
 *      └──────────────────────────┘   revenue · attendance
 *      ┌──────────────────────────┐   subscriptions · affiliation
 *      │  WAITING ON YOU (accent) │   overlap bar
 *      └──────────────────────────┘   “ the quote
 *
 *      ───────────────  Trends (cards)  ───────────────
 *
 * The LEFT column is the work: two bounded lists, both wearing the accent
 * frame. The RIGHT rail is reference: bare figures and an aside, nothing
 * framed. Material and column agree, so the page says what kind of thing each
 * side is before a word of it is read.
 *
 * The rail does NOT acquire a frame for sitting in the top-right slot. The
 * frame marks work, not position.
 *
 * HIERARCHY COMES FROM SIZE. The day is the widest and tallest thing on the
 * page; the queue is the same width and shorter; the rail is a third of the
 * width. Nothing is ranked by decoration, and a future block must not be given
 * a new border treatment to rank it — make it bigger or smaller.
 *
 * ── THE COST OF THE 2026-08-18 SWAP, stated rather than buried ───────────────
 *
 * The snapshot took the top-right slot and the queue moved beneath the day.
 * This page's original argument was ACTION BEFORE ORIENTATION — the eye lands
 * on the day, then on the people waiting — and putting four numbers in the
 * second-most-prominent slot inverts it.
 *
 * The read after building it: RELOCATED, NOT DEMOTED. The queue is still fully
 * above the fold, it is now the full-width block directly under the primary
 * one, and it gained the width its rows always needed (a one-line row, and a
 * cap of eight instead of five). Four numbers cost one saccade on the way past.
 *
 * The thing that would change that verdict: the rail growing. A snapshot of
 * four facts is a glance; a snapshot of eight becomes a wall between the day
 * and the people, and at that point the queue really is demoted. Add to the
 * rail only by replacing.
 *
 * ── WHAT IT DROPS, and why (each of these is on the incumbent) ───────────────
 *
 *   - **Roster + demographics cards.** Composition analysis, and the contacts
 *     page owns it. Nobody asks about their age distribution before opening the
 *     doors. (The rail's overlap bar is not a re-entry: it decomposes two
 *     figures already in the band rather than opening a new subject — see
 *     `SnapshotColumn`.)
 *   - **Recent payments.** A five-row copy of the /payments list. The one thing
 *     about payments that is a MORNING task — money with nobody attached to it
 *     — is in the queue instead, as a task rather than a statistic.
 *   - **Discover.** Tips and plugin upsells. A shelf you go to, not a thing you
 *     are handed while you are trying to find out whether the 09:00 is full.
 *   - **The setup checklist as a band.** On day one it is the whole page (see
 *     `isFirstRun` below — it SUBSTITUTES rather than stacking). After day one
 *     it is one row in the queue, because that is what it is: work waiting on a
 *     human.
 *   - **The "active members" figure.** It counted the same field as the
 *     affiliation figure under a friendlier name.
 *
 * WHAT IT KEEPS: the trend cards, by instruction; the incumbent's two-material
 * rule; and the daily quote, which stopped being a footer nobody scrolls to and
 * became the foot of the rail.
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
import { SnapshotColumn } from '@/components/dashboard-preview/SnapshotColumn'
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

      {resolving && <Skeleton className="h-[320px] w-full rounded-xl" />}

      {/* DAY ONE SUBSTITUTES, it does not stack. A studio with no contacts and
          no sessions has nothing for the day, the queue, the snapshot or the
          trends to say, and stacking a checklist on top of four empty blocks
          teaches a new studio that this page is mostly empty. */}
      {!resolving && isFirstRun && <FirstRunCard steps={setupSteps} />}

      {!resolving && !isFirstRun && (
        <>
          {/* ── THE FIRST SCREEN ──
              8:4 of twelve — ~683px of work against a ~332px rail.

              THE TWO COLUMNS OWN THEIR OWN HEIGHTS, and that is the mechanism
              that makes the rail's blank space composition rather than luck.
              Grid items stretch, so both columns are as tall as the taller one;
              the work column pins the day at 320px and lets the QUEUE absorb
              the remainder (`flex-1`), while the rail spreads its content with
              `justify-between` so the quote lands on the queue's bottom edge.
              A long quote or a busy queue therefore lengthens the band without
              either column growing a ragged tail. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* THE WORK — both blocks framed, biggest first. */}
            <div className="flex flex-col gap-5 lg:col-span-8">
              <div className="h-[320px] shrink-0">
                <TodayPanel teamId={currentTeamId} />
              </div>
              <div className="min-h-[280px] lg:flex-1">
                <QueuePanel
                  teamId={currentTeamId}
                  contacts={contacts}
                  contactsLoading={contactsLoading}
                  engagementThresholds={team?.engagement_thresholds}
                  setupSteps={setupSteps}
                  setupLoading={setupLoading}
                />
              </div>
            </div>

            {/* THE RAIL — reference, unframed, and deliberately airy. */}
            <div className="lg:col-span-4">
              <SnapshotColumn
                teamId={currentTeamId}
                contacts={contacts}
                loading={contactsLoading}
              />
            </div>
          </div>

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
