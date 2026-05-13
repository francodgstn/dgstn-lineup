import { subWeeks, parse, format } from 'date-fns'

export function dateToIsoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`
}

export function isoWeekToDate(isoWeek: string): Date {
  return parse(isoWeek, "RRRR-'W'II", new Date())
}

export function buildWeekKeys(weeks: number, offset = 0): string[] {
  const keys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    keys.push(dateToIsoWeek(subWeeks(new Date(), i + offset)))
  }
  return keys
}

export function shortWeekLabel(isoWeek: string, prevIsoWeek?: string): string {
  try {
    const d = isoWeekToDate(isoWeek)
    const prevD = prevIsoWeek ? isoWeekToDate(prevIsoWeek) : null
    const showYear = !prevD || d.getFullYear() !== prevD.getFullYear()
    return showYear ? format(d, "'W'II ''yy") : format(d, "'W'II")
  } catch {
    return isoWeek
  }
}

export function formatTooltipWeek(isoWeek: string): string {
  try {
    return format(isoWeekToDate(isoWeek), "'Week of' MMM d, yyyy")
  } catch {
    return isoWeek
  }
}

export function formatAxisWeek(isoWeek: string): string {
  try {
    return format(isoWeekToDate(isoWeek), "'W'II")
  } catch {
    return isoWeek
  }
}
