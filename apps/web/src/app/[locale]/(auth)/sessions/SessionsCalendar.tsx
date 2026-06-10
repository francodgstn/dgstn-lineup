'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft, ChevronRight, Clock, MapPin, Users, User,
  Pencil, Trash2, CalendarDays, CalendarRange,
} from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'
import type { Session, Activity, Event } from '@linyup/shared'
import { SessionPeekSheet } from '@/components/sessions/SessionPeekSheet'

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

const EVENT_TYPE_COLOR: Record<string, string> = {
  competition: '#EF4444',
  camp:        '#F97316',
  exam:        '#8B5CF6',
  seminar:     '#3B82F6',
  workshop:    '#10B981',
}

// ─── calendar helpers ─────────────────────────────────────────────────────────

function buildMonthGrid(year: number, month: number): Date[][] {
  const first  = new Date(year, month, 1)
  const last   = new Date(year, month + 1, 0)
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
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

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

type DetailMode = 'day' | 'week'
type DayItem = { kind: 'session'; data: Session } | { kind: 'event'; data: Event }

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('Calendar')
  const cfg: Record<string, { cls: string; label: string }> = {
    open:      { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: t('statusOpen') },
    full:      { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',         label: t('statusFull') },
    cancelled: { cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',                 label: t('statusCancelled') },
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
  count: number
  isSelected: boolean
  isToday: boolean
  isOutside: boolean
  inWeek: boolean
  bandStart: boolean
  bandEnd: boolean
  onClick: (d: Date) => void
}

function DayCell({ day, count, isSelected, isToday, isOutside, inWeek, bandStart, bandEnd, onClick }: DayCellProps) {
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
        muted && 'text-muted-foreground/50',
      )}
    >
      <span className="text-sm leading-none">{day.getDate()}</span>
      {count > 0 && (
        <div className={cn('flex items-center justify-center h-2', muted && 'opacity-40')}>
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
  const t = useTranslations('Calendar')
  const color = activityAccent(session.activityId, activities)

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
          <span className="font-medium text-sm truncate">{session.activityName ?? t('noActivity')}</span>
          <StatusBadge status={session.status ?? 'open'} />
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

function EventCard({ event }: { event: Event }) {
  const router = useRouter()
  const color = EVENT_TYPE_COLOR[event.type] ?? '#6B7280'

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
function layoutDaySessions(daySessions: Session[], rangeStartHour: number, rangeEndHour: number): PositionedSession[] {
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
      if (c === -1) { c = colEnds.length; colEnds.push(0) }
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

// ─── SessionsCalendar ─────────────────────────────────────────────────────────

interface SessionsCalendarProps {
  sessions: Session[]
  activities: Activity[]
  events?: Event[]
  onEdit: (s: Session) => void
  onDelete: (s: Session) => void
  viewYear?: number
  viewMonth?: number
  onNavigate?: (year: number, month: number) => void
}

export default function SessionsCalendar({
  sessions,
  activities,
  events = [],
  onEdit,
  onDelete,
  viewYear:  externalYear,
  viewMonth: externalMonth,
  onNavigate,
}: SessionsCalendarProps) {
  const t = useTranslations('Calendar')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const today = useMemo(() => new Date(), [])

  const [internalYear,  setInternalYear ] = useState(() => today.getFullYear())
  const [internalMonth, setInternalMonth] = useState(() => today.getMonth())
  const [selected,      setSelected     ] = useState<Date>(() => new Date(today))
  const [mode,          setMode         ] = useState<DetailMode>('day')
  const [peekSessionId, setPeekSessionId] = useState<string | null>(null)

  const viewYear  = externalYear  ?? internalYear
  const viewMonth = externalMonth ?? internalMonth

  function navigate(y: number, m: number) {
    if (onNavigate) { onNavigate(y, m) } else { setInternalYear(y); setInternalMonth(m) }
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
    () => (sessionsByDate.get(dateKey(selected)) ?? []).slice().sort((a, b) =>
      itemMs({ kind: 'session', data: a }) - itemMs({ kind: 'session', data: b })),
    [sessionsByDate, selected],
  )
  const dayEvents = useMemo(
    () => (eventsByDate.get(dateKey(selected)) ?? []).slice().sort((a, b) =>
      itemMs({ kind: 'event', data: a }) - itemMs({ kind: 'event', data: b })),
    [eventsByDate, selected],
  )

  const weeks = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  // Month-wide stats for the displayed month (sessions query window covers prev/current/next month)
  const monthStats = useMemo(() => {
    const inMonth = (ts?: { toDate(): Date } | null) => {
      const d = ts?.toDate()
      return !!d && d.getFullYear() === viewYear && d.getMonth() === viewMonth
    }
    let groupClasses = 0
    let coaching = 0
    for (const s of sessions) {
      if (!inMonth(s.start)) continue
      if (s.activityType === 'coaching') coaching++
      else groupClasses++
    }
    const eventCount = events.filter((e) => inMonth(e.start as unknown as { toDate(): Date })).length
    return { groupClasses, coaching, eventCount }
  }, [sessions, events, viewYear, viewMonth])

  const weekStart = useMemo(() => startOfWeek(selected), [selected])
  const weekEnd   = useMemo(() => addDays(weekStart, 6), [weekStart])
  const weekDays  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  // Week time grid: hour range (8–20 by default, stretched to fit) + positioned blocks per day
  const weekGrid = useMemo(() => {
    let startHour = 8
    let endHour = 20
    for (const d of weekDays) {
      for (const s of sessionsByDate.get(dateKey(d)) ?? []) {
        const st = (s.start as { toDate(): Date }).toDate()
        startHour = Math.min(startHour, st.getHours())
        const en = (s.end as { toDate(): Date } | undefined)?.toDate()
        const endH = en && sameDay(en, st) ? en.getHours() + (en.getMinutes() > 0 ? 1 : 0) : st.getHours() + 1
        endHour = Math.max(endHour, Math.min(endH, 24))
      }
    }
    const days = weekDays.map((day) => ({
      day,
      events: eventsByDate.get(dateKey(day)) ?? [],
      blocks: layoutDaySessions(sessionsByDate.get(dateKey(day)) ?? [], startHour, endHour),
    }))
    return { startHour, endHour, days, hasEvents: days.some((d) => d.events.length > 0) }
  }, [weekDays, sessionsByDate, eventsByDate])

  const gridHeight = (weekGrid.endHour - weekGrid.startHour) * HOUR_PX
  const hourCount  = weekGrid.endHour - weekGrid.startHour

  // Locale-aware labels
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
  const weekdayNarrow = useMemo(
    // 2024-01-01 is a Monday — derives Mon-first narrow labels from the browser locale
    () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: 'narrow' })),
    [],
  )

  function weekRangeLabel() {
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
    const startStr = weekStart.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
    const endStr = weekEnd.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
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
    selectDate(addDays(selected, dir * (mode === 'day' ? 1 : 7)))
  }
  function goToday() {
    selectDate(new Date(today))
  }

  const openSessionPeek = (s: Session) => setPeekSessionId(s.id)

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

      {/* ── Calendar pane ── */}
      <div className="lg:w-72 shrink-0">
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
            <div key={i} className="text-center text-[11px] font-medium text-muted-foreground py-1 select-none">
              {label}
            </div>
          ))}
        </div>

        {/* Day grid */}
        {weeks.map((week, wi) => {
          const inBand = (d: Date) =>
            mode === 'week' && d.getTime() >= weekStart.getTime() && d.getTime() <= weekEnd.getTime()
          return (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day, di) => (
                <DayCell
                  key={di}
                  day={day}
                  count={(sessionsByDate.get(dateKey(day))?.length ?? 0) + (eventsByDate.get(dateKey(day))?.length ?? 0)}
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

        {/* Month overview — desktop only, fills the space under the mini calendar */}
        <div className="hidden lg:block mt-6 pt-4 border-t">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 select-none">
            {t('monthSummary')}
          </p>
          <div className="space-y-0.5">
            <div className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />{t('monthGroupClasses')}
              </span>
              <span className="text-sm font-semibold tabular-nums">{monthStats.groupClasses}</span>
            </div>
            {monthStats.coaching > 0 && (
              <div className="flex items-center justify-between py-1">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" />{t('monthCoaching')}
                </span>
                <span className="text-sm font-semibold tabular-nums">{monthStats.coaching}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarRange className="h-3.5 w-3.5" />{t('monthEvents')}
              </span>
              <span className="text-sm font-semibold tabular-nums">{monthStats.eventCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail pane ── */}
      <div className="flex-1 min-w-0">
        {/* Detail header: stepper + title + today + day/week toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-1 min-w-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <h3 className="font-semibold text-base truncate ml-1">
              {mode === 'day'
                ? selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                : weekRangeLabel()}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goToday}>
              {tCommon('today')}
            </Button>
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              {(['day', 'week'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    mode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(m === 'day' ? 'modeDay' : 'modeWeek')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Day mode ── */}
        {mode === 'day' && (
          daySessions.length === 0 && dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <CalendarDays className="h-8 w-8 opacity-30" />
              <p className="text-sm">{t('emptyDay')}</p>
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
                  onOpen={openSessionPeek}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )
        )}

        {/* ── Week mode — timetable grid ── */}
        {mode === 'week' && (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">

                {/* Day headers — click to zoom into day mode */}
                <div className="grid border-b" style={WEEK_GRID_COLS}>
                  <div />
                  {weekGrid.days.map(({ day }) => {
                    const isToday = sameDay(day, today)
                    return (
                      <button
                        key={dateKey(day)}
                        onClick={() => { selectDate(day); setMode('day') }}
                        className="flex flex-col items-center gap-0.5 py-2 border-l group min-w-0"
                        title={t('modeDay')}
                      >
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {day.toLocaleDateString([], { weekday: 'short' })}
                        </span>
                        <span className={cn(
                          'h-6 w-6 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                          isToday ? 'bg-primary text-primary-foreground' : 'group-hover:bg-muted',
                        )}>
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
                      <div key={dateKey(day)} className="border-l px-1 py-1 space-y-1 min-w-0">
                        {dayEvts.map((e) => {
                          const color = EVENT_TYPE_COLOR[e.type] ?? '#6B7280'
                          return (
                            <button
                              key={e.id}
                              onClick={() => router.push(`/events/${e.id}` as Route)}
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
                  {weekGrid.days.map(({ day, blocks }) => {
                    const isToday = sameDay(day, today)
                    const now = new Date()
                    const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60 - weekGrid.startHour) * HOUR_PX
                    return (
                      <div
                        key={dateKey(day)}
                        className={cn('relative border-l', isToday && 'bg-primary/[0.03]')}
                        style={{ height: gridHeight }}
                      >
                        {/* Hour lines */}
                        {Array.from({ length: hourCount }, (_, i) => (
                          <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />
                        ))}

                        {/* Now indicator */}
                        {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                          <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                            <div className="h-px bg-red-500" />
                            <div className="absolute -top-[2.5px] left-0 h-1.5 w-1.5 rounded-full bg-red-500" />
                          </div>
                        )}

                        {/* Session blocks */}
                        {blocks.map(({ session: s, top, height, col, cols }) => {
                          const color = activityAccent(s.activityId, activities)
                          const cancelled = s.status === 'cancelled'
                          return (
                            <button
                              key={s.id}
                              onClick={() => openSessionPeek(s)}
                              className={cn(
                                'absolute z-[5] rounded-md border-l-2 px-1.5 py-0.5 text-left overflow-hidden transition-opacity hover:opacity-75',
                                cancelled && 'opacity-50',
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
                              <p className={cn('text-[11px] font-medium truncate leading-tight', cancelled && 'line-through')}>
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
        )}
      </div>

      {/* ── Session preview ── */}
      <SessionPeekSheet
        sessionId={peekSessionId}
        onClose={() => setPeekSessionId(null)}
        activities={activities}
        onEdit={(s) => { setPeekSessionId(null); onEdit(s) }}
        onDelete={(s) => { setPeekSessionId(null); onDelete(s) }}
      />
    </div>
  )
}
