'use client'

import { useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import { buildWeekKeys } from '@/lib/isoWeek'
import { formatTooltipWeek } from '@/lib/isoWeek'
import type { WeeklyReport } from '@/hooks/useDashboardData'

// ─── quadrant config ──────────────────────────────────────────────────────────

const QUADRANTS = {
  top_right:    { label: 'Team growth',      color: '#16a34a', hint: 'Work on the team',          actions: ['Team events', 'Special sessions'] },
  top_left:     { label: 'Lead acquisition', color: '#b45309', hint: 'Work on lead acquisition',  actions: ['Social ads', 'Website', 'Word of mouth'] },
  bottom_right: { label: 'Boost engagement', color: '#c2410c', hint: 'Work on engagement',         actions: ['More sessions', 'Feedback', 'Re-contact members'] },
  bottom_left:  { label: 'Getting started',  color: '#dc2626', hint: 'Work on getting started',    actions: ['Flexible schedule', 'Focus energy'] },
} as const

type Quadrant = keyof typeof QUADRANTS

function getQuadrant(x: number, y: number, midX: number, midY: number): Quadrant {
  if (x >= midX && y >= midY) return 'top_right'
  if (x <  midX && y >= midY) return 'top_left'
  if (x >= midX && y <  midY) return 'bottom_right'
  return 'bottom_left'
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ─── tooltip ─────────────────────────────────────────────────────────────────

function MatrixTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: { week: string; x: number; y: number } }[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold mb-1">{formatTooltipWeek(d.week)}</p>
      <p className="text-muted-foreground">Active contacts: <strong>{d.x}</strong></p>
      <p className="text-muted-foreground">Engagement: <strong>{d.y}%</strong></p>
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

export function EngagementMatrixCard({
  weeklyReports,
  trendsWeeks,
}: {
  weeklyReports: WeeklyReport[]
  trendsWeeks: number
}) {
  const [showTrajectory, setShowTrajectory] = useState(false)

  const { dataPoints, midX, midY, domainMaxX, currentQuadrant, isDecline } = useMemo(() => {
    const weekKeys = buildWeekKeys(trendsWeeks)
    const byWeek   = new Map(weeklyReports.map((r) => [r.iso_week, r]))

    const points = weekKeys
      .map((week) => {
        const r = byWeek.get(week)
        if (!r?.active_contacts_count) return null
        const bookings = r.bookings_count ?? 0
        const active   = r.active_contacts_count
        const y = active > 0 ? Math.round((bookings / active) * 1000) / 10 : 0
        return { week, x: active, y }
      })
      .filter((d): d is { week: string; x: number; y: number } => d !== null)

    if (points.length === 0) {
      return { dataPoints: [], midX: 0, midY: 50, domainMaxX: 100, currentQuadrant: null, isDecline: false }
    }

    const xs    = points.map((p) => p.x)
    const midX  = Math.round(median(xs))
    const midY  = 50
    const maxX  = Math.max(...xs)
    const domainMaxX = Math.max(midX * 2, Math.ceil(maxX * 1.1))

    const current = points[points.length - 1]
    const oldest  = points[0]
    const currentQuadrant = getQuadrant(current.x, current.y, midX, midY)
    const isDecline = points.length >= 4 && current.y < oldest.y - 3

    return { dataPoints: points, midX, midY, domainMaxX, currentQuadrant, isDecline }
  }, [weeklyReports, trendsWeeks])

  const pastPoints    = dataPoints.slice(0, -1)
  const currentPoint  = dataPoints.length > 0 ? [dataPoints[dataPoints.length - 1]] : []
  const qInfo = currentQuadrant ? QUADRANTS[currentQuadrant] : null

  if (dataPoints.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Engagement matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Not enough data for this period
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Engagement matrix</CardTitle>
          <button
            onClick={() => setShowTrajectory((v) => !v)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              showTrajectory ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
            }`}
          >
            Trajectory
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isDecline && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Engagement has dropped more than 3 points since the start of the period.
          </div>
        )}

        <ResponsiveContainer width="100%" height={240}>
          <ScatterChart margin={{ top: 16, right: 16, left: 0, bottom: 20 }}>
            {/* Quadrant backgrounds */}
            <ReferenceArea x1={0}    x2={midX}       y1={midY}  y2={100}       fill="#fef9c3" fillOpacity={0.4} />
            <ReferenceArea x1={midX} x2={domainMaxX}  y1={midY}  y2={100}       fill="#dcfce7" fillOpacity={0.4} />
            <ReferenceArea x1={0}    x2={midX}       y1={0}     y2={midY}      fill="#fee2e2" fillOpacity={0.3} />
            <ReferenceArea x1={midX} x2={domainMaxX}  y1={0}     y2={midY}      fill="#ffedd5" fillOpacity={0.3} />

            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
            <ReferenceLine x={midX} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="4 2" />
            <ReferenceLine y={midY} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="4 2" />

            <XAxis
              type="number"
              dataKey="x"
              domain={[0, domainMaxX]}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Active contacts →', position: 'insideBottom', offset: -12, fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              width={36}
              label={{ value: 'Engagement →', angle: -90, position: 'insideLeft', fontSize: 10 }}
            />

            <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: '3 3' }} />

            {/* Past points (trajectory) */}
            {showTrajectory && pastPoints.length > 0 && (
              <Scatter
                data={pastPoints}
                fill="#94a3b8"
                fillOpacity={0.4}
                r={3}
                isAnimationActive={false}
              />
            )}

            {/* Current point */}
            {currentPoint.length > 0 && (
              <Scatter
                data={currentPoint}
                fill={qInfo?.color ?? '#6366F1'}
                r={7}
                stroke="white"
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>

        {/* Quadrant guidance */}
        {qInfo && (
          <div className="rounded-lg border p-3 space-y-1.5" style={{ borderColor: `${qInfo.color}40` }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: qInfo.color }} />
              <p className="text-xs font-semibold" style={{ color: qInfo.color }}>{qInfo.label}</p>
              <p className="text-xs text-muted-foreground ml-auto">{qInfo.hint}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {qInfo.actions.map((a) => (
                <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-muted font-medium">{a}</span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Midpoint: {midX} contacts · {midY}% engagement
        </p>
      </CardContent>
    </Card>
  )
}
