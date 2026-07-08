import assert from 'node:assert/strict'
import { isSyntheticEmail, applyEmailPolicy, applySmsPolicy } from './messagingPolicy'
import type { MessagingPolicy } from '@linyup/shared'

function policy(partial: Partial<MessagingPolicy>): MessagingPolicy {
  return { entityId: 'lead-test', mode: 'live', ...partial }
}

describe('isSyntheticEmail', () => {
  it('drops RFC-2606 reserved domains (the seeded contact pattern)', () => {
    assert.equal(isSyntheticEmail('priya.sharma.lead-swimli@example.com'), true)
    assert.equal(isSyntheticEmail('a@example.org'), true)
    assert.equal(isSyntheticEmail('a@example.net'), true)
  })

  it('drops reserved TLDs including subdomains', () => {
    assert.equal(isSyntheticEmail('a@foo.example'), true)
    assert.equal(isSyntheticEmail('a@mail.test'), true)
    assert.equal(isSyntheticEmail('a@thing.invalid'), true)
    assert.equal(isSyntheticEmail('a@localhost'), true)
    assert.equal(isSyntheticEmail('a@dev.local'), true)
  })

  it('is case-insensitive and tolerant of trailing dots', () => {
    assert.equal(isSyntheticEmail('A@EXAMPLE.COM'), true)
    assert.equal(isSyntheticEmail('a@example.com.'), true)
  })

  it('drops malformed addresses (no @, no domain dot)', () => {
    assert.equal(isSyntheticEmail('not-an-email'), true)
    assert.equal(isSyntheticEmail('a@hostname'), true)
  })

  it('passes real-world addresses', () => {
    assert.equal(isSyntheticEmail('hello@swimliclub.com'), false)
    assert.equal(isSyntheticEmail('franco.dgstn@gmail.com'), false)
    // NOT synthetic — a real-looking subdomain address (would bounce, but that
    // is the suppression list's job, not the synthetic guard's).
    assert.equal(isSyntheticEmail('georgie@swimli.linyup.com'), false)
  })
})

describe('applyEmailPolicy', () => {
  const recipients = ['ash@swimliclub.com', 'random@stranger.io']

  it('live passes everything through', () => {
    assert.deepEqual(applyEmailPolicy(recipients, policy({ mode: 'live' }), 'silent'), {
      recipients,
    })
  })

  it('silent drops everything', () => {
    const d = applyEmailPolicy(recipients, policy({ mode: 'silent' }), 'live')
    assert.deepEqual(d.recipients, [])
    assert.equal(d.droppedAll, 'policy_silent')
  })

  it('allowlist keeps exact matches case-insensitively', () => {
    const p = policy({ mode: 'allowlist', allowEmails: ['Ash@SwimliClub.com'] })
    const d = applyEmailPolicy(recipients, p, 'live')
    assert.deepEqual(d.recipients, ['ash@swimliclub.com'])
    assert.equal(d.droppedAll, undefined)
  })

  it('allowlist supports @domain entries', () => {
    const p = policy({ mode: 'allowlist', allowEmails: ['@swimliclub.com'] })
    assert.deepEqual(applyEmailPolicy(recipients, p, 'live').recipients, ['ash@swimliclub.com'])
  })

  it('allowlist with no match reports droppedAll', () => {
    const p = policy({ mode: 'allowlist', allowEmails: ['other@person.ch'] })
    const d = applyEmailPolicy(recipients, p, 'live')
    assert.deepEqual(d.recipients, [])
    assert.equal(d.droppedAll, 'policy_allowlist')
  })

  it('redirect replaces recipients with the target', () => {
    const p = policy({ mode: 'redirect', redirectEmail: 'capture@linyup.com' })
    assert.deepEqual(applyEmailPolicy(recipients, p, 'live').recipients, ['capture@linyup.com'])
  })

  it('redirect without a target degrades to silent', () => {
    const d = applyEmailPolicy(recipients, policy({ mode: 'redirect' }), 'live')
    assert.equal(d.droppedAll, 'policy_silent')
  })

  it('no policy → fallback mode applies (sandbox default silent)', () => {
    const d = applyEmailPolicy(recipients, null, 'silent')
    assert.equal(d.droppedAll, 'policy_silent')
    assert.deepEqual(applyEmailPolicy(recipients, null, 'live').recipients, recipients)
  })
})

describe('applySmsPolicy', () => {
  const phone = '+41761234501'

  it('live passes through', () => {
    assert.equal(applySmsPolicy(phone, policy({ mode: 'live' }), 'silent').recipient, phone)
  })

  it('silent and default-silent drop', () => {
    assert.equal(applySmsPolicy(phone, policy({ mode: 'silent' }), 'live').recipient, null)
    assert.equal(applySmsPolicy(phone, null, 'silent').recipient, null)
  })

  it('allowlist matches exact E.164 (tolerating separators in the list)', () => {
    const p = policy({ mode: 'allowlist', allowPhones: ['+41 76 123 45 01'] })
    assert.equal(applySmsPolicy(phone, p, 'live').recipient, phone)
    const miss = policy({ mode: 'allowlist', allowPhones: ['+41790000000'] })
    const d = applySmsPolicy(phone, miss, 'live')
    assert.equal(d.recipient, null)
    assert.equal(d.droppedReason, 'policy_allowlist')
  })

  it('redirect replaces the recipient; no target → silent', () => {
    const p = policy({ mode: 'redirect', redirectPhone: '+41790000000' })
    assert.equal(applySmsPolicy(phone, p, 'live').recipient, '+41790000000')
    assert.equal(applySmsPolicy(phone, policy({ mode: 'redirect' }), 'live').recipient, null)
  })
})
