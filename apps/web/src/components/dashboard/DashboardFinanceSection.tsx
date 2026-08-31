'use client'

// The finance plugin's dashboard charts (Studio+).
//
// ── THIS FILE USED TO HOLD THREE THINGS ─────────────────────────────────────
// `DashboardFinanceFigures` (Revenue + Unassigned) and `DashboardRecentPayments`
// were here too, mounted only on the experimental extra shelf. Both were removed
// on 2026-08-31 rather than left as unmounted exports:
//
//  • Revenue is on the dashboard already — `RevenueFigure` in
//    dashboard-preview/FiguresBlock.tsx, reading the same `useMonthlyRevenue`
//    hook. Two components rendering one number is how they drift; the shipped
//    one won.
//  • Unassigned is a FILING TASK, not a figure. "Three payments nobody has
//    matched to a person yet" is a to-do the /payments page shows in context,
//    with the rows next to it; as a headline number on a dashboard it takes the
//    weight of a metric and can only be acted on somewhere else.
//  • Recent payments was five rows of the last charges — a smaller version of
//    the page it linked to. `dashboard/TopSellingCard.tsx` replaced it with the
//    thing a dashboard can say that a table cannot: a ranking.
//
// What is left is the one block that was never a duplicate: the plugin's charts.

import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { FinanceTrendsSection } from '@/components/finance/FinanceTrendsSection'

/** The finance plugin's charts — only once the plugin is on, because they read
 *  the accounting_* collections it builds. Without it they would render an empty
 *  frame, which reads as "broken" rather than "not enabled". */
export function DashboardFinanceTrends({ teamId }: { teamId: string | null }) {
  const { isInstalled } = useInstalledPlugins()
  if (!teamId || !isInstalled('finance')) return null
  return <FinanceTrendsSection teamId={teamId} />
}
