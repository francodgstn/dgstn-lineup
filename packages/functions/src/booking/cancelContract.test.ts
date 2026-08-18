import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseBookingCancelRefusal, type BookingCancelRefusal } from '@linyup/shared'

// The cancellation CONTRACT: what `cancelBooking` tells its three public
// surfaces (the emailed manage-booking page, the emailed appointment-cancel
// page, the member portal's list) about a refusal.
//
// The defect these pin: every refusal that callable gives is PERMANENT, and the
// surfaces showed one generic sentence ending "Please try again" for all of
// them. A retry prompt on a final answer teaches a member that the button is
// broken. So the rule is: a refusal carries `details.reason`, the surfaces
// print that reason's sentence and withdraw the button; ONLY a failure with no
// reason (a network drop, an internal error) may invite a second press.
//
// Which makes an untagged refusal a silent regression — it renders as "try
// again" against a wall. The source scan below is what stops one being added.

const CANCEL_SOURCE = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8')

/** The body of `cancelBooking`, up to the next top-level export. */
function cancelBookingBody(): string {
  const start = CANCEL_SOURCE.indexOf('export const cancelBooking = onCall')
  assert.ok(start > 0, 'cancelBooking not found in booking/index.ts')
  const end = CANCEL_SOURCE.indexOf('export const getBookingDetails', start)
  assert.ok(end > start, 'getBookingDetails not found after cancelBooking')
  return CANCEL_SOURCE.slice(start, end)
}

const KNOWN: BookingCancelRefusal[] = ['not_found', 'session_gone', 'already_settled', 'past']

describe('cancelBooking refusal contract', () => {
  it('every refusal it throws carries a reason the surfaces can render', () => {
    const body = cancelBookingBody()
    const reasons = [...body.matchAll(/cancelRefused\(\s*'[^']+',\s*'([^']+)'/g)].map((m) => m[1])
    assert.ok(reasons.length >= 4, `expected the tagged refusals, found ${reasons.length}`)
    for (const reason of reasons) {
      assert.ok(
        (KNOWN as string[]).includes(reason),
        `'${reason}' is not a BookingCancelRefusal — the surfaces have no sentence for it`
      )
    }
  })

  it('throws no UNTAGGED refusal — an untagged one renders as "try again"', () => {
    const body = cancelBookingBody()
    // `invalid-argument` is the one exception, and it is unreachable from the
    // surfaces: all three refuse to call without a token.
    const untagged = [...body.matchAll(/new HttpsError\(\s*'([a-z-]+)'/g)]
      .map((m) => m[1])
      .filter((code) => code !== 'invalid-argument')
    assert.deepEqual(
      untagged,
      [],
      `these throw without a reason, so the member is told to try again: ${untagged.join(', ')}`
    )
  })

  it('reports the effect it gave back, so no surface has to guess', () => {
    const body = cancelBookingBody()
    assert.match(body, /returned: BookingCancelEffect/)
    assert.match(body, /credit: !!grantRefund/)
    assert.match(body, /usageUnit: !!usageRefund/)
    // Money is NEVER given back here — the effect only REPORTS that it was
    // paid. A refund call appearing in this body would make the copy wrong.
    assert.doesNotMatch(body, /refunds\.create|createRefund/)
  })
})

describe('parseBookingCancelRefusal', () => {
  it('narrows every known reason', () => {
    for (const reason of KNOWN) {
      assert.equal(parseBookingCancelRefusal({ reason }), reason)
    }
  })

  it('returns null for anything else — which is what makes a retry legitimate', () => {
    assert.equal(parseBookingCancelRefusal(undefined), null)
    assert.equal(parseBookingCancelRefusal(null), null)
    assert.equal(parseBookingCancelRefusal('past'), null)
    assert.equal(parseBookingCancelRefusal({}), null)
    assert.equal(parseBookingCancelRefusal({ reason: 'nonsense' }), null)
    assert.equal(parseBookingCancelRefusal({ reason: 7 }), null)
  })
})
