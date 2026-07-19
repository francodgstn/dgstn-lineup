import assert from 'node:assert/strict'
import { usageWindowDocId, usageWindowKey } from '@linyup/shared'

// Unit tests for the usage-limit window keys (Phase D). Windows are calendar
// periods in Europe/Zurich — the booking callable, snapshot loader and UI all
// derive "this week" from these helpers, never independently.
// Run with: pnpm --filter @linyup/functions test

describe('usageWindowKey', () => {
  it('day / month keys follow the Zurich calendar date', () => {
    // 2026-07-19T10:00Z = 12:00 in Zurich (CEST) — same calendar day.
    const at = new Date('2026-07-19T10:00:00Z')
    assert.equal(usageWindowKey('day', at), 'D2026-07-19')
    assert.equal(usageWindowKey('month', at), 'M2026-07')
  })

  it('a UTC evening that is already TOMORROW in Zurich rolls the day window', () => {
    // 23:30Z on the 19th = 01:30 CEST on the 20th.
    const at = new Date('2026-07-19T23:30:00Z')
    assert.equal(usageWindowKey('day', at), 'D2026-07-20')
  })

  it('ISO week keys: mid-year, plus the year-boundary week-53 case', () => {
    // 2026-07-19 is a Sunday in ISO week 29.
    assert.equal(usageWindowKey('week', new Date('2026-07-19T10:00:00Z')), 'W2026-29')
    // 2027-01-01 is a Friday belonging to ISO week 53 of 2026.
    assert.equal(usageWindowKey('week', new Date('2027-01-01T12:00:00Z')), 'W2026-53')
    // 2024-12-30 (Monday) belongs to ISO week 1 of 2025.
    assert.equal(usageWindowKey('week', new Date('2024-12-30T12:00:00Z')), 'W2025-01')
  })

  it('weeks reset on MONDAY Zurich time, not Sunday', () => {
    // Sunday 23:30 CEST (21:30Z) is still the old week; Monday 00:30 CEST is the new one.
    assert.equal(usageWindowKey('week', new Date('2026-07-19T21:30:00Z')), 'W2026-29')
    assert.equal(usageWindowKey('week', new Date('2026-07-19T22:30:00Z')), 'W2026-30')
  })

  it('usageWindowDocId prefixes the type id', () => {
    assert.equal(
      usageWindowDocId('sub-starter', 'week', new Date('2026-07-19T10:00:00Z')),
      'sub-starter_W2026-29'
    )
  })
})
