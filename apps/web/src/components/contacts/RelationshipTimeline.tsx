'use client'

import { useTranslations } from 'next-intl'

// ─── Relationship timeline (lifeline ribbon) ────────────────────────────────────
// A compact, read-only overview of a contact's whole business relationship:
// acquisition milestones (points) plus subscription and affiliation periods (spans),
// auto-fit to the card width (no month-tick scroll). Concurrent spans are packed
// into stacked rows, so a contact holding several subscriptions/affiliations at once
// reads cleanly. Detail + editing stay in the segment views below.

export interface TimelineMilestone {
  id: string
  label: string
  date: Date
  tone?: 'neutral' | 'positive' | 'negative'
}

export interface TimelineSpan {
  id: string
  label: string
  start: Date
  end: Date | null // null → ongoing (drawn to "now")
}

const DAY = 86_400_000

// Acquisition-stage markers use the accent colour (matching the stepper in the
// Acquisition card); only a dropout stands out in red.
const MILESTONE_DOT: Record<NonNullable<TimelineMilestone['tone']>, string> = {
  neutral: 'bg-primary',
  positive: 'bg-primary',
  negative: 'bg-red-500',
}

// Greedy interval partitioning — pack spans into the fewest non-overlapping rows.
function packRows(spans: TimelineSpan[], nowMs: number): TimelineSpan[][] {
  const sorted = [...spans].sort((a, b) => a.start.getTime() - b.start.getTime())
  const rows: { lastEnd: number; items: TimelineSpan[] }[] = []
  for (const s of sorted) {
    const startMs = s.start.getTime()
    const endMs = (s.end ?? new Date(nowMs)).getTime()
    const row = rows.find((r) => startMs >= r.lastEnd)
    if (row) {
      row.items.push(s)
      row.lastEnd = endMs
    } else {
      rows.push({ lastEnd: endMs, items: [s] })
    }
  }
  return rows.map((r) => r.items)
}

function fmt(d: Date) {
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

function SpanRow({
  spans,
  colorClass,
  domainMin,
  domainMax,
  nowMs,
  ongoingLabel,
}: {
  spans: TimelineSpan[]
  colorClass: string
  domainMin: number
  domainMax: number
  nowMs: number
  ongoingLabel: string
}) {
  const pct = (ms: number) => ((ms - domainMin) / (domainMax - domainMin)) * 100
  return (
    <div className="relative h-5">
      {spans.map((s) => {
        const left = pct(s.start.getTime())
        const right = pct((s.end ?? new Date(nowMs)).getTime())
        const width = Math.max(right - left, 1.2)
        return (
          <div
            key={s.id}
            title={`${s.label} · ${fmt(s.start)} – ${s.end ? fmt(s.end) : ongoingLabel}`}
            className={`absolute top-0.5 flex h-4 items-center overflow-hidden rounded-[3px] px-1 ${colorClass} ${
              s.end ? '' : 'rounded-r-none'
            }`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span className="truncate text-[10px] font-medium text-white">{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function RelationshipTimeline({
  milestones,
  subscriptions,
  affiliations,
}: {
  milestones: TimelineMilestone[]
  subscriptions: TimelineSpan[]
  affiliations: TimelineSpan[]
}) {
  const t = useTranslations('Contacts')

  // Nothing span-shaped to show → the acquisition funnel above already covers it.
  if (subscriptions.length === 0 && affiliations.length === 0) return null

  const now = new Date()
  const nowMs = now.getTime()

  const points: number[] = [
    ...milestones.map((m) => m.date.getTime()),
    ...subscriptions.flatMap((s) => [s.start.getTime(), (s.end ?? now).getTime()]),
    ...affiliations.flatMap((a) => [a.start.getTime(), (a.end ?? now).getTime()]),
    nowMs,
  ]
  let min = Math.min(...points)
  let max = Math.max(...points)
  const rawSpan = Math.max(max - min, DAY * 60)
  min -= rawSpan * 0.02
  max += rawSpan * 0.03
  const pct = (ms: number) => ((ms - min) / (max - min)) * 100

  // Year gridlines; add quarters when the whole window fits in ~2 years.
  const ticks: { ms: number; label: string }[] = []
  const startYear = new Date(min).getFullYear()
  const endYear = new Date(max).getFullYear()
  const shortSpan = max - min <= DAY * 365 * 2
  for (let y = startYear; y <= endYear; y++) {
    for (let q = 0; q < (shortSpan ? 4 : 1); q++) {
      const ms = new Date(y, q * 3, 1).getTime()
      if (ms >= min && ms <= max) {
        ticks.push({ ms, label: shortSpan ? `${['Q1', 'Q2', 'Q3', 'Q4'][q]} ${y}` : String(y) })
      }
    }
  }

  const subRows = packRows(subscriptions, nowMs)
  const affRows = packRows(affiliations, nowMs)
  const nowPct = pct(nowMs)

  const LaneCaption = ({ children, swatch }: { children: React.ReactNode; swatch: string }) => (
    <div className="mb-0.5 flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-[2px] ${swatch}`} />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
    </div>
  )

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('relationshipTimeline')}
      </p>

      <div className="relative">
        {/* gridlines + now marker (behind everything) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-5">
          {ticks.map((tk) => (
            <div
              key={tk.ms}
              className="absolute top-0 bottom-0 w-px bg-border/60"
              style={{ left: `${pct(tk.ms)}%` }}
            />
          ))}
          <div
            className="absolute top-0 bottom-0 w-px bg-primary/50"
            style={{ left: `${nowPct}%` }}
            title={t('timelineNow')}
          />
        </div>

        {/* Acquisition milestones */}
        <div className="relative h-5">
          {milestones.map((m) => (
            <div
              key={m.id}
              className="absolute top-1 -translate-x-1/2"
              style={{ left: `${pct(m.date.getTime())}%` }}
              title={`${m.label} · ${fmt(m.date)}`}
            >
              <span
                className={`block h-2.5 w-2.5 rounded-full ring-2 ring-card ${MILESTONE_DOT[m.tone ?? 'neutral']}`}
              />
            </div>
          ))}
        </div>

        {/* Subscriptions */}
        {subRows.length > 0 && (
          <div className="mt-1.5">
            <LaneCaption swatch="bg-blue-500">{t('tabSubscriptions')}</LaneCaption>
            {subRows.map((row, i) => (
              <SpanRow
                key={i}
                spans={row}
                colorClass="bg-blue-500/85"
                domainMin={min}
                domainMax={max}
                nowMs={nowMs}
                ongoingLabel={t('subscriptionEndNone')}
              />
            ))}
          </div>
        )}

        {/* Affiliations */}
        {affRows.length > 0 && (
          <div className="mt-1.5">
            <LaneCaption swatch="bg-emerald-500">{t('tabAffiliations')}</LaneCaption>
            {affRows.map((row, i) => (
              <SpanRow
                key={i}
                spans={row}
                colorClass="bg-emerald-500/85"
                domainMin={min}
                domainMax={max}
                nowMs={nowMs}
                ongoingLabel={t('subscriptionEndNone')}
              />
            ))}
          </div>
        )}

        {/* Year / quarter axis */}
        <div className="relative mt-1 h-5">
          {ticks.map((tk) => (
            <span
              key={tk.ms}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
              style={{ left: `${pct(tk.ms)}%` }}
            >
              {tk.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
