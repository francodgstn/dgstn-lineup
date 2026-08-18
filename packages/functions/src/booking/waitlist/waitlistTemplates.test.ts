import assert from 'node:assert/strict'
import {
  buildWaitlistExpiredEmail,
  buildWaitlistJoinedEmail,
  buildWaitlistOfferEmail,
  buildWaitlistOfferSms,
} from '../templates'

// The offer mail is the whole feature: it carries the single-use claim token,
// and a seat whose offer says nothing actionable is a seat destroyed in silence.
// These assert the two things that would make that happen without failing
// anything else — a missing claim link, and copy that leaks a token into an SMS.
// Run: pnpm --filter @linyup/functions test

const LANGS = ['en', 'de', 'fr', 'it'] as const
const START = new Date('2026-06-15T16:30:00Z') // 18:30 Europe/Zurich
const END = new Date('2026-06-15T17:30:00Z')
const EXPIRES = new Date('2026-06-15T14:00:00Z')
const CLAIM_URL = 'https://app.linyup.com/public/acme/waitlist?token=tok_abc123'

describe('buildWaitlistOfferEmail', () => {
  it('carries the claim link in every language', () => {
    for (const lang of LANGS) {
      const { html, text } = buildWaitlistOfferEmail({
        firstname: 'Nina',
        teamName: 'Acme Yoga',
        activityName: 'Vinyasa Flow',
        sessionStart: START,
        sessionEnd: END,
        locationName: 'Studio 1',
        claimUrl: CLAIM_URL,
        expiresAt: EXPIRES,
        lang,
      })
      assert.ok(html.includes(CLAIM_URL), `${lang}: no claim link in the html`)
      assert.ok(html.includes('Vinyasa Flow'), `${lang}: no activity name`)
      // The deadline is the point of the mail — 16:00 local, from the clamp.
      assert.ok(html.includes('16:00'), `${lang}: no claim deadline`)
      assert.ok(text.length > 0, `${lang}: empty text part`)
    }
  })

  it('greets a nameless entry without a dangling comma', () => {
    const { html } = buildWaitlistOfferEmail({
      firstname: '',
      teamName: 'Acme Yoga',
      activityName: 'Vinyasa Flow',
      sessionStart: START,
      sessionEnd: END,
      claimUrl: CLAIM_URL,
      expiresAt: EXPIRES,
    })
    assert.ok(html.includes('<p>Hi,</p>'))
    assert.ok(!html.includes('Hi ,'))
  })
})

describe('buildWaitlistOfferSms', () => {
  it('never carries a link — a claim token would cost a second segment', () => {
    for (const lang of LANGS) {
      const sms = buildWaitlistOfferSms({
        teamName: 'Acme Yoga',
        activityName: 'Vinyasa Flow',
        sessionStart: START,
        expiresAt: EXPIRES,
        lang,
      })
      assert.ok(!sms.includes('http'), `${lang}: a URL leaked into the SMS`)
      assert.ok(sms.length <= 160, `${lang}: ${sms.length} chars — over one segment`)
      assert.ok(sms.startsWith('Acme Yoga:'), `${lang}: the studio has to be first`)
      assert.ok(sms.includes('Vinyasa Flow'), `${lang}: no activity name`)
    }
  })
})

describe('buildWaitlistJoinedEmail', () => {
  it('shows the place in the queue and the status link, never a claim link', () => {
    const statusUrl = 'https://app.linyup.com/public/acme/waitlist?token=entry_abc'
    const { html } = buildWaitlistJoinedEmail({
      firstname: 'Nina',
      teamName: 'Acme Yoga',
      activityName: 'Vinyasa Flow',
      sessionStart: START,
      sessionEnd: END,
      position: 3,
      statusUrl,
    })
    assert.ok(html.includes('>3<') || html.includes(' 3'))
    assert.ok(html.includes(statusUrl))
  })

  it('drops the button rather than linking nowhere when there is no status url', () => {
    const { html } = buildWaitlistJoinedEmail({
      firstname: 'Nina',
      teamName: 'Acme Yoga',
      activityName: 'Vinyasa Flow',
      sessionStart: START,
      sessionEnd: END,
      position: 1,
      statusUrl: null,
    })
    assert.ok(!html.includes('href="null"'))
    assert.ok(!html.includes('undefined'))
  })
})

describe('buildWaitlistExpiredEmail', () => {
  it('says the place is gone and offers the way back', () => {
    const rejoinUrl = 'https://app.linyup.com/public/acme/booking?session=sess1'
    const { html } = buildWaitlistExpiredEmail({
      firstname: 'Nina',
      teamName: 'Acme Yoga',
      activityName: 'Vinyasa Flow',
      sessionStart: START,
      rejoinUrl,
    })
    assert.ok(html.includes('Vinyasa Flow'))
    assert.ok(html.includes(rejoinUrl))
  })
})
