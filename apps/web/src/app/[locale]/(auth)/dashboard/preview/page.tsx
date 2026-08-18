'use client'

/**
 * THE PREVIEW DASHBOARD — a second answer, built from the question rather than
 * from the incumbent.
 *
 * The question: **what should a studio see when it opens this app in the
 * morning?** Three things, in this order:
 *
 *   1. The hours it is about to run, and whether they are filling.
 *   2. The people waiting on a human — because people go cold.
 *   3. Whether the business is alright — which is a WEEKLY question, not a
 *      daily one, and therefore not the top of the page.
 *
 * Everything else a studio might want to know has a page of its own that owns
 * it properly, and putting a lesser copy of it here costs the first screen and
 * teaches nobody where the real one lives. So this page is FOUR blocks:
 *
 *   header · [ THE DAY | THE QUEUE ] · the pulse · this quarter's trends
 *
 * WHAT IT DROPS, and why (each of these is on the incumbent):
 *
 *   - **Roster + demographics cards.** Composition analysis, and the contacts
 *     page owns it. Nobody asks "what is my age distribution" before opening
 *     the doors.
 *   - **Recent payments.** A five-row copy of the /payments list. The one thing
 *     about payments that is a MORNING task — money with nobody attached to it
 *     — is in the queue instead, as a task rather than a statistic.
 *   - **Discover.** Tips and plugin upsells. A shelf you go to, not a thing you
 *     are handed while you are trying to find out whether the 09:00 is full.
 *   - **The setup checklist as a band.** On day one it is the whole page (see
 *     `isFirstRun` below — it SUBSTITUTES rather than stacking). After day one
 *     it is one row in the queue, because that is what it is: work waiting on a
 *     human.
 *   - **Four of the six stat figures.** Three is what one glance holds.
 *
 * WHAT IT KEEPS: the trend cards, by instruction, and the incumbent's
 * two-material rule (a bordered surface for a bounded thing, a bare number on
 * the background), with one rule added — **hierarchy comes from size, never
 * from decoration**. Exactly one block on this page is primary and it is
 * primary because it is bigger.
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
import { getDailyQuote } from '@/data/quotes'
import { TodayPanel } from '@/components/dashboard-preview/TodayPanel'
import { QueuePanel } from '@/components/dashboard-preview/QueuePanel'
import { PulseRail } from '@/components/dashboard-preview/PulseRail'
import { WeekSection } from '@/components/dashboard-preview/WeekSection'
import { usePreviewContacts } from '@/components/dashboard-preview/preview-data'

/**
 * ONE LINE, and it is the whole header.
 *
 * A greeting, the date, the team, and the two actions a studio actually starts
 * from. It is 46px because everything it says is context — the first thing with
 * an answer in it should be the first thing below it.
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

function DailyQuote() {
  const quote = getDailyQuote()
  return (
    <p className="pt-1 text-center text-xs italic text-muted-foreground/60">
      &ldquo;{quote.text}&rdquo; — {quote.author}
    </p>
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

      {resolving && <Skeleton className="h-[336px] w-full rounded-xl" />}

      {/* DAY ONE SUBSTITUTES, it does not stack. A studio with no contacts and
          no sessions has nothing for the day, the queue, the pulse or the
          trends to say, and stacking a checklist on top of four empty blocks
          teaches a new studio that this page is mostly empty. */}
      {!resolving && isFirstRun && <FirstRunCard steps={setupSteps} />}

      {!resolving && !isFirstRun && (
        <>
          {/* ── THE WORKING ROW ──
              3:2, and the asymmetry is the point. Two equal halves give the eye
              no landing place; the incumbent's every band is a 50/50 split of
              equals, eight deep. Here the day is ~600px wide and the queue
              ~400px, both 292px tall, and the row owns the height so a busy
              Tuesday and a quiet queue still start and end on the same lines. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:[&>*]:h-[334px]">
            <div className="lg:col-span-3">
              <TodayPanel teamId={currentTeamId} />
            </div>
            <div className="lg:col-span-2">
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

          <PulseRail teamId={currentTeamId} contacts={contacts} loading={contactsLoading} />

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

      {/* The sign-off. Kept from the incumbent deliberately: it is Franco's, it
          is the last thing on the page, and it costs the first screen nothing. */}
      <DailyQuote />
    </div>
  )
}
