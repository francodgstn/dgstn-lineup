'use client'

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildWeekKeys, formatAxisWeek, formatTooltipWeek } from '@/lib/isoWeek'
import type { WeeklyReport } from '@/hooks/useDashboardData'

const COLOR_ENGAGEMENT = '#6366F1'
const COLOR_CONTACTS   = '#10B981'
const COLOR_SESSIONS   = '#F59E0B'

function engagementPct(r: WeeklyReport): number {
  const bookings = r.bookings_count ?? 0
  const active   = r.active_contacts_count ?? 0
  if (active === 0) return 0
  return Math.round((bookings / active) * 1000) / 10
}

function WeekTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { dataKey: string; value: number }[]
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const eng  = payload.find((p) => p.dataKey === 'engagement')?.value
  const ctc  = payload.find((p) => p.dataKey === 'contacts')?.value
  const ses  = payload.find((p) => p.dataKey === 'sessions')?.value
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs max-w-[200px]">
      <p className="font-bold mb-1">{formatTooltipWeek(label)}</p>
      {eng  !== undefined && <p style={{ color: COLOR_ENGAGEMENT }}>Engagement: <strong>{eng}%</strong></p>}
      {ctc  !== undefined && <p style={{ color: COLOR_CONTACTS }}>Active contacts: <strong>{ctc}</strong></p>}
      {ses  !== undefined && <p style={{ color: COLOR_SESSIONS }}>Sessions held: <strong>{ses}</strong></p>}
    </div>
  )
}

export function WeeklyTrendsCard({
  weeklyReports,
  trendsWeeks,
}: {
  weeklyReports: WeeklyReport[]
  trendsWeeks: number
}) {
  const chartData = useMemo(() => {
    const byWeek = new Map(weeklyReports.map((r) => [r.iso_week, r]))
    return buildWeekKeys(trendsWeeks).map((week, i, arr) => {
      const r = byWeek.get(week)
      return {
        week,
        label: formatAxisWeek(week),
        showLabel: i === 0 || i === arr.length - 1 || i % Math.max(1, Math.floor(arr.length / 6)) === 0,
        engagement: r ? engagementPct(r) : undefined,
        contacts:   r?.active_contacts_count,
        sessions:   r?.sessions_count,
      }
    })
  }, [weeklyReports, trendsWeeks])

  const hasData = chartData.some((d) => d.engagement !== undefined)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Weekly trends</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
              <XAxis
                dataKey="week"
                tickFormatter={formatAxisWeek}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={[0, 'auto']}
              />
              <YAxis
                yAxisId="count"
                orientation="left"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip content={<WeekTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(v) =>
                  v === 'engagement' ? 'Engagement %' : v === 'contacts' ? 'Active contacts' : 'Sessions held'
                }
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="engagement"
                stroke={COLOR_ENGAGEMENT}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="contacts"
                stroke={COLOR_CONTACTS}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="sessions"
                stroke={COLOR_SESSIONS}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
