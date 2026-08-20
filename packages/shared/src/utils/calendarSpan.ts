// ─── Multi-day items on a day grid ───────────────────────────────────────────
//
// A calendar bucket is a DAY; a session or an event is an INTERVAL. Everything
// here is the translation between the two, and it exists because both calendars
// in this app got that translation wrong in the same way: they indexed each item
// by the day of its `start` alone, so a four-day camp drew a box on day one and
// nothing on days two, three and four, and a class running 22:00→01:00 was
// silently redrawn as a flat sixty minutes.
//
// The second half of that bug is the subtle one. Both grids carried a
// `sameDay(end, start)` test that DISCARDED an end time on another day and
// substituted `start + 60min`. It reads as a guard and behaves as data loss: no
// error, no empty state, just a block of confidently wrong length.
//
// ONE OWNER, imported by both grids — the admin week grid
// (`apps/web/.../sessions/SessionsCalendar.tsx`) and the public planner
// (`apps/web/.../components/schedule/WeeklyCalendar.tsx`). The two had
// hand-ported copies of the clamp; fixing one and not the other is how they
// drifted in the first place.
//
// IT LIVES IN `shared`, THOUGH ONLY THE WEB APP USES IT, for one reason: this is
// date arithmetic with edge cases that fail silently (an end at exactly
// midnight, an end before its start, a corrupt far-future end), and `apps/web`
// has no test runner. Here it is exercised by
// `packages/functions/src/sessions/calendarSpan.test.ts`, the same arrangement
// `matchesFilter` uses. Nothing about it is server-side; it is here to be
// testable.

/** The bucket key for a day. Local-time parts, never a UTC ISO slice — the grid
 *  is drawn in the reader's timezone and an ISO date would put a 00:30 session
 *  on the previous day for anyone west of UTC. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** Minutes from local midnight. */
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

const MINUTES_PER_DAY = 1440

/**
 * A hard stop on how many days one item may occupy.
 *
 * Not a product limit — a corruption guard. `end` is client-supplied data, and a
 * single bad document with an end date in 2087 would otherwise expand into tens
 * of thousands of map entries and hang the tab. A year is far past any real camp,
 * and an item that hits this cap still renders (truncated) rather than taking the
 * calendar down.
 */
export const MAX_SPAN_DAYS = 366

export interface DaySpan {
  /** The day this slice falls on. */
  day: Date
  key: string
  /** Minutes from midnight the item occupies ON THIS DAY. */
  startMin: number
  endMin: number
  /** Does the item begin on this day? False on a continuation. */
  isFirstDay: boolean
  /** Does it finish on this day? */
  isLastDay: boolean
}

/**
 * Every day an item touches, first day first, with the minutes it occupies on
 * each.
 *
 * A middle day is the full 00:00–24:00; the first day runs from its start time
 * to midnight, the last from midnight to its end time. A single-day item returns
 * exactly one slice and is the overwhelmingly common case, so it short-circuits.
 *
 * A missing or invalid `end` is treated as a ONE-HOUR item on the start day —
 * the same fallback the grids used, kept because it is a sane default for a
 * document that never recorded a duration. An `end` BEFORE `start` is treated the
 * same way rather than producing a negative span.
 */
export function daySpans(start: Date, end?: Date | null): DaySpan[] {
  const startMin = minutesOfDay(start)
  const startDayKey = dayKey(start)

  const hasUsableEnd = !!end && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()
  if (!hasUsableEnd) {
    return [
      {
        day: start,
        key: startDayKey,
        startMin,
        endMin: Math.min(startMin + 60, MINUTES_PER_DAY),
        isFirstDay: true,
        isLastDay: true,
      },
    ]
  }

  const finish = end as Date
  if (dayKey(finish) === startDayKey) {
    return [
      {
        day: start,
        key: startDayKey,
        startMin,
        endMin: minutesOfDay(finish),
        isFirstDay: true,
        isLastDay: true,
      },
    ]
  }

  // An end at exactly midnight belongs to the day that just ENDED, not to the
  // next one: a 22:00→00:00 class should not put a zero-length sliver on
  // tomorrow's column.
  const endsAtMidnight = minutesOfDay(finish) === 0

  const out: DaySpan[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const lastDay = new Date(finish.getFullYear(), finish.getMonth(), finish.getDate())
  if (endsAtMidnight) lastDay.setDate(lastDay.getDate() - 1)

  while (cursor.getTime() <= lastDay.getTime() && out.length < MAX_SPAN_DAYS) {
    const isFirstDay = out.length === 0
    const isLastDay = dayKey(cursor) === dayKey(lastDay)
    out.push({
      day: new Date(cursor),
      key: dayKey(cursor),
      startMin: isFirstDay ? startMin : 0,
      endMin: isLastDay && !endsAtMidnight ? minutesOfDay(finish) : MINUTES_PER_DAY,
      isFirstDay,
      isLastDay,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return out
}

/**
 * The slice of an item that falls on ONE given day, or null if it does not reach
 * that day. The per-day question, for callers that already know which day they
 * are drawing and do not want the whole span.
 */
export function spanOnDay(start: Date, end: Date | null | undefined, day: Date): DaySpan | null {
  const target = dayKey(day)
  // Cheap rejection before expanding: the overwhelming majority of items on a
  // given week are nowhere near the day being asked about.
  const startsAfter = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  if (startsAfter > dayStart) return null
  return daySpans(start, end).find((s) => s.key === target) ?? null
}
