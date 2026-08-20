import assert from 'node:assert/strict'
import { isPastSession } from '@linyup/shared'

// ONE predicate, replacing six inline copies that did not agree.
//
// It exists because the app now uses this answer to WARN somebody that they are
// editing history, and a warning is only worth having if it is right on the two
// cases people actually hit: a class that is running right now (not past), and a
// multi-day event whose first day is behind us (also not past). Both of those
// come out wrong under the `start`-only rule that several surfaces had adopted,
// and the failure is silent — a banner that is simply always on.
//
// Lives in the functions suite because that is where shared utils are tested;
// `packages/shared` has no runner of its own (see contactFilter.test.ts).

const ts = (ms: number) => ({ toMillis: () => ms })
const NOW = 1_000_000

describe('isPastSession', () => {
  it('is past once the END has gone by', () => {
    assert.equal(isPastSession({ start: ts(NOW - 7200_000), end: ts(NOW - 1) }, NOW), true)
  })

  it('is NOT past while it is still running — the case a start-only rule gets wrong', () => {
    // Started an hour ago, ends in an hour. Telling a coach mid-class that they
    // are editing something in the past is how a warning gets ignored.
    assert.equal(isPastSession({ start: ts(NOW - 3600_000), end: ts(NOW + 3600_000) }, NOW), false)
  })

  it('is NOT past on the last day of a multi-day event', () => {
    // A four-day camp that began on Monday is not history on Wednesday.
    assert.equal(
      isPastSession({ start: ts(NOW - 3 * 86_400_000), end: ts(NOW + 86_400_000) }, NOW),
      false
    )
  })

  it('falls back to start when end is absent, for older documents', () => {
    assert.equal(isPastSession({ start: ts(NOW - 1) }, NOW), true)
    assert.equal(isPastSession({ start: ts(NOW + 1) }, NOW), false)
  })

  it('treats the exact end instant as not yet past', () => {
    assert.equal(isPastSession({ start: ts(NOW - 100), end: ts(NOW) }, NOW), false)
  })

  it('says NO when it has no dates at all rather than guessing', () => {
    // A form seeded with nothing must not accuse the user of editing history.
    assert.equal(isPastSession({}, NOW), false)
    assert.equal(isPastSession({ start: null, end: null }, NOW), false)
  })
})
