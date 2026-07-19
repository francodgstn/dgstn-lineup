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

/** ISO week-year + week number for a calendar date (pure Gregorian math). */
function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  // UTC-noon avoids DST edges in the arithmetic below.
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  const dayOfWeek = date.getUTCDay() || 7 // Mon=1 … Sun=7
  // Shift to the Thursday of this ISO week — its year IS the ISO week-year.
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek)
  const weekYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(weekYear, 0, 1, 12))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { year: weekYear, week }
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
      const { year, week } = isoWeek(y, m, d)
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
