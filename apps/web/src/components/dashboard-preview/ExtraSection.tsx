'use client'

/**
 * THE EXTRA SHELF — built, working, and deliberately not shown.
 *
 * When the two dashboards were consolidated, the incumbent's page was replaced
 * wholesale. Most of what it dropped was dropped ON PURPOSE and is documented as
 * such in the dashboard page's header. These panels are the other kind: code
 * that works, that nobody had decided against, and that deleting would have
 * thrown away for no reason other than that the new composition had no room for
 * it.
 *
 * So they are parked here rather than removed, behind ONE switch
 * (`extra-dashboard`, Settings → Experimental). The section is off by default,
 * and the honest reading of "off by default" is that this is a holding area, not
 * a feature: whatever is still in here when the shape is decided either earns a
 * place on the page above or gets deleted properly.
 *
 * ── WHY ONE SWITCH AND NOT FOUR ──────────────────────────────────────────────
 * The engagement matrix already had its own experimental id. Keeping it once the
 * card moved in here would have meant two switches gating one card — the outer
 * section and the inner flag — where the inner one could only ever be a no-op or
 * a trap. The section's flag replaced it. Per-card switches become worth it when
 * somebody wants one of these without the others; until then they are four
 * settings rows describing one decision.
 *
 * ── THE PERIOD IS FIXED, DELIBERATELY ────────────────────────────────────────
 * `WeekSection` above owns the range and comparison controls. These cards read
 * the same dataset at its DEFAULTS (13 weeks, no comparison) rather than
 * carrying a second pair of selectors: react-query keys on those arguments, so
 * at the defaults this is a cache hit and costs nothing, and a parked panel does
 * not need its own chrome. If one of these graduates to the page above, it
 * inherits that section's controls and this note goes with it.
 *
 * AI insights is the intended next tenant — `plugins/ai-insights` is
 * `status: 'coming_soon'` with no card to mount today, so there is nothing to
 * add here yet. Mount it here when it exists.
 */

import { useTranslations } from 'next-intl'
import { useDashboardData } from '@/hooks/useDashboardData'
import {
  DashboardFinanceFigures,
  DashboardRecentPayments,
  DashboardFinanceTrends,
} from '@/components/dashboard/DashboardFinanceSection'
import { EngagementMatrixCard } from '@/components/dashboard/EngagementMatrixCard'
import { TrialFunnelCard } from '@/components/dashboard/TrialFunnelCard'
import { CorrelationExplorerCard } from '@/components/dashboard/CorrelationExplorerCard'

/** WeekSection's defaults. Matching them is what makes the query a cache hit. */
const EXTRA_WEEKS = 13
const EXTRA_COMPARE = 'none' as const

export function ExtraSection({ teamId }: { teamId: string | null }) {
  const t = useTranslations('NewDashboard')
  const data = useDashboardData(teamId, EXTRA_WEEKS, EXTRA_COMPARE)

  const shared = { trendsWeeks: EXTRA_WEEKS, compareWith: EXTRA_COMPARE }

  return (
    <section className="space-y-4">
      {/* Same hairline-and-title idiom as Trends above it, one step quieter:
          this heading names a holding area, not a part of the product. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-4">
        <h2 className="font-heading text-sm font-bold tracking-tight text-heading">
          {t('extraTitle')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('extraSubtitle')}</p>
      </div>

      {/* Finance. Three separate exports rather than one block, because that is
          how the incumbent composed them and each self-gates: the trends half
          returns null unless the finance plugin is installed. */}
      <DashboardFinanceFigures teamId={teamId} />
      <DashboardRecentPayments teamId={teamId} />
      <DashboardFinanceTrends teamId={teamId} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EngagementMatrixCard weeklyReports={data.weeklyReports} trendsWeeks={EXTRA_WEEKS} />
        <TrialFunnelCard
          weeklyReports={data.weeklyReports}
          comparisonWeeklyReports={data.comparisonWeeklyReports}
          {...shared}
        />
      </div>

      <CorrelationExplorerCard
        weeklyReports={data.weeklyReports}
        sessions={data.sessions}
        allBookings={data.allBookings}
        newContactBookings={data.newContactBookings}
        trendsWeeks={EXTRA_WEEKS}
      />
    </section>
  )
}
