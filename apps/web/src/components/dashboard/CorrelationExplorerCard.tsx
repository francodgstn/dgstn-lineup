'use client'

import { useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Line, ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { GitBranch } from 'lucide-react'
import { buildWeekKeys, dateToIsoWeek, formatTooltipWeek } from '@/lib/isoWeek'
import type { WeeklyReport, SessionDoc, BookingDoc } from '@/hooks/useDashboardData'

// ─── metrics ──────────────────────────────────────────────────────────────────

const METRICS = [
  { value: 'checkins',        label: 'Check-ins' },
  { value: 'all_bookings',    label: 'All bookings' },
  { value: 'new_bookings',    label: 'New bookings' },
  { value: 'active_contacts', label: 'Active contacts' },
  { value: 'total_contacts',  label: 'Total contacts' },
  { value: 'trials',          label: 'Trial contacts' },
  { value: 'students',        label: 'Students' },
  { value: 'engagement_rate', label: 'Engagement %' },
  { value: 'sessions_held',   label: 'Sessions held' },
] as const

type MetricKey = typeof METRICS[number]['value']

function metricLabel(key: MetricKey): string {
  return METRICS.find((m) => m.value === key)?.label ?? key
}

// ─── linear regression ────────────────────────────────────────────────────────

function linearRegression(points: { x: number; y: number }[]): {
  slope: number; intercept: number; r: number
} | null {
  const n = points.length
  if (n < 3) return null
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const rNum = n * sumXY - sumX * sumY
  const rDen = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  const r = rDen === 0 ? 0 : rNum / rDen
  return { slope, intercept, r }
}

function rLabel(r: number): string {
  const abs = Math.abs(r)
  const dir = r >= 0 ? 'positive' : 'negative'
  const strength = abs >= 0.7 ? 'Strong' : abs >= 0.4 ? 'Moderate' : abs >= 0.2 ? 'Weak' : 'No'
  return `${strength} ${dir} correlation (r=${r.toFixed(2)})`
}

// ─── tooltip ─────────────────────────────────────────────────────────────────

function CorrelationTooltip({ active, payload, metricX, metricY }: {
  active?: boolean
  payload?: { payload: { week: string; x: number; y: number } }[]
  metricX: MetricKey; metricY: MetricKey
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold mb-1">{formatTooltipWeek(d.week)}</p>
      <p className="text-muted-foreground">{metricLabel(metricX)}: <strong>{d.x}</strong></p>
      <p className="text-muted-foreground">{metricLabel(metricY)}: <strong>{d.y}</strong></p>
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export function CorrelationExplorerCard({
  weeklyReports,
  sessions,
  allBookings,
  newContactBookings,
  trendsWeeks,
}: {
  weeklyReports: WeeklyReport[]
  sessions: SessionDoc[]
  allBookings: BookingDoc[]
  newContactBookings: BookingDoc[]
  trendsWeeks: number
}) {
  const [metricX, setMetricX] = useState<MetricKey>('active_contacts')
  const [metricY, setMetricY] = useState<MetricKey>('checkins')

  const chartData = useMemo(() => {
    const weekKeys = buildWeekKeys(trendsWeeks)
    const byWeek   = new Map(weeklyReports.map((r) => [r.iso_week, r]))

    // Aggregate sessions → checkins by week
    const checkinsByWeek: Record<string, number> = {}
    for (const s of sessions) {
      if (!s.start) continue
      const wk = dateToIsoWeek((s.start as { toDate(): Date }).toDate())
      checkinsByWeek[wk] = (checkinsByWeek[wk] ?? 0) + (s.participants_count ?? 0)
    }

    // Aggregate bookings by week
    const allByWeek: Record<string, number> = {}
    const newByWeek: Record<string, number> = {}
    for (const b of allBookings) {
      if (!b.joinedAt) continue
      const wk = dateToIsoWeek((b.joinedAt as { toDate(): Date }).toDate())
      allByWeek[wk] = (allByWeek[wk] ?? 0) + 1
    }
    for (const b of newContactBookings) {
      if (!b.joinedAt) continue
      const wk = dateToIsoWeek((b.joinedAt as { toDate(): Date }).toDate())
      newByWeek[wk] = (newByWeek[wk] ?? 0) + 1
    }

    function getMetric(week: string, metric: MetricKey): number | null {
      const r = byWeek.get(week)
      switch (metric) {
        case 'checkins':        return checkinsByWeek[week] ?? 0
        case 'all_bookings':    return allByWeek[week] ?? 0
        case 'new_bookings':    return newByWeek[week] ?? 0
        case 'active_contacts': return r?.active_contacts_count ?? null
        case 'total_contacts': {
          const t = r?.contacts_count_by_type
          return t ? Object.values(t).reduce((s, v) => s + v, 0) : null
        }
        case 'trials':          return r?.contacts_count_by_type?.trial ?? null
        case 'students':        return r?.contacts_count_by_type?.student ?? null
        case 'engagement_rate': {
          const bk = r?.bookings_count ?? 0
          const ac = r?.active_contacts_count ?? 0
          return ac > 0 ? Math.round((bk / ac) * 1000) / 10 : null
        }
        case 'sessions_held':   return r?.sessions_count ?? null
        default:                return null
      }
    }

    return weekKeys
      .map((week) => {
        const x = getMetric(week, metricX)
        const y = getMetric(week, metricY)
        if (x === null || y === null) return null
        return { week, x, y }
      })
      .filter((d): d is { week: string; x: number; y: number } => d !== null)
  }, [weeklyReports, sessions, allBookings, newContactBookings, trendsWeeks, metricX, metricY])

  const regression = useMemo(() => {
    const reg = linearRegression(chartData)
    if (!reg || chartData.length < 3) return null
    const xs = chartData.map((d) => d.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    return {
      ...reg,
      line: [
        { x: minX, y: reg.slope * minX + reg.intercept },
        { x: maxX, y: reg.slope * maxX + reg.intercept },
      ],
    }
  }, [chartData])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="font-bold">Correlation explorer</CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={metricX} onValueChange={(v) => setMetricX(v as MetricKey)}>
              <SelectTrigger className="h-6 text-xs w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">vs</span>
            <Select value={metricY} onValueChange={(v) => setMetricY(v as MetricKey)}>
              <SelectTrigger className="h-6 text-xs w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {regression && (
          <p className="text-[11px] text-muted-foreground mt-1">{rLabel(regression.r)}</p>
        )}
      </CardHeader>
      <CardContent>
        {chartData.length < 3 ? (
          <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
            Not enough data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 4, right: 12, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
              <XAxis
                type="number"
                dataKey="x"
                name={metricLabel(metricX)}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                label={{ value: metricLabel(metricX), position: 'insideBottom', offset: -12, fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={metricLabel(metricY)}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={38}
                label={{ value: metricLabel(metricY), angle: -90, position: 'insideLeft', fontSize: 10 }}
              />
              <Tooltip
                content={<CorrelationTooltip metricX={metricX} metricY={metricY} />}
                cursor={{ strokeDasharray: '3 3' }}
              />
              <Scatter data={chartData} fill="#6366F1" fillOpacity={0.7} r={4} />
              {regression && (
                <Line
                  data={regression.line}
                  type="linear"
                  dataKey="y"
                  stroke="#6366F1"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  strokeOpacity={0.5}
                  legendType="none"
                  isAnimationActive={false}
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
