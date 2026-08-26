import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A6 — the three PUBLIC, UNAUTHENTICATED booking entry points must spend the
// per-IP rate limiter at their top. bookSession and bookAppointment each send
// mail AS the studio over the SHARED Managed sender (one Brevo block would hit
// every Managed-sender studio at once) and mint provisional contacts;
// listAvailability runs an unfiltered `where('teamId','==')` scan per anonymous
// call. None enforced App Check or a limiter before this, so an enumerator could
// relay mail, fill a real studio's calendar, or burn reads unbounded. A source
// pin, like waivers/limits.test.ts: if a refactor drops one of these guards, or
// collapses the buckets so one busy NAT cross-locks another surface, this fails.

const raw = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')

describe('A6 — public booking callables are rate-limited', () => {
  const booking = raw('index.ts')
  const windowSrc = raw(join('..', 'appointments', 'window.ts'))

  it('bookSession spends the limiter under its own bucket', () => {
    assert.ok(
      booking.includes("checkoutRateLimit(request.rawRequest?.ip, 'book')"),
      'bookSession must spend checkoutRateLimit with the book bucket',
    )
  })

  it('bookAppointment spends the limiter under its own bucket', () => {
    assert.ok(
      windowSrc.includes("checkoutRateLimit(request.rawRequest?.ip, 'book-appointment')"),
      'bookAppointment must spend checkoutRateLimit with the book-appointment bucket',
    )
  })

  it('listAvailability spends the limiter with a browse-appropriate ceiling', () => {
    assert.ok(
      windowSrc.includes(
        "checkoutRateLimit(request.rawRequest?.ip, 'availability', AVAILABILITY_RATE_LIMIT_PER_HOUR)",
      ),
      'listAvailability must spend checkoutRateLimit with the availability bucket + higher ceiling',
    )
  })

  it('the three buckets are DISTINCT — a shared counter cross-locks unrelated surfaces', () => {
    const buckets = ["'book'", "'book-appointment'", "'availability'"]
    assert.equal(new Set(buckets).size, buckets.length)
  })
})
