'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Contact, EngagementBand, EngagementThresholds } from '@linyup/shared'
import { ENGAGEMENT_BANDS, computeEngagementBand } from '@linyup/shared'

// Donut colours per band — mirror the meter on the contact page
// (Regular / Slipping / At risk / Stopped).
const BAND_COLOR: Record<EngagementBand, string> = {
  active: '#10B981',   // Regular — emerald
  low: '#F59E0B',      // Slipping — amber
  at_risk: '#EF4444',  // At risk — red
  inactive: '#9CA3AF', // Stopped — grey
}

function tsToMs(ts: unknown): number | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate(): Date }).toDate().getTime()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number') return (ts as { seconds: number }).seconds * 1000
  return null
}

type Datum = { name: string; value: number; color: string }

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

function Legend({ data, total }: { data: Datum[]; total: number }) {
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

/**
 * Engagement-band breakdown of a team's contacts. The band is derived on the fly
 * from attendance recency (last attended session, falling back to join date)
 * against the team's thresholds — the same logic the contact-page meter and the
 * contact-list filter use — so nothing is read from a stored field.
 */
export function EngagementCard({
  contacts,
  thresholds,
}: {
  contacts: Contact[]
  thresholds?: EngagementThresholds
}) {
  const t = useTranslations('Contacts')
  const active = contacts.filter((c) => !c.archived_at)
  const total = active.length
  const now = Date.now()

  const counts: Record<EngagementBand, number> = { active: 0, low: 0, at_risk: 0, inactive: 0 }
  for (const c of active) {
    const refMs = tsToMs(c.last_session_at) ?? tsToMs(c.created_at)
    counts[computeEngagementBand(refMs, thresholds, now)]++
  }

  const data: Datum[] = (ENGAGEMENT_BANDS as EngagementBand[])
    .map((b) => ({ name: t(`engagement_${b}` as Parameters<typeof t>[0]), value: counts[b], color: BAND_COLOR[b] }))
    .filter((d) => d.value > 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle>{t('engagementLabel')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{t('engagementCardSubtitle', { count: total })}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">{t('engagementCardEmpty')}</p>
        ) : (
          <>
            <DonutChart data={data} total={total} />
            <Legend data={data} total={total} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
