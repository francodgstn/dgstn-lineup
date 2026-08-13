import assert from 'node:assert/strict'
import { bookingHoldsSeat, isExpiredWaitlistClaim } from '@linyup/shared'

// Unit tests for THE capacity predicate (@linyup/shared types/session.ts).
// trackBookings' recount and bookSession's "fully booked" refusal both call it,
// so a disagreement here is either an oversell or a customer locked out of a
// free seat. Pure — no Firestore. Run: pnpm --filter @linyup/functions test

const ts = (ms: number) => ({ toMillis: () => ms }) as never

const now = 1_000_000

describe('bookingHoldsSeat', () => {
  it('an ABSENT status is pending and still holds a seat', () => {
    assert.equal(bookingHoldsSeat({}, now), true)
  })

  it('pending/confirmed hold; cancelled/no_show/rebooked do not', () => {
    assert.equal(bookingHoldsSeat({ status: 'pending' }, now), true)
    assert.equal(bookingHoldsSeat({ status: 'confirmed' }, now), true)
    assert.equal(bookingHoldsSeat({ status: 'cancelled' }, now), false)
    assert.equal(bookingHoldsSeat({ status: 'no_show' }, now), false)
    // 'rebooked' means the seat moved to another session.
    assert.equal(bookingHoldsSeat({ status: 'rebooked' }, now), false)
  })

  it('a LIVE unpaid drop-in hold holds its seat', () => {
    const b = { status: 'pending', payment_status: 'required', expires_at: ts(now + 60_000) }
    assert.equal(bookingHoldsSeat(b, now), true)
  })

  it('a LAPSED unpaid drop-in hold releases its seat (the stale-full bug)', () => {
    const b = { status: 'pending', payment_status: 'required', expires_at: ts(now - 1) }
    assert.equal(bookingHoldsSeat(b, now), false)
  })

  it('a PAID booking holds its seat regardless of expires_at', () => {
    const b = { status: 'confirmed', payment_status: 'paid', expires_at: ts(now - 60_000) }
    assert.equal(bookingHoldsSeat(b, now), true)
  })

  it('expires_at without payment_status: required is not a hold', () => {
    assert.equal(bookingHoldsSeat({ status: 'pending', expires_at: ts(now - 1) }, now), true)
  })

  it('a lapsed waitlist claim releases its seat', () => {
    const live = { waitlist_claim: true, claim_expires_at: ts(now + 1) }
    const lapsed = { waitlist_claim: true, claim_expires_at: ts(now) }
    assert.equal(bookingHoldsSeat(live, now), true)
    assert.equal(bookingHoldsSeat(lapsed, now), false)
  })
})

describe('isExpiredWaitlistClaim', () => {
  it('inert on today’s bookings — no waitlist_claim field', () => {
    assert.equal(isExpiredWaitlistClaim({}, now), false)
    assert.equal(isExpiredWaitlistClaim({ claim_expires_at: ts(now - 1) }, now), false)
  })

  it('needs BOTH the flag and a passed deadline', () => {
    assert.equal(isExpiredWaitlistClaim({ waitlist_claim: true }, now), false)
    assert.equal(isExpiredWaitlistClaim({ waitlist_claim: true, claim_expires_at: ts(now + 1) }, now), false)
    assert.equal(isExpiredWaitlistClaim({ waitlist_claim: true, claim_expires_at: ts(now) }, now), true)
  })
})
