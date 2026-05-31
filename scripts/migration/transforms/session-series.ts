export function transformSessionSeries(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }
  const rec = src.recurrence as Record<string, unknown> | undefined
  if (rec) {
    const mapped: Record<string, unknown> = { ...rec }

    // Rename snake_case keys to camelCase, preferring the new name if both exist
    const renames: Array<[string, string]> = [
      ['days_of_week',      'daysOfWeek'],
      ['start_time',        'time'],
      ['duration_minutes',  'duration'],
      ['end_date',          'endDate'],
    ]
    for (const [oldKey, newKey] of renames) {
      const value = rec[oldKey] ?? rec[newKey]
      if (value !== undefined) mapped[newKey] = value
      delete mapped[oldKey]
    }

    out.recurrence = mapped
  }
  return out
}
