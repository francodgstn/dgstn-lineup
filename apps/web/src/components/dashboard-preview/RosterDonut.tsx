'use client'

/**
 * THE CONTACTS SNAPSHOT — a donut on the left, its legend on the right, and no
 * card around either.
 *
 * ── WHY IT IS BACK ───────────────────────────────────────────────────────────
 *
 * This page cut the roster and demographics cards on the argument that
 * composition analysis belongs in `/contacts`. Franco has seen the page without
 * them and decided otherwise (2026-08-18). Recording that honestly: the
 * argument lost, and this is not a grudging minimum — a small unframed donut
 * with its legend beside it is a genuinely different object from the card that
 * was cut, and the differences are the point:
 *
 *  - **Unframed.** The card is gone, not shrunk. Figures and charts on the
 *    background are this page's reference material; only work is framed.
 *  - **Side by side.** The card stacked a 160px donut over its legend, which
 *    made a tall block out of a small fact. Chart left, legend right halves the
 *    height and lets the legend's rows be read as a list rather than a caption.
 *  - **Exclusive dimensions only.** The card also offered affiliation and
 *    subscription TYPES, where a contact can hold several — those sum past 100%
 *    and the card rendered them as bars, which is a different geometry and
 *    cannot share this one. They stay on `/contacts`, where the full card
 *    still lives.
 *  - **The total in the hole.** A 96px hole in a 44px-thick ring is the one
 *    place a donut can state its own denominator, which the legend's
 *    percentages otherwise leave implicit.
 *
 * TWO VIEWS, not seven: how people are ENGAGING and where they are in the
 * FUNNEL. Both are exclusive, so both are honestly a donut, and two is what a
 * picker on a daily surface can justify.
 *
 * The band and stage NAMES come from the `Contacts` namespace — the same keys
 * `/contacts` and the incumbent's card read, because they are the vocabulary of
 * the contact record rather than dashboard copy. Only the two view labels are
 * this page's own.
 */

import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useTranslations } from 'next-intl'
import type { Contact, EngagementBand, EngagementThresholds } from '@linyup/shared'
import { ENGAGEMENT_BANDS, computeEngagementBand } from '@linyup/shared'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

type Datum = { name: string; value: number; color: string }
type View = 'engagement' | 'acquisition'

/** Mirrors the contact page's engagement meter. */
const ENGAGEMENT_COLOR: Record<EngagementBand, string> = {
  active: '#10B981',
  low: '#F59E0B',
  at_risk: '#EF4444',
  inactive: '#9CA3AF',
}

const STAGE_CONFIG = [
  { key: 'trial_booked', tKey: 'stage_trial_booked', color: '#10B981' },
  { key: 'trial_attended', tKey: 'stage_trial_attended', color: '#3B82F6' },
  { key: 'joined', tKey: 'stage_joined', color: '#6366F1' },
] as const

function tsToMs(ts: unknown): number | null {
  if (!ts) return null
  if (typeof (ts as { toDate?: unknown }).toDate === 'function')
    return (ts as { toDate(): Date }).toDate().getTime()
  if (typeof (ts as { seconds?: unknown }).seconds === 'number')
    return (ts as { seconds: number }).seconds * 1000
  return null
}

export function RosterDonut({
  contacts,
  thresholds,
  loading,
}: {
  contacts: Contact[] | undefined
  thresholds?: EngagementThresholds
  loading: boolean
}) {
  const t = useTranslations('NewDashboard')
  const tc = useTranslations('Contacts')
  const [view, setView] = useState<View>('engagement')

  const live = (contacts ?? []).filter((c) => !c.archived_at)
  const total = live.length

  let data: Datum[] = []
  if (view === 'engagement') {
    const counts: Record<EngagementBand, number> = { active: 0, low: 0, at_risk: 0, inactive: 0 }
    const now = Date.now()
    for (const c of live) {
      counts[computeEngagementBand(tsToMs(c.last_session_at) ?? tsToMs(c.created_at), thresholds, now)]++
    }
    data = (ENGAGEMENT_BANDS as EngagementBand[])
      .map((b) => ({
        name: tc(`engagement_${b}` as 'engagement_active'),
        value: counts[b],
        color: ENGAGEMENT_COLOR[b],
      }))
      .filter((d) => d.value > 0)
  } else {
    data = STAGE_CONFIG.map((s) => ({
      name: tc(s.tKey),
      value: live.filter((c) => c.acquisition_stage === s.key).length,
      color: s.color,
    })).filter((d) => d.value > 0)
  }

  const plotted = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex h-full flex-col">
      {/* The block's own label + its one control, on one line — the same
          grammar the panels' headers use, without the frame they sit in. */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-heading truncate text-sm font-bold tracking-tight text-heading">
          {t('rosterTitle')}
        </h2>
        <div className="flex-1" />
        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger className="h-7 w-[136px] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="engagement">{t('rosterViewEngagement')}</SelectItem>
            <SelectItem value="acquisition">{t('rosterViewAcquisition')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-5">
          <Skeleton className="h-[150px] w-[150px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      ) : plotted === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">{t('rosterEmpty')}</p>
      ) : (
        /* CHART LEFT, LEGEND RIGHT. `items-center` so a two-row legend still
           reads as belonging to the ring rather than floating above it. */
        <div className="flex items-center gap-5">
          <div className="relative h-[150px] w-[150px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={70}
                  dataKey="value"
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${value} (${Math.round((Number(value) / plotted) * 100)}%)`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* The denominator, in the one place a donut has for it. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black leading-none tabular-nums">{total}</span>
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('rosterTotal')}
              </span>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-1.5">
            {data.map((d) => (
              <li key={d.name} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: d.color }}
                />
                <span className="min-w-0 flex-1 truncate" title={d.name}>
                  {d.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {d.value} ({Math.round((d.value / plotted) * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
