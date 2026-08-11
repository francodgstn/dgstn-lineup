import assert from 'node:assert/strict'
import { browseDurationMinutes, mergeAvailabilitySlots } from '@linyup/shared'

// Collapsing listAvailability's discrete starts into browsable windows for the
// website schedule. Run with: pnpm --filter @linyup/functions test

const H = 60 * 60_000
const at = (hour: number, minute = 0) => Date.UTC(2026, 7, 12, hour, minute)

describe('mergeAvailabilitySlots', () => {
  it('merges a run of back-to-back starts into one window', () => {
    // 09:00, 09:30, 10:00 at 30 min → one 09:00–10:30 window.
    const windows = mergeAvailabilitySlots([at(9), at(9, 30), at(10)], 30)
    assert.deepEqual(windows, [{ startMs: at(9), endMs: at(10, 30) }])
  })

  it('splits on a gap — a booked appointment must not be shown as free', () => {
    // 09:00, 09:30, [11:00 booked away], 12:00
    const windows = mergeAvailabilitySlots([at(9), at(9, 30), at(12)], 30)
    assert.deepEqual(windows, [
      { startMs: at(9), endMs: at(10) },
      { startMs: at(12), endMs: at(12, 30) },
    ])
  })

  it('is order- and duplicate-insensitive', () => {
    const windows = mergeAvailabilitySlots([at(10), at(9), at(9, 30), at(9)], 30)
    assert.deepEqual(windows, [{ startMs: at(9), endMs: at(10, 30) }])
  })

  it('a lone start is a window one slot long', () => {
    assert.deepEqual(mergeAvailabilitySlots([at(14)], 60), [{ startMs: at(14), endMs: at(15) }])
  })

  it('spans a full working day as ONE window, not sixteen', () => {
    const starts: number[] = []
    for (let m = 0; m < 8 * 60; m += 30) starts.push(at(9) + m * 60_000)
    const windows = mergeAvailabilitySlots(starts, 30)
    assert.equal(windows.length, 1)
    assert.equal(windows[0].startMs, at(9))
    assert.equal(windows[0].endMs, at(9) + 8 * H)
  })

  it('returns nothing for empty or nonsensical input', () => {
    assert.deepEqual(mergeAvailabilitySlots([], 30), [])
    assert.deepEqual(mergeAvailabilitySlots([at(9)], 0), [])
    assert.deepEqual(mergeAvailabilitySlots([at(9)], -30), [])
    assert.deepEqual(mergeAvailabilitySlots([NaN], 30), [])
  })
})

describe('browseDurationMinutes', () => {
  it('picks the shortest offered length — the widest merged window', () => {
    assert.equal(browseDurationMinutes([{ minutes: 60 }, { minutes: 30 }, { minutes: 90 }]), 30)
  })

  it('is null when there is nothing to browse by', () => {
    assert.equal(browseDurationMinutes([]), null)
    assert.equal(browseDurationMinutes(undefined), null)
    assert.equal(browseDurationMinutes([{ minutes: 0 }]), null)
  })
})
