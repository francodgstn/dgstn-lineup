'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { Contact, EngagementBand, EngagementThresholds } from '@linyup/shared'
import { ENGAGEMENT_BANDS, computeEngagementBand } from '@linyup/shared'

// Acquisition stage is mutually exclusive (a contact is in exactly one), so it's
// shown as a donut — true "parts of a whole".
const STAGE_CONFIG = [
  { key: 'trial_booked',   tKey: 'stage_trial_booked',   color: '#10B981' },
  { key: 'trial_attended', tKey: 'stage_trial_attended', color: '#3B82F6' },
  { key: 'joined',         tKey: 'stage_joined',         color: '#6366F1' },
] as const

// Engagement band is also exclusive (each contact lands in exactly one), so it's
// a donut too. Colours mirror the contact-page meter.
const ENGAGEMENT_COLOR: Record<EngagementBand, string> = {
  active: '#10B981',   // Regular
  low: '#F59E0B',      // Slipping
  at_risk: '#EF4444',  // At risk
  inactive: '#9CA3AF', // Stopped
}

const SERIES_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#8B5CF6', '#0EA5E9', '#EF4444', '#84CC16', '#14B8A6']
const NONE_COLOR = '#D1D5DB'

type Datum = { name: string; value: number; color: string }

// Fallback display for an affiliation type_key (e.g. 'federation_licence').
function humanizeKey(k: string): string {
  const s = k.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : k
}

function tsToMs(ts: unknown): number | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate(): Date }).toDate().getTime()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number') return (ts as { seconds: number }).seconds * 1000
  return null
}

function DonutChart({ data, total }: { data: Datum[]; total: number }) {
  if (!data.length || total === 0) return null
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%"
          innerRadius={48} outerRadius={72} dataKey="value"
          paddingAngle={2} startAngle={90} endAngle={-270}>
          {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
        </Pie>
        <Tooltip formatter={(value, name) => [
          `${value} (${Math.round((Number(value) / total) * 100)}%)`, name,
        ]} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function DonutLegend({ data, total }: { data: Datum[]; total: number }) {
  return (
    <div className="flex flex-col gap-1 mt-2">
      {data.map((item) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
        return (
          <div key={item.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
            <span className="text-sm flex-1 truncate">{item.name}</span>
            <span className="text-sm text-muted-foreground text-right min-w-[60px]">
              {item.value} ({pct}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Multi-valued breakdown: each bar is an independent count of contacts holding
// that value, measured against the total contact count. Bars may sum to more
// than 100% (a contact can hold several) — that's why this is bars, not a pie.
function BarList({ data, total }: { data: Datum[]; total: number }) {
  return (
    <div className="flex flex-col gap-2.5 pt-1 max-h-[200px] overflow-y-auto">
      {data.map((item) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
        return (
          <div key={item.name} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{item.name}</span>
              <span className="text-muted-foreground tabular-nums shrink-0">{item.value} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: item.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function RosterCard({
  contacts,
  thresholds,
}: {
  contacts: Contact[]
  thresholds?: EngagementThresholds
}) {
  const t = useTranslations('Contacts')
  const [view, setView] = useState<'engagement' | 'acquisition' | 'affiliation' | 'subscription'>('engagement')

  const active = contacts.filter((c) => !c.archived_at)
  const total = active.length

  // ── Engagement band (exclusive) — derived from attendance recency ──
  const engCounts: Record<EngagementBand, number> = { active: 0, low: 0, at_risk: 0, inactive: 0 }
  const now = Date.now()
  for (const c of active) {
    const refMs = tsToMs(c.last_session_at) ?? tsToMs(c.created_at)
    engCounts[computeEngagementBand(refMs, thresholds, now)]++
  }
  const engData: Datum[] = (ENGAGEMENT_BANDS as EngagementBand[])
    .map((b) => ({ name: t(`engagement_${b}` as Parameters<typeof t>[0]), value: engCounts[b], color: ENGAGEMENT_COLOR[b] }))
    .filter((d) => d.value > 0)

  // ── Acquisition stage (exclusive) ──
  const acqData: Datum[] = STAGE_CONFIG
    .map((s) => ({ name: t(s.tKey), value: active.filter((c) => c.acquisition_stage === s.key).length, color: s.color }))
    .filter((d) => d.value > 0)

  // ── Affiliation by type (multi) ──
  const affCounts = new Map<string, number>()
  let noAff = 0
  for (const c of active) {
    const types = Array.from(new Set(c.affiliation_summary?.types ?? []))
    if (types.length === 0) { noAff++; continue }
    types.forEach((k) => affCounts.set(k, (affCounts.get(k) ?? 0) + 1))
  }
  const affData: Datum[] = [...affCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], i) => ({ name: humanizeKey(key), value, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
  if (noAff > 0) affData.push({ name: t('filterAffiliationNone'), value: noAff, color: NONE_COLOR })

  // ── Subscription by type (multi) — straight off the denormalised snapshots ──
  const subCounts = new Map<string, { name: string; count: number }>()
  let noSub = 0
  for (const c of active) {
    // Distinct subscription types this contact holds (a type counts once per contact).
    const distinct = new Map<string, string>() // typeId → name
    for (const s of c.active_subscriptions ?? []) {
      if (!distinct.has(s.subscription_type_id)) distinct.set(s.subscription_type_id, s.subscription_type_name ?? '—')
    }
    if (distinct.size === 0) { noSub++; continue }
    for (const [id, name] of distinct) {
      const cur = subCounts.get(id) ?? { name, count: 0 }
      cur.count++
      subCounts.set(id, cur)
    }
  }
  const subData: Datum[] = [...subCounts.values()]
    .sort((a, b) => b.count - a.count)
    .map((e, i) => ({ name: e.name, value: e.count, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
  if (noSub > 0) subData.push({ name: t('filterSubscriptionNone'), value: noSub, color: NONE_COLOR })

  const isMulti = view === 'affiliation' || view === 'subscription'
  const donutData = view === 'engagement' ? engData : acqData
  const barData = view === 'affiliation' ? affData : subData
  const hasData = isMulti ? barData.length > 0 : donutData.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle>{t('statsTitle')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{t('overviewActiveContacts', { count: total })}</p>
          </div>
          <Select value={view} onValueChange={(v) => { if (v) setView(v as typeof view) }}>
            <SelectTrigger size="sm" className="w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="engagement">{t('overviewViewEngagement')}</SelectItem>
              <SelectItem value="acquisition">{t('overviewViewType')}</SelectItem>
              <SelectItem value="affiliation">{t('overviewViewAffiliation')}</SelectItem>
              <SelectItem value="subscription">{t('overviewViewSubscription')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {total === 0 || !hasData ? (
          <p className="text-sm text-muted-foreground py-4">{t('overviewEmpty')}</p>
        ) : isMulti ? (
          <>
            <BarList data={barData} total={total} />
            <p className="text-[11px] text-muted-foreground mt-3 leading-snug">{t('overviewOverlapNote')}</p>
          </>
        ) : (
          <>
            <DonutChart key={view} data={donutData} total={total} />
            <DonutLegend data={donutData} total={total} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
