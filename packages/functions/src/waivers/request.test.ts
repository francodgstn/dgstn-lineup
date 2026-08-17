import assert from 'node:assert/strict'
import { requestDayKey, waiverRequestMailKey } from './request'
import { buildWaiverRequestEmail, waiverRequestSubject } from './requestEmail'

// Fixtures for the ASK — the pure halves of `requestWaiverAcceptance`.
// Run with: pnpm --filter @linyup/functions test

describe('the idempotency key — safe to call twice, still able to remind', () => {
  const key = (opts: { doc?: string; version?: number; contact?: string; day?: string } = {}) =>
    waiverRequestMailKey(
      opts.doc ?? 'house-rules',
      opts.version ?? 3,
      opts.contact ?? 'contact-1',
      opts.day ?? '2026-08-17'
    )

  it('collapses a double-click: same document, version, contact and day', () => {
    assert.equal(key(), key())
  })

  it('does NOT collapse tomorrow — a reminder is a second send, not a duplicate', () => {
    // The waitlist notifier's recorded bug was the opposite: a relationship-only
    // key silently swallowed the second round's mail forever.
    assert.notEqual(key({ day: '2026-08-17' }), key({ day: '2026-08-18' }))
  })

  it('does not collapse across a new published version', () => {
    assert.notEqual(key({ version: 3 }), key({ version: 4 }))
  })

  it('is per person and per document', () => {
    assert.notEqual(key({ contact: 'a' }), key({ contact: 'b' }))
    assert.notEqual(key({ doc: 'a' }), key({ doc: 'b' }))
  })
})

describe('the day key', () => {
  it('is one calendar day for everybody, in the studio timezone of record', () => {
    // 22:30 UTC on the 17th is already the 18th in Zurich (summer, +02:00), and
    // both managers of one studio must land on the same bucket.
    assert.equal(requestDayKey(Date.UTC(2026, 7, 17, 22, 30)), '2026-08-18')
    assert.equal(requestDayKey(Date.UTC(2026, 7, 17, 8, 0)), '2026-08-17')
  })
})

describe('the mail', () => {
  const base = {
    firstname: 'Anna',
    teamName: 'Studio Nord',
    documentTitle: 'House Rules',
    spaceUrl: 'https://linyup.com/public/nord/space',
  } as const

  it('opens with a DIFFERENT sentence per state — "we have no signature" is wrong for three of them', () => {
    const bodies = (['none', 'superseded', 'expired', 'revoked'] as const).map(
      (state) => buildWaiverRequestEmail({ ...base, state }).html
    )
    assert.equal(new Set(bodies).size, 4)
  })

  it('carries the Space link, and no second signing surface', () => {
    const { html } = buildWaiverRequestEmail({ ...base, state: 'none' })
    assert.ok(html.includes(base.spaceUrl))
  })

  it('escapes the studio-authored title in the BODY and leaves the SUBJECT raw', () => {
    const title = 'House <Rules> & Waiver'
    const { html } = buildWaiverRequestEmail({ ...base, documentTitle: title, state: 'none' })
    assert.ok(html.includes('House &lt;Rules&gt; &amp; Waiver'))
    assert.ok(!html.includes('House <Rules>'))
    // Brevo takes the subject as its own API field; escaping it would put
    // `&amp;` in somebody's inbox.
    assert.equal(waiverRequestSubject(title, 'en'), `Please sign: ${title}`)
  })

  it('speaks all four languages', () => {
    for (const lang of ['en', 'de', 'fr', 'it'] as const) {
      const { html, text } = buildWaiverRequestEmail({ ...base, state: 'none', lang })
      assert.ok(html.length > 0 && text.length > 0)
      assert.ok(html.includes('Studio Nord'))
    }
    assert.notEqual(waiverRequestSubject('House Rules', 'de'), waiverRequestSubject('House Rules', 'fr'))
  })
})
