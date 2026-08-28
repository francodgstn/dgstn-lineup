'use client'

/**
 * ATTENDANCE OVER TIME — the last thing that was in the Stats tab.
 *
 * The Stats tab held two cards. PR #128 moved the performance radar to Coaching,
 * where it feeds the goals below it instead of sitting a tab away from them;
 * this chart is the other one, and it belongs in the same place for the same
 * reason. Whether somebody is actually turning up is the first question anyone
 * asks before setting them a goal, and it was a tab away from the goals too.
 *
 * With it gone the Stats tab holds nothing, so the tab goes with it (Franco,
 * 2026-08-28) — a tab that exists to be empty is worse than one destination
 * fewer.
 *
 * `isoWeekLabel` is exported because the contact HEADER renders a sparkline off
 * the same weekly reports and needs the same axis labels. One definition, two
 * readers.
 */

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { db } from '@/lib/firebase'
import { CONTACTS_COLLECTION, CONTACT_WEEKLY_REPORTS_SUBCOLLECTION } from '@linyup/shared'

export interface WeeklyReport {
  iso_week: string
  sessions_count: number
}

/** The contact's weekly attendance rollups, oldest first.
 *  Read by BOTH the header sparkline and the card below. */
export function useContactWeeklyReports(contactId: string, weeks = 16) {
  return useQuery<WeeklyReport[]>({
    queryKey: ['contact-weekly-reports', contactId, weeks],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_WEEKLY_REPORTS_SUBCOLLECTION),
          orderBy('iso_week', 'desc'),
          limit(weeks),
        ),
      )
      return snap.docs
        .map((d) => ({
          iso_week: d.data().iso_week as string,
          sessions_count: (d.data().sessions_count as number) ?? 0,
        }))
        .reverse()
    },
  })
}

/** An ISO week ("2026-W31") as the date its Monday falls on. */
export function isoWeekLabel(isoWeek: string) {
  const [year, week] = isoWeek.split('-W').map(Number)
  if (!year || !week) return isoWeek
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const weekStart = new Date(jan4)
  weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7)
  return weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// CSS variables don't resolve in SVG *presentation* attributes — must use the
// style prop. Moved verbatim from the Stats tab.
function LineXTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (!payload?.value) return null
  return (
    <g transform={`translate(${x},${y})`}>
      {/* fill="currentColor" reads the CSS color prop, which resolves CSS vars
          reliably in SVG */}
      <text
        fill="currentColor"
        textAnchor="middle"
        dy={12}
        style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', fontFamily: 'inherit' }}
      >
        {payload.value}
      </text>
    </g>
  )
}

export const TREND_PERIODS = [
  { key: '4w', weeks: 4, label: '1M' },
  { key: '12w', weeks: 12, label: '3M' },
  { key: '24w', weeks: 24, label: '6M' },
  { key: '52w', weeks: 52, label: '1Y' },
] as const
export type TrendPeriodKey = (typeof TREND_PERIODS)[number]['key']

export function AttendanceTrendCard({
  reports,
  loading,
  period,
  onPeriodChange,
}: {
  reports: WeeklyReport[]
  loading: boolean
  period: TrendPeriodKey
  onPeriodChange: (p: TrendPeriodKey) => void
}) {
  const t = useTranslations('Contacts')

  const chartData = reports.map((r) => ({
    label: isoWeekLabel(r.iso_week),
    sessions: r.sessions_count,
  }))

  // Tooltip style — an inline style prop resolves CSS vars; SVG attrs do not.
  const tooltipStyle = {
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('statsPanelAttendance')}
        </p>
        <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
          {TREND_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriodChange(p.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
                period === p.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[200px] animate-pulse rounded-lg bg-muted" />
      ) : chartData.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">{t('noActivity')}</p>
        </div>
      ) : (
        <div className="h-[200px]">
          <ResponsiveContainer width="99%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={<LineXTick />}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [v, t('statTotalSessions')]}
                labelStyle={{ display: 'none' }}
              />
              <Line
                type="monotone"
                dataKey="sessions"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: '#6366f1' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
