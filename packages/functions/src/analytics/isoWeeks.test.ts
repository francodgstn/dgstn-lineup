import assert from 'node:assert/strict'
import { densifyWeeklyCounts, isoWeekKey, isoWeekKeysBack } from '@linyup/shared'

// The weekly-report week grammar and the densifier every reader of
// `contact_weekly_reports` goes through.
//
// The bug these pin: the readers used to take the last N STORED ROWS and plot
// them as the last N weeks. `weeklyReports` only writes a row for a contact who
// attended, so a contact who came sixteen times across two years and then
// stopped rendered as a flat, healthy sixteen-week line — a chart that could not
// express the one thing it exists to show.
//
// Run with: pnpm --filter @linyup/functions test

describe('isoWeekKey', () => {
  it('zero-pads the week, because these keys are ordered as strings', () => {
    // 2026-01-08 is a Thursday in ISO week 2.
    assert.equal(isoWeekKey(new Date(2026, 0, 8)), '2026-W02')
    // Unpadded, '2026-W2' would sort AFTER '2026-W31' and every range query on
    // the field would silently return the wrong window.
    assert.ok('2026-W02' < '2026-W31')
  })

  it('uses the ISO week-YEAR, not the calendar year', () => {
    // 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026.
    assert.equal(isoWeekKey(new Date(2027, 0, 1)), '2026-W53')
    // …and 2026-12-31 (a Thursday) is in that same ISO week.
    assert.equal(isoWeekKey(new Date(2026, 11, 31)), '2026-W53')
  })

  it('agrees with itself across every day of one week', () => {
    // Mon 2026-08-31 … Sun 2026-09-06 are all ISO week 36.
    const keys = new Set<string>()
    for (let d = 31; d <= 31 + 6; d += 1) keys.add(isoWeekKey(new Date(2026, 7, d)))
    assert.deepEqual([...keys], ['2026-W36'])
  })
})

describe('isoWeekKeysBack', () => {
  it('returns `count` keys, oldest first, ending at the given week', () => {
    const keys = isoWeekKeysBack(4, new Date(2026, 8, 5)) // ISO week 36
    assert.deepEqual(keys, ['2026-W33', '2026-W34', '2026-W35', '2026-W36'])
  })

  it('crosses the year boundary without a special case', () => {
    // Walking back from ISO week 2 of 2027 passes through 2026's week 53 — the
    // reason this steps by 7 days instead of decrementing a week number.
    // 2027-01-04 is a Monday, so ISO week 1 of 2027 is Jan 4–10 and 2027-01-01
    // (a Friday) still belongs to 2026's week 53.
    const keys = isoWeekKeysBack(4, new Date(2027, 0, 15))
    assert.deepEqual(keys, ['2026-W52', '2026-W53', '2027-W01', '2027-W02'])
  })
})

describe('densifyWeeklyCounts', () => {
  const from = new Date(2026, 8, 5) // ISO week 36

  it('fills a week with no stored row with zero', () => {
    const out = densifyWeeklyCounts([{ iso_week: '2026-W34', sessions_count: 3 }], 4, from)
    assert.deepEqual(out, [
      { iso_week: '2026-W33', sessions_count: 0 },
      { iso_week: '2026-W34', sessions_count: 3 },
      { iso_week: '2026-W35', sessions_count: 0 },
      { iso_week: '2026-W36', sessions_count: 0 },
    ])
  })

  it('SHOWS A DROP-OFF — the case the old reader could not express', () => {
    // Two attended weeks, long ago. The old reader took "the last N rows" and
    // drew a flat line of 3s; there must now be visible zeros after them.
    const rows = [
      { iso_week: '2026-W33', sessions_count: 3 },
      { iso_week: '2026-W34', sessions_count: 3 },
    ]
    const out = densifyWeeklyCounts(rows, 4, from)
    assert.deepEqual(
      out.map((r) => r.sessions_count),
      [3, 3, 0, 0]
    )
  })

  it('returns exactly `weeks` entries however many rows it was given', () => {
    const many = isoWeekKeysBack(52, from).map((iso_week) => ({ iso_week, sessions_count: 1 }))
    assert.equal(densifyWeeklyCounts(many, 4, from).length, 4)
    assert.equal(densifyWeeklyCounts([], 4, from).length, 4)
  })

  it('ignores rows outside the window rather than shifting the axis', () => {
    // An over-fetching caller must not be able to move which weeks are shown.
    const out = densifyWeeklyCounts(
      [
        { iso_week: '2020-W01', sessions_count: 9 },
        { iso_week: '2026-W36', sessions_count: 2 },
      ],
      3,
      from
    )
    assert.deepEqual(out, [
      { iso_week: '2026-W34', sessions_count: 0 },
      { iso_week: '2026-W35', sessions_count: 0 },
      { iso_week: '2026-W36', sessions_count: 2 },
    ])
  })

  it('treats a missing sessions_count as zero', () => {
    // Migrated hmd-lineup rows are dense and some carry no count at all; a
    // stored zero, an absent count and an absent row are ONE fact.
    const out = densifyWeeklyCounts([{ iso_week: '2026-W36' }], 1, from)
    assert.deepEqual(out, [{ iso_week: '2026-W36', sessions_count: 0 }])
  })
})
