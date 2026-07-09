'use client'

// Read-only schedule board — a lean, touch-friendly adaptation of the WeekView /
// ListView / groupByDay logic in components/site/sections.tsx (ScheduleBlock).
// Not imported directly: that component is bound to the site palette/preview
// context, which the kiosk doesn't use (no theming, no booking links).
import { useTranslations } from 'next-intl'
import type { KioskSession } from './useKioskSessions'

interface DayGroup {
  key: string
  date: Date
  sessions: KioskSession[]
}

function groupByDay(sessions: KioskSession[]): DayGroup[] {
  const groups = new Map<string, DayGroup>()
  for (const s of sessions) {
    const d = s.start.toDate()
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let g = groups.get(key)
    if (!g) {
      g = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), sessions: [] }
      groups.set(key, g)
    }
    g.sessions.push(s)
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
}

const fmtTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

interface Props {
  sessions: KioskSession[]
  loading: boolean
  view: 'week' | 'list'
}

export default function KioskSchedule({ sessions, loading, view }: Props) {
  const t = useTranslations('Kiosk')
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />
        ))}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-10 text-center">
        <p className="text-muted-foreground">{t('noSessions')}</p>
      </div>
    )
  }

  return view === 'week' ? <WeekGrid sessions={sessions} /> : <DayList sessions={sessions} />
}

function DayDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 pt-4 first:pt-0">
      <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function SessionRow({ s }: { s: KioskSession }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3">
      <div
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ background: s.activityColor || 'var(--primary)' }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{s.activityName ?? 'Session'}</p>
        {s.location && <p className="truncate text-sm text-muted-foreground">{s.location}</p>}
      </div>
      <p className="shrink-0 text-base font-semibold tabular-nums">{fmtTime(s.start.toDate())}</p>
    </div>
  )
}

function DayList({ sessions }: { sessions: KioskSession[] }) {
  const days = groupByDay(sessions)
  return (
    <div className="space-y-2.5">
      {days.map((g) => (
        <div key={g.key} className="space-y-2.5">
          <DayDivider date={g.date} />
          {g.sessions.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Chip({ s }: { s: KioskSession }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5">
      <span
        className="h-4 w-1 shrink-0 rounded-full"
        style={{ background: s.activityColor || 'var(--primary)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold tabular-nums">{fmtTime(s.start.toDate())}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {s.activityName ?? 'Session'}
        </span>
      </span>
    </div>
  )
}

function WeekGrid({ sessions }: { sessions: KioskSession[] }) {
  const days = groupByDay(sessions)
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    return { date, sessions: days.find((d) => d.key === key)?.sessions ?? [] }
  })

  return (
    <div className="grid h-full grid-cols-7 gap-2">
      {weekDays.map(({ date, sessions: ds }) => (
        <div key={date.toISOString()} className="flex min-h-0 flex-col gap-2">
          <div className="text-center">
            <p className="text-sm font-bold">
              {date.toLocaleDateString(undefined, { weekday: 'short' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
            {ds.length === 0 ? (
              <span className="py-2 text-center text-xs text-muted-foreground">—</span>
            ) : (
              ds.map((s) => <Chip key={s.id} s={s} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
