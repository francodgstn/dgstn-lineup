// ─── Contact alerts — ONE shape reader, ONE fired predicate ──────────────────
//
// Before this file there were THREE predicates deciding whether an alert had
// fired, and they disagreed:
//
//   • `AlertsTab`     (web) — total_sessions >= value; date <= now
//   • `AlertsGlance`  (web) — byte-identical, duplicated 300 lines away, with a
//                             comment saying a third reader "wants to become a
//                             shared helper"
//   • the mobile app        — `value <= 1`, reading the SAME number as "sessions
//                             REMAINING" and never looking at total_sessions,
//                             plus a ±7-day window around a date alert
//
// The third reader had already appeared, in another app, and diverged. This is
// that shared helper. The mobile window is deliberately NOT preserved: it hid
// alerts a week after they fired and showed them a week before, which is not
// what a trigger means. Dismissal is `archived_at`, not the passage of time.
//
// ─── TWO DOCUMENT SHAPES, and both are live ──────────────────────────────────
//
// The studio UI and the HMD migration write a FLAT pair:
//     { schedule_type: 'datetime', schedule_value: <Timestamp> }
// `bookSession` and the automation engine write a NESTED map:
//     { schedule: { type: 'datetime', value: <Timestamp> } }
//
// The web page carried a private `normaliseAlert` for this; the mobile app read
// the nested shape ONLY, with a `|| 'datetime'` fallback — so a studio-authored
// alert reached it as `datetime` with an undefined value, became an Invalid
// Date, compared false against everything, and never appeared. "Show in member
// app" has therefore never worked for a hand-written alert. `readAlert()` is
// the one reader that understands both; nothing downstream should ever touch
// `schedule_value` or `schedule` directly.

import type { Timestamp } from '../types/common'
import type { AlertScheduleType, ContactAlert } from '../types/contact'

/** Anything Firestore may hand back for an alert, in either shape. */
export interface RawContactAlert {
  id?: string
  schedule_type?: AlertScheduleType | string | null
  schedule_value?: number | Timestamp | null
  schedule?: { type?: AlertScheduleType | string | null; value?: number | Timestamp | null } | null
  message?: string | null
  show_in_app?: boolean | null
  archived_at?: Timestamp | null
  created_at?: Timestamp
}

/** The schedule, narrowed — exactly one of `sessions` / `at` is meaningful. */
export interface AlertSchedule {
  type: AlertScheduleType
  /** `sessions_countdown` only: the total-session count that fires it. */
  sessions: number | null
  /** `datetime` only: the instant that fires it. */
  at: Date | null
}

const SCHEDULE_TYPES: readonly AlertScheduleType[] = ['sessions_countdown', 'datetime', 'always']

function isScheduleType(v: unknown): v is AlertScheduleType {
  return typeof v === 'string' && (SCHEDULE_TYPES as readonly string[]).includes(v)
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'object' && typeof (v as Timestamp).toDate === 'function') {
    const d = (v as Timestamp).toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }
  return null
}

/**
 * Narrow either document shape into one schedule.
 *
 * An unrecognised or absent type falls back to `sessions_countdown`, NOT to
 * `datetime`: a countdown with no value is simply never fired, whereas the old
 * mobile `|| 'datetime'` fallback produced an Invalid Date whose comparisons
 * were all false — the same outcome, reached by an accident that also crashed
 * the web reader. Failing to a kind that cannot fire is the honest version.
 */
export function alertSchedule(raw: RawContactAlert): AlertSchedule {
  const rawType = raw.schedule_type ?? raw.schedule?.type
  const type: AlertScheduleType = isScheduleType(rawType) ? rawType : 'sessions_countdown'
  const value = raw.schedule_value ?? raw.schedule?.value ?? null

  if (type === 'always') return { type, sessions: null, at: null }
  if (type === 'datetime') return { type, sessions: null, at: toDate(value) }
  return { type, sessions: typeof value === 'number' ? value : null, at: null }
}

/** Both shapes in, one canonical flat `ContactAlert` out. */
export function readAlert(id: string, raw: RawContactAlert): ContactAlert {
  const schedule = alertSchedule(raw)
  return {
    id,
    schedule_type: schedule.type,
    schedule_value: raw.schedule_value ?? raw.schedule?.value ?? null,
    message: raw.message ?? '',
    show_in_app: raw.show_in_app ?? false,
    archived_at: raw.archived_at ?? null,
    created_at: raw.created_at,
  }
}

export interface AlertFiredContext {
  /** `Contact.total_sessions`. Absent counts as 0. */
  totalSessions?: number | null
  /** Injectable for tests; defaults to now. */
  now?: Date
}

/**
 * Has this alert's trigger passed? THE only implementation.
 *
 * Says nothing about whether it was dismissed — see `alertIsActive`.
 */
export function alertIsFired(raw: RawContactAlert, ctx: AlertFiredContext = {}): boolean {
  const schedule = alertSchedule(raw)
  switch (schedule.type) {
    case 'always':
      return true
    case 'datetime':
      return schedule.at !== null && schedule.at.getTime() <= (ctx.now ?? new Date()).getTime()
    case 'sessions_countdown':
      return schedule.sessions !== null && (ctx.totalSessions ?? 0) >= schedule.sessions
  }
}

/**
 * Fired AND not dismissed — what a display surface actually wants to know.
 *
 * `alerts_count` deliberately does NOT use this: it counts alerts that EXIST
 * (non-archived), which is why a badge lights up for an alert scheduled a year
 * out. Making that number mean "fired" needs a sweep to re-evaluate date alerts
 * with no write, which does not exist yet.
 */
export function alertIsActive(raw: RawContactAlert, ctx: AlertFiredContext = {}): boolean {
  return !raw.archived_at && alertIsFired(raw, ctx)
}
