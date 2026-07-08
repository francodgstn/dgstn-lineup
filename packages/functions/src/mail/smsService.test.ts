import assert from 'node:assert/strict'
import { normalizePhoneE164, sanitizeSmsSender } from './smsService'

describe('normalizePhoneE164', () => {
  it('keeps a valid E.164 number', () => {
    assert.equal(normalizePhoneE164('+41761234501'), '+41761234501')
  })

  it('strips separators', () => {
    assert.equal(normalizePhoneE164('+41 76 123 45 01'), '+41761234501')
    assert.equal(normalizePhoneE164('+41-76-123-45-01'), '+41761234501')
  })

  it('resolves 00 international prefix', () => {
    assert.equal(normalizePhoneE164('0041761234501'), '+41761234501')
  })

  it('assumes Switzerland for national 0-prefixed numbers', () => {
    assert.equal(normalizePhoneE164('076 123 45 01'), '+41761234501')
  })

  it('rejects garbage', () => {
    assert.equal(normalizePhoneE164('not a phone'), null)
    assert.equal(normalizePhoneE164(''), null)
    assert.equal(normalizePhoneE164(null), null)
    assert.equal(normalizePhoneE164('+0123'), null)
  })
})

describe('sanitizeSmsSender', () => {
  it('keeps a clean short name', () => {
    assert.equal(sanitizeSmsSender('SWIMLI'), 'SWIMLI')
  })

  it('strips non-alphanumerics and truncates to 11 chars', () => {
    assert.equal(sanitizeSmsSender('My Studio & Co. Zürich'), 'MyStudioCoZ')
  })

  it('falls back to Linyup when empty', () => {
    assert.equal(sanitizeSmsSender(''), 'Linyup')
    assert.equal(sanitizeSmsSender(null), 'Linyup')
    assert.equal(sanitizeSmsSender('!!!'), 'Linyup')
  })
})
