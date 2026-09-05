// ISO 8601 week keys — the grammar `contact_weekly_reports` / `team_weekly_reports`
// are keyed by, and the arithmetic behind the usage-window keys next door.
//
// ── WHY A DENSIFIER LIVES HERE ─────────────────────────────────────────────
// A weekly report is written only for a contact who ATTENDED that week
// (`weeklyReports` in functions/src/analytics builds its map from session
// participants), so ABSENCE OF A ROW MEANS ZERO ATTENDANCE. That is the right
// storage — the alternative is a row per contact per week forever, which is
// what hmd-lineup did and why its migration carries ~99% empty rows.
//
// But it makes row count meaningless as a measure of time, and both readers of
// these documents took the last N rows and plotted them as the last N weeks. A
// contact who came sixteen times over two years and then stopped rendered as a
// flat, healthy sixteen-week line — the chart could not express a drop-off,
// which is the only thing it exists to show.
//
// So a reader asks for a WINDOW of weeks and fills the gaps with zero. That is
// one rule, and it belongs in one place rather than in each chart.

/** ISO week-year + week number for a calendar date (pure Gregorian math). */
export function isoWeekParts(y: number, m: number, d: number): { year: number; week: number } {
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

/**
 * A date as the key a weekly report is stored under: `2026-W07`.
 *
 * Zero-padded, because these keys are ordered as STRINGS by every query that
 * reads them — `2026-W7` would sort after `2026-W31`.
 *
 * Matches `format(date, "R-'W'II")`, which is what the writer uses.
 */
export function isoWeekKey(date: Date = new Date()): string {
  const { year, week } = isoWeekParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
  return `${year}-W${pad2(week)}`
}

/**
 * The `count` week keys ending at `from`'s week, OLDEST FIRST.
 *
 * Walks back in 7-day steps rather than decrementing a week number, so the
 * 52/53-week years and the year boundary come out right without a special case.
 */
export function isoWeekKeysBack(count: number, from: Date = new Date()): string[] {
  const keys: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)
  for (let i = 0; i < count; i += 1) {
    keys.push(isoWeekKey(cursor))
    cursor.setDate(cursor.getDate() - 7)
  }
  return keys.reverse()
}

/**
 * Sparse stored rows → one entry per week of the window, missing weeks as zero.
 *
 * `rows` may hold weeks outside the window (a caller that over-fetches) and may
 * hold duplicates; the window decides what comes back, and the LAST row for a
 * week wins.
 */
export function densifyWeeklyCounts<T extends { iso_week: string; sessions_count?: number }>(
  rows: readonly T[],
  weeks: number,
  from: Date = new Date()
): Array<{ iso_week: string; sessions_count: number }> {
  const byWeek = new Map<string, number>()
  for (const r of rows) byWeek.set(r.iso_week, r.sessions_count ?? 0)
  return isoWeekKeysBack(weeks, from).map((iso_week) => ({
    iso_week,
    sessions_count: byWeek.get(iso_week) ?? 0,
  }))
}
