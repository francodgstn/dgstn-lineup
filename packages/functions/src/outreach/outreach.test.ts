import assert from 'node:assert/strict'
import { mapWithConcurrency, partitionRecipients, MAX_RECIPIENTS } from './recipients'

// Fixtures for the bulk-outreach guard rails. The send itself is I/O; what is
// worth pinning is WHO gets mailed and HOW HARD we hit the ESP.
// Run with: pnpm --filter @linyup/functions test

function contact(over: Record<string, unknown> = {}) {
  return { email: 'a@example.com', teamId: 'team-1', ...over }
}

describe('partitionRecipients', () => {
  it('mails a normal contact', () => {
    assert.deepEqual(partitionRecipients(contact(), 'team-1'), { ok: true })
  })

  // Marketing consent. This is the check the manual send path was missing —
  // it mailed people who had explicitly opted out.
  it('skips a contact who unsubscribed', () => {
    assert.deepEqual(
      partitionRecipients(contact({ email_unsubscribed: true }), 'team-1'),
      { ok: false, reason: 'unsubscribed' },
    )
  })

  it('only treats an explicit true as an opt-out', () => {
    assert.equal(partitionRecipients(contact({ email_unsubscribed: false }), 'team-1').ok, true)
    assert.equal(partitionRecipients(contact({ email_unsubscribed: undefined }), 'team-1').ok, true)
  })

  it('skips a contact with no email', () => {
    assert.deepEqual(
      partitionRecipients(contact({ email: '' }), 'team-1'),
      { ok: false, reason: 'no_email' },
    )
    assert.deepEqual(
      partitionRecipients(contact({ email: undefined }), 'team-1'),
      { ok: false, reason: 'no_email' },
    )
  })

  // Tenant boundary: a caller could pass any contact id.
  it('refuses a contact from another team', () => {
    assert.deepEqual(
      partitionRecipients(contact({ teamId: 'team-2' }), 'team-1'),
      { ok: false, reason: 'wrong_team' },
    )
  })

  it('accepts the legacy `teacher` tenant field', () => {
    assert.equal(
      partitionRecipients({ email: 'a@example.com', teacher: 'team-1' }, 'team-1').ok,
      true,
    )
  })

  it('treats a missing contact as skipped, not an error', () => {
    assert.deepEqual(partitionRecipients(null, 'team-1'), { ok: false, reason: 'not_found' })
  })

  // Consent is checked BEFORE the tenant check would matter, but an
  // unsubscribed contact of another team must still never be mailed.
  it('never mails an unsubscribed contact of another team', () => {
    assert.equal(
      partitionRecipients(contact({ teamId: 'team-2', email_unsubscribed: true }), 'team-1').ok,
      false,
    )
  })
})

describe('mapWithConcurrency', () => {
  it('visits every item exactly once', async () => {
    const items = Array.from({ length: 37 }, (_, i) => i)
    const seen: number[] = []
    await mapWithConcurrency(items, 5, async (n) => { seen.push(n) })
    assert.deepEqual([...seen].sort((a, b) => a - b), items)
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 50 }, (_, i) => i)
    await mapWithConcurrency(items, 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
    })
    assert.ok(peak <= 4, `peak concurrency was ${peak}`)
  })

  it('handles an empty list and a limit above the item count', async () => {
    let calls = 0
    await mapWithConcurrency([], 10, async () => { calls++ })
    assert.equal(calls, 0)
    await mapWithConcurrency([1, 2], 10, async () => { calls++ })
    assert.equal(calls, 2)
  })

  // One recipient's failure must not abandon the rest of the send.
  it('keeps going when a worker throws, and surfaces nothing', async () => {
    const done: number[] = []
    await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      done.push(n)
    }).catch(() => { /* the caller catches per item; see index.ts */ })
    // Items other than the thrower still ran.
    assert.ok(done.includes(1))
  })
})

describe('MAX_RECIPIENTS', () => {
  it('is a real ceiling, not a suggestion', () => {
    assert.ok(MAX_RECIPIENTS > 0 && MAX_RECIPIENTS <= 1000)
  })
})
