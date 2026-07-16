'use client'

// Public, read-only weekly time-grid planner — days as columns, hours as rows,
// sessions positioned/sized by start→end with overlaps side-by-side. Ported from
// the admin SessionsCalendar week grid (layoutDaySessions + grid math), minus
// auth, editing, peek sheets and Firestore access. Shared by the public website
// schedule section (components/site/sections.tsx) and the kiosk (KioskSchedule).
//
// The container scrolls horizontally on narrow screens; the hour axis sticks to
// the left so it stays visible. Shows the CURRENT week (Monday-anchored — a
// future team setting can drive `weekStartsOn`), pageable forward while the
// data window lasts.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Firestore-Timestamp-like — the public session mirror provides `{ toDate() }`. */
interface TimestampLike {
  toDate(): Date
}

export interface PlannerSession {
  id: string
  start: TimestampLike
  end?: TimestampLike | null
  activityName?: string | null
  activityColor?: string | null
  location?: string | null
  /** Provider running the slot (appointment sessions) — distinguishes parallel slots. */
  providerName?: string | null
  /** Per-session link target; takes precedence over the shared `bookingHref`
   *  (e.g. appointment slots link to the appointments page, classes to booking). */
  href?: string
}

const HOUR_PX = 48
const MIN_BLOCK_PX = 24
// Fallback palette for sessions whose activity has no colour set (hashed by id).
const PALETTE = ['#7C3AED', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#0EA5E9', '#22C55E']
const GRID_COLS = { gridTemplateColumns: '2.75rem repeat(7, minmax(6.5rem, 1fr))' } as const

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function colorFor(s: PlannerSession, accent?: string): string {
  if (s.activityColor) return s.activityColor
  if (accent) return accent
  let h = 0
  for (const ch of s.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

interface Positioned {
  s: PlannerSession
  top: number
  height: number
  col: number
  cols: number
}

/**
 * Position a day's sessions on the time grid. Transitively-overlapping sessions
 * form a cluster; within it each session takes the first free column and all
 * cluster members share the column count. (Ported from SessionsCalendar.)
 */
function layoutDay(day: PlannerSession[], startHour: number, endHour: number): Positioned[] {
  const rangeStartMin = startHour * 60
  const rangeEndMin = endHour * 60
  const items = day
    .map((s) => {
      const st = s.start.toDate()
      const startMin = st.getHours() * 60 + st.getMinutes()
      const en = s.end?.toDate()
      let endMin = en && sameDay(en, st) ? en.getHours() * 60 + en.getMinutes() : startMin + 60
      endMin = Math.min(Math.max(endMin, startMin + 30), rangeEndMin)
      return { s, startMin, endMin }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const placed: Positioned[] = []
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
        s: it.s,
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

interface Props {
  sessions: PlannerSession[]
  /** Theme accent (e.g. the website palette) used when a session has no colour. */
  accent?: string
  /** When set, each session block links here (e.g. the public booking page). */
  bookingHref?: string
  /** When set, clicking a block calls this (e.g. the kiosk detail modal). Takes
   *  precedence over `bookingHref`. */
  onSelect?: (session: PlannerSession) => void
  /** How many days ahead the schedule covers — bounds how many weeks the visitor
   *  can page forward. Defaults to 7 (a single week, no navigation shown). */
  windowDays?: number
}

/** Midnight Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

export function WeeklyCalendar({ sessions, accent, bookingHref, onSelect, windowDays = 7 }: Props) {
  // Weeks the visitor can page through: from the current (Monday-anchored) week
  // up to the week containing the end of the section's data window.
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const maxOffset = useMemo(() => {
    const last = new Date()
    last.setDate(last.getDate() + windowDays)
    return Math.max(0, Math.floor((last.getTime() - mondayOf(new Date()).getTime()) / weekMs))
  }, [windowDays, weekMs])
  // Land on the first week that actually has a session — for sparse/future
  // schedules (e.g. appointment slots starting next week) the current week is often
  // empty, and showing an empty grid reads as "nothing here". Near-term
  // schedules resolve to offset 0 (this week), unchanged.
  const initialOffset = useMemo(() => {
    let earliest = Infinity
    for (const s of sessions) earliest = Math.min(earliest, s.start.toDate().getTime())
    if (!isFinite(earliest)) return 0
    const off = Math.floor((earliest - mondayOf(new Date()).getTime()) / weekMs)
    return Math.max(0, Math.min(off, maxOffset))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [weekOffset, setWeekOffset] = useState(initialOffset)

  const { weekDays, startHour, endHour } = useMemo(() => {
    const start = mondayOf(new Date())
    start.setDate(start.getDate() + weekOffset * 7)

    const byDay = new Map<string, PlannerSession[]>()
    let sh = 8
    let eh = 20
    for (const s of sessions) {
      const st = s.start.toDate()
      const arr = byDay.get(dateKey(st))
      if (arr) arr.push(s)
      else byDay.set(dateKey(st), [s])
      sh = Math.min(sh, st.getHours())
      const en = s.end?.toDate()
      const endH = en && sameDay(en, st) ? en.getHours() + (en.getMinutes() > 0 ? 1 : 0) : st.getHours() + 1
      eh = Math.max(eh, Math.min(endH, 24))
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      return { date, blocks: layoutDay(byDay.get(dateKey(date)) ?? [], sh, eh) }
    })
    return { weekDays: days, startHour: sh, endHour: eh }
  }, [sessions, weekOffset])

  const hourCount = endHour - startHour
  const gridHeight = hourCount * HOUR_PX
  const today = new Date()
  const now = new Date()
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60 - startHour) * HOUR_PX

  return (
    <div>
      {maxOffset > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
            disabled={weekOffset === 0}
            aria-label="Previous week"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tabular-nums">
            {weekDays[0].date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            {' – '}
            {weekDays[6].date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => Math.min(maxOffset, o + 1))}
            disabled={weekOffset >= maxOffset}
            aria-label="Next week"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
      {/* Day headers */}
      <div className="grid" style={GRID_COLS}>
        <div className="sticky left-0 z-20 border-b bg-background" />
        {weekDays.map(({ date }) => {
          const isToday = sameDay(date, today)
          return (
            <div
              key={dateKey(date)}
              className={`border-b border-l px-1 py-1.5 text-center ${isToday ? 'bg-primary/5' : ''}`}
            >
              <p className="text-xs font-bold">{date.toLocaleDateString(undefined, { weekday: 'short' })}</p>
              <p className="text-[11px] text-muted-foreground">
                {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </p>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div className="grid" style={GRID_COLS}>
        {/* Hour axis — sticks left while scrolling horizontally */}
        <div className="sticky left-0 z-10 bg-background" style={{ height: gridHeight }}>
          <div className="relative h-full">
            {Array.from({ length: hourCount }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 text-[10px] text-muted-foreground tabular-nums select-none"
                style={{ top: i * HOUR_PX + 2 }}
              >
                {String(startHour + i).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {/* Day columns */}
        {weekDays.map(({ date, blocks }) => {
          const isToday = sameDay(date, today)
          return (
            <div
              key={dateKey(date)}
              className={`relative border-l ${isToday ? 'bg-primary/[0.03]' : ''}`}
              style={{ height: gridHeight }}
            >
              {Array.from({ length: hourCount }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />
              ))}

              {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-px bg-red-500" />
                  <div className="absolute -top-[2.5px] left-0 h-1.5 w-1.5 rounded-full bg-red-500" />
                </div>
              )}

              {blocks.map(({ s, top, height, col, cols }) => {
                const color = colorFor(s, accent)
                const style = {
                  top: top + 1,
                  height: height - 2,
                  left: `calc(${(col / cols) * 100}% + 2px)`,
                  width: `calc(${100 / cols}% - 4px)`,
                  backgroundColor: `${color}1F`,
                  borderLeftColor: color,
                }
                const name = s.activityName ?? 'Session'
                // Provider in the title distinguishes parallel slots (e.g. three
                // "Private Lesson" columns at the same hour, one per provider).
                const label = s.providerName ? `${name} · ${s.providerName}` : name
                const timeRange = `${fmtTime(s.start.toDate())}${s.end ? ` – ${fmtTime(s.end.toDate())}` : ''}`
                // Narrow parallel columns truncate hard — the tooltip carries it all.
                const tooltip = [label, timeRange, s.location].filter(Boolean).join(' · ')
                // Already-run sessions stay on the grid (timetable) but muted.
                const ended = (s.end ?? s.start).toDate().getTime() < now.getTime()
                const inner = (
                  <>
                    <p className="truncate text-[11px] font-medium leading-tight">{label}</p>
                    {height >= 34 && (
                      <p className="truncate text-[10px] text-muted-foreground">{timeRange}</p>
                    )}
                    {height >= 52 && s.location && (
                      <p className="truncate text-[10px] text-muted-foreground">{s.location}</p>
                    )}
                  </>
                )
                const cls = `absolute z-[5] overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left${ended ? ' opacity-45' : ''}`
                if (onSelect) {
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelect(s)}
                      title={tooltip}
                      className={`${cls} transition-opacity hover:opacity-80`}
                      style={style}
                    >
                      {inner}
                    </button>
                  )
                }
                const href = s.href ?? bookingHref
                return href ? (
                  <a key={s.id} href={href} title={tooltip} className={`${cls} transition-opacity hover:opacity-80`} style={style}>
                    {inner}
                  </a>
                ) : (
                  <div key={s.id} title={tooltip} className={cls} style={style}>
                    {inner}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
