export function transformSessionSeries(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }
  const rec = src.recurrence as Record<string, unknown> | undefined
  if (rec) {
    out.recurrence = {
      ...rec,
      daysOfWeek: rec.days_of_week   ?? rec.daysOfWeek,
      time:       rec.start_time     ?? rec.time,
      duration:   rec.duration_minutes ?? rec.duration,
      endDate:    rec.end_date       ?? rec.endDate,
      frequency:  rec.frequency,
    }
    // Remove old snake_case keys
    const r = out.recurrence as Record<string, unknown>
    delete r.days_of_week
    delete r.start_time
    delete r.duration_minutes
    delete r.end_date
  }
  return out
}
