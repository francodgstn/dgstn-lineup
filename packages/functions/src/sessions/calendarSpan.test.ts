import assert from 'node:assert/strict'
import { daySpans, spanOnDay, dayKey, MAX_SPAN_DAYS } from '@linyup/shared'

// The interval→days translation behind both week grids.
//
// Every case here is one the two calendars got wrong before this module existed,
// or one where getting it wrong would be invisible. The failure mode throughout
// is silence: a wrong answer draws a plausible box, and nobody reports a class
// that is the wrong length — they just stop trusting the calendar.
//
// Local-time construction throughout (`new Date(y, m, d, h, min)`), because the
// grid buckets by local day and that is exactly what the keys must reflect.

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min)

describe('daySpans', () => {
  it('returns ONE slice for an ordinary same-day session', () => {
    const spans = daySpans(at(2026, 7, 19, 9, 0), at(2026, 7, 19, 10, 30))
    assert.equal(spans.length, 1)
    assert.deepEqual(
      { s: spans[0].startMin, e: spans[0].endMin },
      { s: 9 * 60, e: 10 * 60 + 30 }
    )
    assert.equal(spans[0].isFirstDay, true)
    assert.equal(spans[0].isLastDay, true)
  })

  it('splits a class that crosses midnight, instead of flattening it to an hour', () => {
    // THE ORIGINAL BUG. `sameDay(end, start)` was false, so both grids drew a
    // flat 60-minute block and lost two of the three hours.
    const spans = daySpans(at(2026, 7, 19, 22, 0), at(2026, 7, 20, 1, 0))
    assert.equal(spans.length, 2)
    assert.deepEqual({ s: spans[0].startMin, e: spans[0].endMin }, { s: 22 * 60, e: 1440 })
    assert.deepEqual({ s: spans[1].startMin, e: spans[1].endMin }, { s: 0, e: 60 })
    assert.deepEqual(
      spans.map((x) => [x.isFirstDay, x.isLastDay]),
      [
        [true, false],
        [false, true],
      ]
    )
  })

  it('covers every day of a multi-day camp, middle days running midnight to midnight', () => {
    const spans = daySpans(at(2026, 7, 19, 9, 0), at(2026, 7, 22, 17, 0))
    assert.equal(spans.length, 4)
    assert.deepEqual(
      spans.map((s) => s.key),
      [at(2026, 7, 19), at(2026, 7, 20), at(2026, 7, 21), at(2026, 7, 22)].map(dayKey)
    )
    assert.deepEqual({ s: spans[1].startMin, e: spans[1].endMin }, { s: 0, e: 1440 })
    assert.deepEqual({ s: spans[3].startMin, e: spans[3].endMin }, { s: 0, e: 17 * 60 })
  })

  it('gives an end at exactly midnight to the day that just ENDED', () => {
    // A 22:00→00:00 class must not leave a zero-length sliver on tomorrow's
    // column — which is what a naive "iterate to the end date" loop produces,
    // and it renders as a stray mark nobody can explain.
    const spans = daySpans(at(2026, 7, 19, 22, 0), at(2026, 7, 20, 0, 0))
    assert.equal(spans.length, 1)
    assert.equal(spans[0].key, dayKey(at(2026, 7, 19)))
    assert.deepEqual({ s: spans[0].startMin, e: spans[0].endMin }, { s: 22 * 60, e: 1440 })
  })

  it('falls back to one hour when the end is missing', () => {
    const spans = daySpans(at(2026, 7, 19, 9, 0), null)
    assert.equal(spans.length, 1)
    assert.deepEqual({ s: spans[0].startMin, e: spans[0].endMin }, { s: 540, e: 600 })
  })

  it('falls back rather than producing a negative span when end precedes start', () => {
    const spans = daySpans(at(2026, 7, 19, 9, 0), at(2026, 7, 18, 9, 0))
    assert.equal(spans.length, 1)
    assert.ok(spans[0].endMin > spans[0].startMin)
  })

  it('does not run past midnight on the fallback for a late-evening start', () => {
    // 23:30 + 1h would be 24:30. Clamped, or the block overflows the grid.
    const spans = daySpans(at(2026, 7, 19, 23, 30), null)
    assert.equal(spans[0].endMin, 1440)
  })

  it('caps a corrupt far-future end instead of expanding forever', () => {
    // Not a product limit — a guard. Without it one bad document hangs the tab.
    const spans = daySpans(at(2026, 7, 19, 9, 0), at(2087, 0, 1, 9, 0))
    assert.equal(spans.length, MAX_SPAN_DAYS)
  })

  it('crosses a month and a year boundary', () => {
    const spans = daySpans(at(2026, 11, 30, 18, 0), at(2027, 0, 2, 12, 0))
    assert.deepEqual(
      spans.map((s) => s.key),
      [at(2026, 11, 30), at(2026, 11, 31), at(2027, 0, 1), at(2027, 0, 2)].map(dayKey)
    )
  })
})

describe('spanOnDay', () => {
  const start = at(2026, 7, 19, 9, 0)
  const end = at(2026, 7, 22, 17, 0)

  it('answers for a middle day of a span', () => {
    const s = spanOnDay(start, end, at(2026, 7, 21))
    assert.ok(s)
    assert.deepEqual({ s: s!.startMin, e: s!.endMin }, { s: 0, e: 1440 })
    assert.equal(s!.isFirstDay, false)
    assert.equal(s!.isLastDay, false)
  })

  it('returns null for a day before the item starts', () => {
    assert.equal(spanOnDay(start, end, at(2026, 7, 18)), null)
  })

  it('returns null for a day after the item ends', () => {
    assert.equal(spanOnDay(start, end, at(2026, 7, 23)), null)
  })

  it('marks the first and last days as such', () => {
    assert.equal(spanOnDay(start, end, at(2026, 7, 19))!.isFirstDay, true)
    assert.equal(spanOnDay(start, end, at(2026, 7, 22))!.isLastDay, true)
  })
})
