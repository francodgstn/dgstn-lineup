import assert from 'node:assert/strict'
import { isStepDue, isWithinSmsSendingHours } from './sendBookingReminders'
import { resolveBookingReminderSteps } from '@linyup/shared'

describe('isStepDue (reminder step window)', () => {
  it('fires inside the (offset−24h, offset] window', () => {
    assert.equal(isStepDue(24, 24), true)
    assert.equal(isStepDue(24, 12), true)
    assert.equal(isStepDue(24, 0.5), true)
    assert.equal(isStepDue(168, 168), true)
    assert.equal(isStepDue(168, 145), true)
  })

  it('does not fire before the offset', () => {
    assert.equal(isStepDue(24, 25), false)
    assert.equal(isStepDue(48, 48.5), false)
    assert.equal(isStepDue(168, 169), false)
  })

  it('does not fire past the catch-up window', () => {
    assert.equal(isStepDue(168, 144), false) // 24h catch-up exhausted
    assert.equal(isStepDue(48, 24), false)
  })

  it('never fires for sessions already started', () => {
    assert.equal(isStepDue(24, 0), false)
    assert.equal(isStepDue(24, -2), false)
  })

  it('steps are disjoint for the swimli schedule (168/48/24)', () => {
    // At any hours-until value, at most one email step matches, and the SMS
    // step overlaps only the last 24h (by design — different channel).
    for (let h = 1; h <= 200; h += 1) {
      const email = [168, 48].filter((o) => isStepDue(o, h))
      assert.ok(email.length <= 1, `overlap at h=${h}`)
    }
  })
})

describe('isWithinSmsSendingHours (quiet hours, Europe/Zurich)', () => {
  it('allows daytime sends', () => {
    // 12:00 UTC = 14:00 Zurich (summer) — inside 08:00–21:00.
    assert.equal(isWithinSmsSendingHours(new Date('2026-07-08T12:00:00Z')), true)
  })

  it('blocks night sends', () => {
    // 01:00 UTC = 03:00 Zurich (summer).
    assert.equal(isWithinSmsSendingHours(new Date('2026-07-08T01:00:00Z')), false)
    // 20:00 UTC = 22:00 Zurich (summer).
    assert.equal(isWithinSmsSendingHours(new Date('2026-07-08T20:00:00Z')), false)
  })
})

describe('resolveBookingReminderSteps', () => {
  it('returns authored steps verbatim', () => {
    const steps = [
      { id: 'a', channel: 'email' as const, offsetHours: 168 },
      { id: 'b', channel: 'sms' as const, offsetHours: 24 },
    ]
    assert.deepEqual(resolveBookingReminderSteps({ bookingReminderSteps: steps }), steps)
  })

  it('synthesizes the legacy single email from bookingReminderHours', () => {
    assert.deepEqual(resolveBookingReminderSteps({ bookingReminderHours: 48 }), [
      { id: 'legacy', channel: 'email', offsetHours: 48 },
    ])
  })

  it('defaults to a 24h email when nothing is configured', () => {
    assert.deepEqual(resolveBookingReminderSteps({}), [
      { id: 'legacy', channel: 'email', offsetHours: 24 },
    ])
  })
})
