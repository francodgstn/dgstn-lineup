'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Users,
  Pencil,
  Trash2,
  CalendarDays,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { resolveAppointmentDurations, isExpiredAppointmentHold } from '@linyup/shared'
import type { Session, Activity, Event, Availability } from '@linyup/shared'
import { SessionPeekSheet } from '@/components/sessions/SessionPeekSheet'
import { EventPeekSheet } from '@/components/events/EventPeekSheet'

// ─── colour palette ───────────────────────────────────────────────────────────

const PALETTE = [
  '#7C3AED',
  '#EC4899',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#F43F5E',
  '#0EA5E9',
  '#22C55E',
]

function activityAccent(activityId?: string | null, activities: Activity[] = []): string {
  const custom = activities.find((a) => a.id === activityId)?.color
  if (custom) return custom
  if (!activityId) return PALETTE[0]
  let h = 0
  for (const ch of activityId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const EVENT_TYPE_COLOR: Record<string, string> = {
  competition: '#EF4444',
  camp: '#F97316',
  exam: '#8B5CF6',
  seminar: '#3B82F6',
  workshop: '#10B981',
}

// ─── calendar helpers ─────────────────────────────────────────────────────────

function buildMonthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const offset = (first.getDay() + 6) % 7 // Mon=0 … Sun=6
  // Pad with real prev/next-month days so every week is complete
  const total = Math.ceil((offset + last.getDate()) / 7) * 7
  const cells = Array.from({ length: total }, (_, i) => new Date(year, month, 1 - offset + i))
  const weeks: Date[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** Monday of the week containing d, at midnight. */
function startOfWeek(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

function formatTs(ts?: { toDate(): Date } | null) {
  return ts?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''
}

function itemMs(item: DayItem) {
  return (item.data.start as unknown as { toDate(): Date } | undefined)?.toDate().getTime() ?? 0
}

type DayItem = { kind: 'session'; data: Session } | { kind: 'event'; data: Event }

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('Calendar')
  const cfg: Record<string, { cls: string; label: string }> = {
    open: {
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      label: t('statusOpen'),
    },
    full: {
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      label: t('statusFull'),
    },
    cancelled: {
      cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
      label: t('statusCancelled'),
    },
    // A paid-booking HOLD — the slot is reserved while checkout completes. Never
    // published publicly; ghosted here so admin never mistakes it for a real
    // booking. An expired-but-unswept hold is displayed as 'cancelled' instead
    // (see effectiveSessionStatus) — this entry only fires for a LIVE hold.
    pending_payment: {
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      label: t('statusAwaitingPayment'),
    },
  }
  const { cls, label } = cfg[status] ?? { cls: 'bg-muted text-muted-foreground', label: status }
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {label}
    </span>
  )
}

// The single source of truth for "what status do we SHOW" — a lapsed paid-booking
// hold (see isExpiredAppointmentHold) is logically free/cancelled even before the
// daily sweep flips the stored status, so admin surfaces should never render it as
// a live 'pending_payment' hold.
function effectiveSessionStatus(s: Session, nowMs: number): string {
  return isExpiredAppointmentHold(s, nowMs) ? 'cancelled' : (s.status ?? 'open')
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayCellProps {
  day: Date
  count: number
  isSelected: boolean
  isToday: boolean
  isOutside: boolean
  inWeek: boolean
  bandStart: boolean
  bandEnd: boolean
  onClick: (d: Date) => void
}

function DayCell({
  day,
  count,
  isSelected,
  isToday,
  isOutside,
  inWeek,
  bandStart,
  bandEnd,
  onClick,
}: DayCellProps) {
  const dotColor = isSelected ? 'rgba(255,255,255,0.8)' : 'var(--primary)'
  const muted = isOutside && !isSelected

  return (
    <button
      onClick={() => onClick(day)}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 w-full aspect-square transition-colors',
        inWeek && !isSelected && 'bg-primary/10 rounded-none hover:bg-primary/20',
        inWeek && bandStart && 'rounded-l-lg',
        inWeek && bandEnd && 'rounded-r-lg',
        isSelected
          ? 'bg-primary text-primary-foreground'
          : cn(isToday && 'text-primary font-semibold', !inWeek && 'hover:bg-muted'),
        muted && 'text-muted-foreground/50'
      )}
    >
      <span className="text-sm leading-none">{day.getDate()}</span>
      {count > 0 && (
        <div className={cn('flex items-center justify-center h-2', muted && 'opacity-40')}>
          {/* front dot */}
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
          {/* back dot — offset behind front, lower opacity → "stacked" look */}
          {count > 1 && (
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0 -ml-0.5"
              style={{ backgroundColor: dotColor, opacity: 0.4 }}
            />
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
  const t = useTranslations('Calendar')
  const color = activityAccent(session.activityId, activities)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(session)}
      className="flex gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors group cursor-pointer"
    >
      {/* activity colour strip */}
      <div className="w-1 rounded-full shrink-0 self-stretch" style={{ backgroundColor: color }} />

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* row 1: name + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">
            {session.activityName ?? t('noActivity')}
          </span>
          <StatusBadge status={effectiveSessionStatus(session, Date.now())} />
        </div>

        {/* row 2: time + location */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTs(session.start)} – {formatTs(session.end)}
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
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(session)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(session)
              }}
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

function EventCard({ event, onOpen }: { event: Event; onOpen: (e: Event) => void }) {
  const color = EVENT_TYPE_COLOR[event.type] ?? '#6B7280'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(event)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(event)}
      className="flex gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors cursor-pointer"
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
            {formatTs(event.start as unknown as { toDate(): Date })}
            {event.end && ` – ${formatTs(event.end as unknown as { toDate(): Date })}`}
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

// ─── week time-grid layout ────────────────────────────────────────────────────

const HOUR_PX = 48
const MIN_BLOCK_PX = 22
const WEEK_GRID_COLS = { gridTemplateColumns: '3.25rem repeat(7, minmax(0, 1fr))' } as const

interface PositionedSession {
  session: Session
  top: number
  height: number
  col: number
  cols: number
}

/**
 * Position a day's sessions on the time grid. Transitively-overlapping
 * sessions form a cluster; within a cluster each session is greedily assigned
 * the first free column and all cluster members share the column count.
 */
function layoutDaySessions(
  daySessions: Session[],
  rangeStartHour: number,
  rangeEndHour: number
): PositionedSession[] {
  const rangeStartMin = rangeStartHour * 60
  const rangeEndMin = rangeEndHour * 60
  const items = daySessions
    .map((s) => {
      const st = (s.start as { toDate(): Date }).toDate()
      const startMin = st.getHours() * 60 + st.getMinutes()
      const en = (s.end as { toDate(): Date } | undefined)?.toDate()
      let endMin = en && sameDay(en, st) ? en.getHours() * 60 + en.getMinutes() : startMin + 60
      endMin = Math.min(Math.max(endMin, startMin + 30), rangeEndMin) // ≥30min visual, clamp to grid
      return { s, startMin, endMin }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const placed: PositionedSession[] = []
  let cluster: typeof items = []
  let clusterEnd = -1

  const flush = () => {
    if (!cluster.length) return
    const colEnds: number[] = []
    const cols = cluster.map((it) => {
      let c = colEnds.findIndex((end) => end <= it.startMin)
      if (c === -1) {
        c = colEnds.length
        colEnds.push(0)
      }
      colEnds[c] = it.endMin
      return c
    })
    const n = colEnds.length
    cluster.forEach((it, i) => {
      placed.push({
        session: it.s,
        top: ((it.startMin - rangeStartMin) / 60) * HOUR_PX,
        height: Math.max(((it.endMin - it.startMin) / 60) * HOUR_PX, MIN_BLOCK_PX),
        col: cols[i],
        cols: n,
      })
    })
    cluster = []
    clusterEnd = -1
  }

  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()
  return placed
}

// ─── availability bands (Calendly-style "free time" background) ──────────────
//
// Not a slot computation — just the RAW published window/times from
// `availability` docs, expanded over the visible dates. Booked appointments
// already render as solid session blocks on top of these, so "free vs taken"
// reads correctly for free. Callers filter to a single provider + active
// status before passing `availability` in — this component doesn't re-derive
// that scoping (see schedule/page.tsx).

interface RawAvailabilityBand {
  key: string
  title: string
  startMin: number
  endMin: number
}

interface PositionedAvailabilityBand {
  key: string
  title: string
  top: number
  height: number
}

/** Shortest duration among the availability's linked activities — a 'times'
 *  entry has no length of its own, so the band uses the shortest bookable
 *  duration (the most conservative "at least this free"). Falls back to
 *  30min if no linked activity resolves a duration. */
function shortestActivityDuration(activityIds: string[] | undefined, activities: Activity[]): number {
  const durations = (activityIds ?? [])
    .flatMap((id) => {
      const activity = activities.find((a) => a.id === id)
      return activity ? resolveAppointmentDurations(activity).map((d) => d.minutes) : []
    })
    .filter((d) => d > 0)
  return durations.length ? Math.min(...durations) : 30
}

/** Expand one day's active availability schedules into raw (unpositioned)
 *  bands. `daysOfWeek` uses the same 0=Sun…6=Sat convention as `Date#getDay()`,
 *  so no remapping is needed. Times are 'HH:MM' Europe/Zurich, read as local
 *  wall-clock minutes — the same convention the grid already uses for session
 *  start/end (both derive from `Date#getHours()/getMinutes()`). */
function expandAvailabilityForDay(
  day: Date,
  availability: (Availability & { id: string })[],
  activities: Activity[]
): RawAvailabilityBand[] {
  const weekday = day.getDay()
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const bands: RawAvailabilityBand[] = []

  for (const a of availability) {
    if (!a.recurrence.daysOfWeek.includes(weekday)) continue
    const start = a.recurrence.startDate.toDate()
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    if (dayStart < startDay) continue
    if (a.recurrence.endDate) {
      const end = a.recurrence.endDate.toDate()
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
      if (dayStart > endDay) continue
    }

    if (a.mode === 'range' && a.window) {
      const [sh, sm] = a.window.start.split(':').map(Number)
      const [eh, em] = a.window.end.split(':').map(Number)
      if (Number.isFinite(sh) && Number.isFinite(sm) && Number.isFinite(eh) && Number.isFinite(em)) {
        bands.push({ key: `${a.id}-range`, title: a.title, startMin: sh * 60 + sm, endMin: eh * 60 + em })
      }
    } else if (a.mode === 'times' && a.times?.length) {
      const duration = shortestActivityDuration(a.activityIds, activities)
      for (const time of a.times) {
        const [h, m] = time.split(':').map(Number)
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue
        const startMin = h * 60 + m
        bands.push({ key: `${a.id}-${time}`, title: a.title, startMin, endMin: startMin + duration })
      }
    }
  }
  return bands
}

// ─── SessionsCalendar ─────────────────────────────────────────────────────────

interface SessionsCalendarProps {
  sessions: Session[]
  activities: Activity[]
  events?: Event[]
  /** Active, single-provider-scoped availability to render as translucent
   *  "free time" bands behind the week grid's session blocks. Pass an empty
   *  array (or omit) to render none — the caller (schedule/page.tsx) decides
   *  eligibility (single coach in scope + type filter includes appointments);
   *  this component just expands+positions whatever it's given. */
  availability?: (Availability & { id: string })[]
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
  onEventEdit?: (e: Event) => void
  onEventDelete?: (e: Event) => void
  viewYear?: number
  viewMonth?: number
  onNavigate?: (year: number, month: number) => void
}

export default function SessionsCalendar({
  sessions,
  activities,
  events = [],
  availability = [],
  onEdit,
  onDelete,
  onEventEdit,
  onEventDelete,
  viewYear: externalYear,
  viewMonth: externalMonth,
  onNavigate,
}: SessionsCalendarProps) {
  const t = useTranslations('Calendar')
  const tCommon = useTranslations('Common')
  const today = useMemo(() => new Date(), [])

  const [internalYear, setInternalYear] = useState(() => today.getFullYear())
  const [internalMonth, setInternalMonth] = useState(() => today.getMonth())
  const [selected, setSelected] = useState<Date>(() => new Date(today))
  const [peekSessionId, setPeekSessionId] = useState<string | null>(null)
  const [peekEventId, setPeekEventId] = useState<string | null>(null)
  // Expand the week grid to full width, hiding the month mini-calendar + day agenda.
  const [fullWeek, setFullWeek] = useState(false)

  const viewYear = externalYear ?? internalYear
  const viewMonth = externalMonth ?? internalMonth

  function navigate(y: number, m: number) {
    if (onNavigate) {
      onNavigate(y, m)
    } else {
      setInternalYear(y)
      setInternalMonth(m)
    }
  }

  /** Select a date and keep the mini calendar (and data window) on its month. */
  function selectDate(d: Date) {
    setSelected(d)
    if (d.getMonth() !== viewMonth || d.getFullYear() !== viewYear) {
      navigate(d.getFullYear(), d.getMonth())
    }
  }

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

  const daySessions = useMemo(
    () =>
      (sessionsByDate.get(dateKey(selected)) ?? [])
        .slice()
        .sort(
          (a, b) => itemMs({ kind: 'session', data: a }) - itemMs({ kind: 'session', data: b })
        ),
    [sessionsByDate, selected]
  )
  const dayEvents = useMemo(
    () =>
      (eventsByDate.get(dateKey(selected)) ?? [])
        .slice()
        .sort((a, b) => itemMs({ kind: 'event', data: a }) - itemMs({ kind: 'event', data: b })),
    [eventsByDate, selected]
  )

  const weeks = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  const weekStart = useMemo(() => startOfWeek(selected), [selected])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  // Week time grid: hour range (8–20 by default, stretched to fit) + positioned blocks per day
  const weekGrid = useMemo(() => {
    let startHour = 8
    let endHour = 20

    // Raw (unpositioned) availability bands per day — computed before the
    // final hour range so a published window outside the session-derived
    // range (e.g. an early-morning slot with no bookings yet) still stretches
    // the grid to show it in full.
    const dayRawBands = weekDays.map((day) => expandAvailabilityForDay(day, availability, activities))

    for (const d of weekDays) {
      for (const s of sessionsByDate.get(dateKey(d)) ?? []) {
        const st = (s.start as { toDate(): Date }).toDate()
        startHour = Math.min(startHour, st.getHours())
        const en = (s.end as { toDate(): Date } | undefined)?.toDate()
        const endH =
          en && sameDay(en, st) ? en.getHours() + (en.getMinutes() > 0 ? 1 : 0) : st.getHours() + 1
        endHour = Math.max(endHour, Math.min(endH, 24))
      }
    }
    for (const dayBands of dayRawBands) {
      for (const b of dayBands) {
        startHour = Math.min(startHour, Math.floor(b.startMin / 60))
        endHour = Math.max(endHour, Math.min(Math.ceil(b.endMin / 60), 24))
      }
    }

    // Positioned with the exact same formula `layoutDaySessions` uses for
    // session blocks (top = (minutesSinceRangeStart / 60) * HOUR_PX), so a
    // band's top edge lines up exactly with a session block at the same
    // clock time.
    const rangeStartMin = startHour * 60
    const days = weekDays.map((day, i) => ({
      day,
      events: eventsByDate.get(dateKey(day)) ?? [],
      blocks: layoutDaySessions(sessionsByDate.get(dateKey(day)) ?? [], startHour, endHour),
      bands: dayRawBands[i].map(
        (b): PositionedAvailabilityBand => ({
          key: b.key,
          title: b.title,
          top: ((b.startMin - rangeStartMin) / 60) * HOUR_PX,
          height: Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX, 6),
        })
      ),
    }))
    return { startHour, endHour, days, hasEvents: days.some((d) => d.events.length > 0) }
  }, [weekDays, sessionsByDate, eventsByDate, availability, activities])

  const gridHeight = (weekGrid.endHour - weekGrid.startHour) * HOUR_PX
  const hourCount = weekGrid.endHour - weekGrid.startHour

  // Locale-aware labels
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
  const weekdayNarrow = useMemo(
    // 2024-01-01 is a Monday — derives Mon-first narrow labels from the browser locale
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: 'narrow' })
      ),
    []
  )

  function weekRangeLabel() {
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
    const startStr = weekStart.toLocaleDateString(
      [],
      sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }
    )
    const endStr = weekEnd.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return `${startStr} – ${endStr}`
  }

  function prevMonth() {
    if (viewMonth === 0) navigate(viewYear - 1, 11)
    else navigate(viewYear, viewMonth - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) navigate(viewYear + 1, 0)
    else navigate(viewYear, viewMonth + 1)
  }

  function step(dir: 1 | -1) {
    selectDate(addDays(selected, dir * 7))
  }
  function goToday() {
    selectDate(new Date(today))
  }

  const openSessionPeek = (s: Session) => setPeekSessionId(s.id)
  const openEventPeek = (e: Event) => setPeekEventId(e.id)

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
      {/* ── Calendar pane (right on desktop) — hidden when the week is expanded ── */}
      {!fullWeek && (
      <div className="lg:order-2 lg:w-72 shrink-0 lg:flex lg:flex-col lg:min-h-0">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3 px-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold capitalize">{monthLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 mb-1">
          {weekdayNarrow.map((label, i) => (
            <div
              key={i}
              className="text-center text-[11px] font-medium text-muted-foreground py-1 select-none"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day grid */}
        {weeks.map((week, wi) => {
          const inBand = (d: Date) =>
            d.getTime() >= weekStart.getTime() && d.getTime() <= weekEnd.getTime()
          return (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day, di) => (
                <DayCell
                  key={di}
                  day={day}
                  count={
                    (sessionsByDate.get(dateKey(day))?.length ?? 0) +
                    (eventsByDate.get(dateKey(day))?.length ?? 0)
                  }
                  isSelected={sameDay(day, selected)}
                  isToday={sameDay(day, today)}
                  isOutside={day.getMonth() !== viewMonth}
                  inWeek={inBand(day)}
                  bandStart={di === 0}
                  bandEnd={di === 6}
                  onClick={setSelected}
                />
              ))}
            </div>
          )
        })}

        {/* Selected-day detail — the day agenda, anchored under the calendar.
            On desktop it fills the space below the mini-calendar (the column is
            stretched to the week-grid height by the flex row) and scrolls, so a
            busy day never grows the page. */}
        <div className="mt-6 pt-4 border-t lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 select-none capitalize">
            {selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {daySessions.length === 0 && dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <CalendarDays className="h-7 w-7 opacity-30" />
              <p className="text-sm">{t('emptyDay')}</p>
            </div>
          ) : (
            <div className="-mx-2 space-y-0.5 max-h-[28rem] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
              {dayEvents.map((e) => (
                <EventCard key={e.id} event={e} onOpen={openEventPeek} />
              ))}
              {daySessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  activities={activities}
                  onOpen={openSessionPeek}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Detail pane (left on desktop) — week grid; fills the row when expanded ── */}
      <div className="lg:order-1 flex-1 min-w-0">
        {/* Week header: stepper + range + today */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-1 min-w-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <h3 className="font-semibold text-base truncate ml-1">{weekRangeLabel()}</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={goToday}>
              {tCommon('today')}
            </Button>
            {/* Expand the week grid to full width (hide month + agenda) — desktop only */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex h-7 w-7"
              onClick={() => setFullWeek((v) => !v)}
              title={fullWeek ? t('collapseWeek') : t('expandWeek')}
              aria-label={fullWeek ? t('collapseWeek') : t('expandWeek')}
            >
              {fullWeek ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* ── Week timetable grid ── */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Day headers — click to focus that day in the detail panel */}
              <div className="grid border-b" style={WEEK_GRID_COLS}>
                <div />
                {weekGrid.days.map(({ day }) => {
                  const isToday = sameDay(day, today)
                  const isSelected = sameDay(day, selected)
                  return (
                    <button
                      key={dateKey(day)}
                      onClick={() => selectDate(day)}
                      className={cn(
                        'flex flex-col items-center gap-0.5 py-2 border-l group min-w-0 transition-colors',
                        isSelected && 'bg-primary/[0.07]'
                      )}
                      title={day.toLocaleDateString([], {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {day.toLocaleDateString([], { weekday: 'short' })}
                      </span>
                      <span
                        className={cn(
                          'h-6 w-6 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                          isToday
                            ? 'bg-primary text-primary-foreground'
                            : isSelected
                              ? 'bg-primary/15 text-primary'
                              : 'group-hover:bg-muted'
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Events strip */}
              {weekGrid.hasEvents && (
                <div className="grid border-b" style={WEEK_GRID_COLS}>
                  <div />
                  {weekGrid.days.map(({ day, events: dayEvts }) => (
                    <div
                      key={dateKey(day)}
                      className={cn(
                        'border-l px-1 py-1 space-y-1 min-w-0',
                        sameDay(day, selected) && 'bg-primary/[0.07]'
                      )}
                    >
                      {dayEvts.map((e) => {
                        const color = EVENT_TYPE_COLOR[e.type] ?? '#6B7280'
                        return (
                          <button
                            key={e.id}
                            onClick={() => openEventPeek(e)}
                            className="w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-left transition-opacity hover:opacity-80"
                            style={{ backgroundColor: `${color}1F`, color }}
                            title={e.title}
                          >
                            {e.title}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              {/* Time grid */}
              <div className="grid" style={WEEK_GRID_COLS}>
                {/* Hour axis */}
                <div className="relative" style={{ height: gridHeight }}>
                  {Array.from({ length: hourCount }, (_, i) => (
                    <span
                      key={i}
                      className="absolute right-1.5 text-[10px] text-muted-foreground tabular-nums select-none"
                      style={{ top: i * HOUR_PX + 2 }}
                    >
                      {String(weekGrid.startHour + i).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>

                {/* Day columns */}
                {weekGrid.days.map(({ day, blocks, bands }) => {
                  const isToday = sameDay(day, today)
                  const isSelected = sameDay(day, selected)
                  const now = new Date()
                  const nowTop =
                    ((now.getHours() * 60 + now.getMinutes()) / 60 - weekGrid.startHour) * HOUR_PX
                  return (
                    <div
                      key={dateKey(day)}
                      className={cn(
                        'relative border-l',
                        // Selected day (from the mini calendar) gets a stronger tint than today.
                        isSelected ? 'bg-primary/[0.07]' : isToday && 'bg-primary/[0.03]'
                      )}
                      style={{ height: gridHeight }}
                    >
                      {/* Hour lines */}
                      {Array.from({ length: hourCount }, (_, i) => (
                        <div
                          key={i}
                          className="absolute inset-x-0 border-t border-border/60"
                          style={{ top: i * HOUR_PX }}
                        />
                      ))}

                      {/* Availability bands — the RAW published free time (single-provider
                          scope only, see schedule/page.tsx), rendered translucent behind
                          the session blocks so booked-vs-free reads at a glance. */}
                      {bands.map((band) => (
                        <div
                          key={band.key}
                          aria-hidden="true"
                          className="absolute inset-x-0.5 z-[2] overflow-hidden rounded-sm border border-dashed border-primary/25 bg-primary/[0.06] pointer-events-none"
                          style={{ top: band.top, height: band.height }}
                        >
                          {band.height >= 16 && (
                            <p className="truncate px-1 pt-0.5 text-[9px] font-medium leading-tight text-primary/70">
                              {band.title}
                            </p>
                          )}
                        </div>
                      ))}

                      {/* Now indicator */}
                      {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                        <div
                          className="absolute inset-x-0 z-10 pointer-events-none"
                          style={{ top: nowTop }}
                        >
                          <div className="h-px bg-red-500" />
                          <div className="absolute -top-[2.5px] left-0 h-1.5 w-1.5 rounded-full bg-red-500" />
                        </div>
                      )}

                      {/* Session blocks */}
                      {blocks.map(({ session: s, top, height, col, cols }) => {
                        const color = activityAccent(s.activityId, activities)
                        const expiredHold = isExpiredAppointmentHold(s, now.getTime())
                        const cancelled = s.status === 'cancelled' || expiredHold
                        // A LIVE paid-booking hold — ghosted like 'cancelled' (dimmed +
                        // dashed border) but NOT struck through: it isn't cancelled, it's
                        // reserved pending payment.
                        const awaitingPayment = s.status === 'pending_payment' && !expiredHold
                        return (
                          <button
                            key={s.id}
                            onClick={() => openSessionPeek(s)}
                            className={cn(
                              'absolute z-[5] rounded-md border-l-2 px-1.5 py-0.5 text-left overflow-hidden transition-opacity hover:opacity-75',
                              (cancelled || awaitingPayment) && 'opacity-50',
                              awaitingPayment && 'border-dashed'
                            )}
                            style={{
                              top: top + 1,
                              height: height - 2,
                              left: `calc(${(col / cols) * 100}% + 2px)`,
                              width: `calc(${100 / cols}% - 4px)`,
                              backgroundColor: `${color}1F`,
                              borderLeftColor: color,
                            }}
                          >
                            <p
                              className={cn(
                                'text-[11px] font-medium truncate leading-tight',
                                cancelled && 'line-through'
                              )}
                            >
                              {s.activityName ?? t('noActivity')}
                            </p>
                            {height >= 36 && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {formatTs(s.start)} – {formatTs(s.end)}
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Session preview ── */}
      <SessionPeekSheet
        sessionId={peekSessionId}
        onClose={() => setPeekSessionId(null)}
        activities={activities}
        onEdit={(s) => {
          setPeekSessionId(null)
          onEdit(s)
        }}
        onDelete={(s) => {
          setPeekSessionId(null)
          onDelete(s)
        }}
      />

      {/* ── Event preview ── */}
      <EventPeekSheet
        eventId={peekEventId}
        onClose={() => setPeekEventId(null)}
        onEdit={(e) => {
          setPeekEventId(null)
          onEventEdit?.(e)
        }}
        onDelete={(e) => {
          setPeekEventId(null)
          onEventDelete?.(e)
        }}
      />
    </div>
  )
}
