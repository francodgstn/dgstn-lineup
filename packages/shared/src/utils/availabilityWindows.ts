// ─── Availability slots → browsable windows ───────────────────────────────────
//
// `listAvailability` returns DISCRETE bookable start times (a coach free 09:00–
// 17:00 is ~16 starts a day, per duration, per coach). That's the right shape for
// the picker, where the visitor chooses an exact time — and the wrong shape for a
// website schedule, where every one of those starts would bury the classes.
//
// This collapses consecutive starts back into the contiguous windows a person
// actually thinks in ("Anna, Monday morning"). Deliberately merged from the
// DERIVED slots rather than read from the authored availability docs: the derived
// set already has busy sessions and buffers removed, so a merged window is time
// that is genuinely free — not merely time the studio published.

/** A contiguous stretch of genuinely-free time, merged from bookable starts. */
export interface AvailabilitySpan {
  startMs: number
  endMs: number
}

/**
 * Collapse bookable start times into contiguous windows.
 *
 * Two starts belong to the same window when the next one begins no later than
 * the previous one ends, so a gap (a booked appointment, a buffer) correctly
 * splits the day into separate windows.
 *
 * @param startsMs   bookable start times, any order, duplicates tolerated
 * @param durationMinutes  the slot length these starts were generated for
 */
export function mergeAvailabilitySlots(
  startsMs: readonly number[],
  durationMinutes: number
): AvailabilitySpan[] {
  if (startsMs.length === 0 || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return []
  const step = durationMinutes * 60_000
  const sorted = [...new Set(startsMs)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (sorted.length === 0) return []

  const windows: AvailabilitySpan[] = []
  let startMs = sorted[0]
  let endMs = sorted[0] + step
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    if (next <= endMs) {
      // Contiguous (or overlapping, if several durations ever feed in).
      endMs = Math.max(endMs, next + step)
    } else {
      windows.push({ startMs, endMs })
      startMs = next
      endMs = next + step
    }
  }
  windows.push({ startMs, endMs })
  return windows
}

/**
 * The slot length to browse an activity by: the SHORTEST it offers.
 *
 * Shortest gives the most granular starts and therefore the widest merged
 * window — "when could I come at all", which is the question a website visitor
 * is asking. Picking the exact length is the picker's job.
 */
export function browseDurationMinutes(
  durations: readonly { minutes: number }[] | undefined
): number | null {
  const valid = (durations ?? []).map((d) => d.minutes).filter((m) => Number.isFinite(m) && m > 0)
  return valid.length ? Math.min(...valid) : null
}
