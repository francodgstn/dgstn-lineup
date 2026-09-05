// Window keys for subscription usage limits ("3 classes per week") — pure and
// shared so the booking callable, the snapshot loader and any UI agree on what
// "this week" means. Windows are CALENDAR periods in the team's timezone
// (Europe/Zurich for every team today), not rolling: a weekly allowance resets
// Monday 00:00 Zurich time.
//
// Key formats (doc ids under contacts/{id}/usage_windows/{typeId}_{key}):
//   day   → D2026-07-19
//   week  → W2026-29   (ISO 8601 week; the year is the ISO week-year)
//   month → M2026-07

import type { UsageLimitPeriod } from '../types/contact'
import { isoWeekParts } from './isoWeeks'

export const USAGE_TIMEZONE = 'Europe/Zurich'

/** Y/M/D of `date` in the given IANA timezone. */
function zonedYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The window key for a limit period at a moment in time (team timezone). */
export function usageWindowKey(
  per: UsageLimitPeriod,
  at: Date = new Date(),
  timeZone: string = USAGE_TIMEZONE
): string {
  const { y, m, d } = zonedYmd(at, timeZone)
  switch (per) {
    case 'day':
      return `D${y}-${pad2(m)}-${pad2(d)}`
    case 'week': {
      const { year, week } = isoWeekParts(y, m, d)
      return `W${year}-${pad2(week)}`
    }
    case 'month':
      return `M${y}-${pad2(m)}`
  }
}

/** Doc id under contacts/{id}/usage_windows for one type's current window. */
export function usageWindowDocId(
  subscriptionTypeId: string,
  per: UsageLimitPeriod,
  at: Date = new Date(),
  timeZone: string = USAGE_TIMEZONE
): string {
  return `${subscriptionTypeId}_${usageWindowKey(per, at, timeZone)}`
}
