'use client'

// Read-only schedule board — the simple stacked List view plus the shared
// WeeklyCalendar (time-grid planner). Tapping any session opens a detail modal.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, MapPin, X } from 'lucide-react'
import { WeeklyCalendar, type PlannerSession } from '@/components/schedule/WeeklyCalendar'
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
  view: 'calendar' | 'list'
}

export default function KioskSchedule({ sessions, loading, view }: Props) {
  const t = useTranslations('Kiosk')
  const [selected, setSelected] = useState<PlannerSession | null>(null)

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

  return (
    <>
      {view === 'list' ? (
        <DayList sessions={sessions} onSelect={setSelected} />
      ) : (
        <WeeklyCalendar sessions={sessions} onSelect={setSelected} />
      )}
      {selected && (
        <SessionModal s={selected} onClose={() => setSelected(null)} closeLabel={t('close')} />
      )}
    </>
  )
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

function SessionRow({ s, onSelect }: { s: KioskSession; onSelect: (s: KioskSession) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      className="flex w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ background: s.activityColor || 'var(--primary)' }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{s.activityName ?? 'Session'}</p>
        {s.location && <p className="truncate text-sm text-muted-foreground">{s.location}</p>}
      </div>
      <p className="shrink-0 text-base font-semibold tabular-nums">{fmtTime(s.start.toDate())}</p>
    </button>
  )
}

function DayList({ sessions, onSelect }: { sessions: KioskSession[]; onSelect: (s: KioskSession) => void }) {
  const days = groupByDay(sessions)
  return (
    <div className="space-y-2.5">
      {days.map((g) => (
        <div key={g.key} className="space-y-2.5">
          <DayDivider date={g.date} />
          {g.sessions.map((s) => (
            <SessionRow key={s.id} s={s} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  )
}

function SessionModal({
  s,
  onClose,
  closeLabel,
}: {
  s: PlannerSession
  onClose: () => void
  closeLabel: string
}) {
  const start = s.start.toDate()
  const end = s.end?.toDate()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className="mt-1 h-12 w-1.5 shrink-0 rounded-full"
            style={{ background: s.activityColor || 'var(--primary)' }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold">{s.activityName ?? 'Session'}</h3>
            <p className="mt-1 text-sm capitalize text-muted-foreground">
              {start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium tabular-nums">
              {fmtTime(start)}
              {end ? ` – ${fmtTime(end)}` : ''}
            </span>
          </div>
          {s.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{s.location}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
