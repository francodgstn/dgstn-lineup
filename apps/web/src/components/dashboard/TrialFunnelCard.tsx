'use client'

import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { TrendingUp } from 'lucide-react'
import { buildWeekKeys, shortWeekLabel, formatTooltipWeek, formatAxisWeek } from '@/lib/isoWeek'
import type { WeeklyReport } from '@/hooks/useDashboardData'

const COLOR_CONVERSION = '#10B981'
const COLOR_DROPOUT    = '#EF4444'
const COLOR_RATE       = '#6366F1'

function computeRate(conversions: number, dropouts: number): number | null {
  const total = conversions + dropouts
  return total > 0 ? Math.round((conversions / total) * 100) : null
}

function FunnelTooltip({ active, payload, label, metric, compareWith }: {
  active?: boolean; payload?: { dataKey: string; value: number }[]
  label?: string; metric: string; compareWith?: string
}) {
  if (!active || !payload?.length || !label) return null
  const conv  = payload.find((p) => p.dataKey === 'conversions')?.value
  const drop  = payload.find((p) => p.dataKey === 'dropouts')?.value
  const rate  = payload.find((p) => p.dataKey === 'rate')?.value
  const cRate = payload.find((p) => p.dataKey === 'compRate')?.value
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs max-w-[220px]">
      <p className="font-bold mb-1">{formatTooltipWeek(label)}</p>
      {metric === 'counts' && conv !== undefined && (
        <p style={{ color: COLOR_CONVERSION }}>Conversions: <strong>{conv}</strong></p>
      )}
      {metric === 'counts' && drop !== undefined && (
        <p style={{ color: COLOR_DROPOUT }}>Dropouts: <strong>{drop}</strong></p>
      )}
      {rate !== null && rate !== undefined && (
        <p style={{ color: COLOR_RATE }}>Conversion rate: <strong>{rate}%</strong></p>
      )}
      {compareWith && compareWith !== 'none' && cRate !== null && cRate !== undefined && (
        <p className="text-muted-foreground">
          {compareWith === 'last_year' ? 'Last year' : 'Prev. period'} rate: <strong>{cRate}%</strong>
        </p>
      )}
    </div>
  )
}

interface Props {
  weeklyReports?: WeeklyReport[]; comparisonWeeklyReports?: WeeklyReport[]
  trendsWeeks?: number; compareWith?: string; title?: string
}

export function TrialFunnelCard({
  weeklyReports = [], comparisonWeeklyReports = [],
  trendsWeeks = 13, compareWith = 'none', title,
}: Props) {
  const [metric, setMetric] = useState('counts')
  const comparisonOffset = compareWith === 'last_year' ? 52 : trendsWeeks

  const { chartData, summaryRate, compSummaryRate } = useMemo(() => {
    const weekKeys     = buildWeekKeys(trendsWeeks, 0)
    const compWeekKeys = compareWith !== 'none' ? buildWeekKeys(trendsWeeks, comparisonOffset) : []

    const byWeek:     Record<string, WeeklyReport> = Object.fromEntries(weeklyReports.map((r) => [r.iso_week, r]))
    const compByWeek: Record<string, WeeklyReport> = Object.fromEntries(comparisonWeeklyReports.map((r) => [r.iso_week, r]))

    let totalConv = 0, totalDrop = 0, compTotalConv = 0, compTotalDrop = 0

    const data = weekKeys.map((key, idx) => {
      const r = byWeek[key] ?? {}
      const conv = (r as WeeklyReport).trial_conversions_count ?? 0
      const drop = (r as WeeklyReport).trial_dropouts_count ?? 0
      totalConv += conv; totalDrop += drop

      const row: Record<string, unknown> = {
        week: key,
        label: shortWeekLabel(key, weekKeys[idx - 1]),
        conversions: conv, dropouts: drop,
        rate: computeRate(conv, drop),
      }

      if (compareWith !== 'none') {
        const cr = compByWeek[compWeekKeys[idx]] ?? {}
        const compConv = (cr as WeeklyReport).trial_conversions_count ?? 0
        const compDrop = (cr as WeeklyReport).trial_dropouts_count ?? 0
        compTotalConv += compConv; compTotalDrop += compDrop
        row.compRate = computeRate(compConv, compDrop)
      }
      return row
    })

    return {
      chartData: data,
      summaryRate: computeRate(totalConv, totalDrop),
      compSummaryRate: compareWith !== 'none' ? computeRate(compTotalConv, compTotalDrop) : null,
    }
  }, [weeklyReports, comparisonWeeklyReports, trendsWeeks, compareWith, comparisonOffset])

  const hasData = chartData.some((d) => (d.conversions as number) > 0 || (d.dropouts as number) > 0)
  const rateDelta = summaryRate !== null && compSummaryRate !== null ? summaryRate - compSummaryRate : null

  return (
    <Card className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <TrendingUp className="h-4 w-4 text-primary flex-shrink-0" />
        <p className="text-sm font-bold flex-1 truncate">{title || 'Trial Conversion'}</p>
        {summaryRate !== null && (
          <div className="flex items-baseline gap-1 flex-shrink-0">
            <span className="text-lg font-black leading-none" style={{ color: COLOR_RATE }}>{summaryRate}%</span>
            {rateDelta !== null && (
              <span className={`text-xs ${rateDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {rateDelta >= 0 ? '+' : ''}{rateDelta}pp
              </span>
            )}
          </div>
        )}
        <Select value={metric} onValueChange={(v) => { if (v) setMetric(v) }}>
          <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="counts">Counts</SelectItem>
            <SelectItem value="rate">Rate only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <CardContent className="flex-1 flex flex-col pb-4 pt-3">
        {!hasData && metric !== 'rate' ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No conversion or dropout events in this period</p>
          </div>
        ) : (
          <div className="mt-auto">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData as object[]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="week" tickFormatter={formatAxisWeek} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                {metric === 'counts' && (
                  <YAxis yAxisId="counts" allowDecimals={false} tick={{ fontSize: 11 }} width={30} tickCount={5} />
                )}
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} tickCount={5} />
                <Tooltip content={<FunnelTooltip metric={metric} compareWith={compareWith} />} />
                {metric === 'counts' && (
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    formatter={(v) => v === 'conversions' ? 'Conversions' : 'Dropouts'} />
                )}
                {metric === 'counts' && (
                  <Bar yAxisId="counts" dataKey="conversions" stackId="funnel"
                    fill={COLOR_CONVERSION} opacity={0.85} maxBarSize={32} radius={[0, 0, 0, 0]} />
                )}
                {metric === 'counts' && (
                  <Bar yAxisId="counts" dataKey="dropouts" stackId="funnel"
                    fill={COLOR_DROPOUT} opacity={0.75} maxBarSize={32} radius={[2, 2, 0, 0]} />
                )}
                <Line yAxisId="rate" type="monotone" dataKey="rate"
                  stroke={COLOR_RATE} strokeWidth={2} dot={{ r: 3, fill: COLOR_RATE }} connectNulls={false} />
                {compareWith !== 'none' && (
                  <Line yAxisId="rate" type="monotone" dataKey="compRate"
                    stroke={COLOR_RATE} strokeWidth={1.5} strokeDasharray="4 3"
                    dot={false} connectNulls={false} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
