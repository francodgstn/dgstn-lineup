'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft, ChevronRight, Clock, MapPin, Users,
  Pencil, Trash2, CalendarDays,
} from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'
import type { Session, Activity, Event } from '@lineup/shared'

// ─── colour palette ───────────────────────────────────────────────────────────

const PALETTE = ['#7C3AED', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#0EA5E9', '#22C55E']

function activityAccent(activityId?: string | null, activities: Activity[] = []): string {
  const custom = activities.find((a) => a.id === activityId)?.color
  if (custom) return custom
  if (!activityId) return PALETTE[0]
  let h = 0
  for (const ch of activityId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// ─── calendar helpers ─────────────────────────────────────────────────────────

function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const first  = new Date(year, month, 1)
  const last   = new Date(year, month + 1, 0)
  const offset = (first.getDay() + 6) % 7 // Mon=0 … Sun=6
  const cells: (Date | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: last.getDate() }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7) cells.push(null)
  const weeks: (Date | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; label: string }> = {
    open:      { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'Open' },
    full:      { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',         label: 'Full' },
    cancelled: { cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',                 label: 'Cancelled' },
  }
  const { cls, label } = cfg[status] ?? { cls: 'bg-muted text-muted-foreground', label: status }
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {label}
    </span>
  )
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayCellProps {
  day: Date
  sessions: Session[]
  events: Event[]
  isSelected: boolean
  isToday: boolean
  onClick: (d: Date) => void
}

function DayCell({ day, sessions, events, isSelected, isToday, onClick }: DayCellProps) {
  const count    = sessions.length + events.length
  const dotColor = isSelected ? 'rgba(255,255,255,0.8)' : 'var(--primary)'

  return (
    <button
      onClick={() => onClick(day)}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 w-full aspect-square transition-colors',
        isSelected
          ? 'bg-primary text-primary-foreground'
          : isToday
            ? 'text-primary font-semibold hover:bg-muted'
            : 'hover:bg-muted',
      )}
    >
      <span className="text-sm leading-none">{day.getDate()}</span>
      {count > 0 && (
        <div className="flex items-center justify-center h-2">
          {/* front dot */}
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
          {/* back dot — offset behind front, lower opacity → "stacked" look */}
          {count > 1 && (
            <div className="w-1.5 h-1.5 rounded-full shrink-0 -ml-0.5" style={{ backgroundColor: dotColor, opacity: 0.4 }} />
          )}
        </div>
      )}
    </button>
  )
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

interface SessionCardProps {
  session: Session
  activities: Activity[]
  onOpen: (s: Session) => void
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
}

function SessionCard({ session, activities, onOpen, onEdit, onDelete }: SessionCardProps) {
  const color = activityAccent(session.activityId, activities)
  const fmt = (ts?: { toDate(): Date } | null) =>
    ts?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(session)}
      className="flex gap-3 rounded-xl border bg-card p-3.5 hover:bg-accent/20 transition-colors group cursor-pointer"
    >
      {/* activity colour strip */}
      <div className="w-1 rounded-full shrink-0 self-stretch" style={{ backgroundColor: color }} />

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* row 1: name + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{session.activityName ?? '—'}</span>
          <StatusBadge status={session.status ?? 'open'} />
        </div>

        {/* row 2: time + location */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmt(session.start)} – {fmt(session.end)}
          </span>
          {session.location && (
            <span className="flex items-center gap-1 max-w-[200px] truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {session.location}
            </span>
          )}
        </div>

        {/* row 3: participants + hover actions */}
        <div className="flex items-center justify-between mt-0.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {session.bookings_count ?? 0}
            {session.max_participants ? ` / ${session.max_participants}` : ''}
          </span>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onEdit(session) }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onDelete(session) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── EventCard ────────────────────────────────────────────────────────────────

const EVENT_TYPE_COLOR: Record<string, string> = {
  competition: '#EF4444',
  camp:        '#F97316',
  exam:        '#8B5CF6',
  seminar:     '#3B82F6',
  workshop:    '#10B981',
}

function EventCard({ event }: { event: Event }) {
  const router = useRouter()
  const color = EVENT_TYPE_COLOR[event.type] ?? '#6B7280'
  const fmt = (ts?: { toDate(): Date } | null) =>
    ts?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/events/${event.id}` as Route)}
      onKeyDown={(e) => e.key === 'Enter' && router.push(`/events/${event.id}` as Route)}
      className="flex gap-3 rounded-xl border bg-card p-3.5 hover:bg-accent/20 transition-colors cursor-pointer"
    >
      <div className="w-1 rounded-full shrink-0 self-stretch" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{event.title}</span>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground capitalize">
            {event.type}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmt(event.start as unknown as { toDate(): Date })}
            {event.end && ` – ${fmt(event.end as unknown as { toDate(): Date })}`}
          </span>
          {event.location && (
            <span className="flex items-center gap-1 max-w-[200px] truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {event.location}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SessionsCalendar ─────────────────────────────────────────────────────────

interface SessionsCalendarProps {
  sessions: Session[]
  activities: Activity[]
  events?: Event[]
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
}

export default function SessionsCalendar({
  sessions,
  activities,
  events = [],
  onEdit,
  onDelete,
}: SessionsCalendarProps) {
  const router = useRouter()
  const today = useMemo(() => new Date(), [])

  const [viewYear,  setViewYear ] = useState(() => today.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => today.getMonth())
  const [selected,  setSelected ] = useState<Date>(() => new Date(today))

  // Index sessions by date key
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      if (!s.start) continue
      const k = dateKey((s.start as { toDate(): Date }).toDate())
      map.set(k, [...(map.get(k) ?? []), s])
    }
    return map
  }, [sessions])

  // Index events by date key
  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>()
    for (const e of events) {
      if (!e.start) continue
      const k = dateKey((e.start as unknown as { toDate(): Date }).toDate())
      map.set(k, [...(map.get(k) ?? []), e])
    }
    return map
  }, [events])

  const daySessions = useMemo(() => {
    return (sessionsByDate.get(dateKey(selected)) ?? [])
      .slice()
      .sort((a, b) => {
        const ta = (a.start as { toDate(): Date } | undefined)?.toDate().getTime() ?? 0
        const tb = (b.start as { toDate(): Date } | undefined)?.toDate().getTime() ?? 0
        return ta - tb
      })
  }, [sessionsByDate, selected])

  const dayEvents = useMemo(() => {
    return (eventsByDate.get(dateKey(selected)) ?? [])
      .slice()
      .sort((a, b) => {
        const ta = (a.start as unknown as { toDate(): Date } | undefined)?.toDate().getTime() ?? 0
        const tb = (b.start as unknown as { toDate(): Date } | undefined)?.toDate().getTime() ?? 0
        return ta - tb
      })
  }, [eventsByDate, selected])

  const weeks = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) }
    else setViewMonth((m) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) }
    else setViewMonth((m) => m + 1)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

      {/* ── Calendar pane ── */}
      <div className="lg:w-72 shrink-0">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3 px-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} className="text-center text-[11px] font-medium text-muted-foreground py-1 select-none">
              {label}
            </div>
          ))}
        </div>

        {/* Day grid */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) =>
              day ? (
                <DayCell
                  key={di}
                  day={day}
                  sessions={sessionsByDate.get(dateKey(day)) ?? []}
                  events={eventsByDate.get(dateKey(day)) ?? []}
                  isSelected={sameDay(day, selected)}
                  isToday={sameDay(day, today)}
                  onClick={setSelected}
                />
              ) : (
                <div key={di} />
              ),
            )}
          </div>
        ))}
      </div>

      {/* ── Day detail pane ── */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-base mb-4">
          {selected.toLocaleDateString([], {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}
        </h3>

        {daySessions.length === 0 && dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <CalendarDays className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nothing scheduled for this day</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
            {daySessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                activities={activities}
                onOpen={(s) => router.push(`/sessions/${s.id}` as Route)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
