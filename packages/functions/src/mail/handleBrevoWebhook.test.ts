import assert from 'node:assert/strict'
import { classifyBrevoEvent } from './handleBrevoWebhook'

describe('classifyBrevoEvent', () => {
  it('suppresses hard bounces (snake_case payload form)', () => {
    const c = classifyBrevoEvent('hard_bounce')
    assert.equal(c.suppression, 'hardBounce')
    assert.equal(c.ledgerStatus, 'bounced')
  })

  it('suppresses blocked / spam / invalid recipients', () => {
    assert.equal(classifyBrevoEvent('blocked').suppression, 'blocked')
    assert.equal(classifyBrevoEvent('spam').suppression, 'spam')
    assert.equal(classifyBrevoEvent('invalid_email').suppression, 'invalid')
    assert.equal(classifyBrevoEvent('unsubscribed').suppression, 'unsubscribed')
  })

  it('accepts the camelCase API form too', () => {
    assert.equal(classifyBrevoEvent('hardBounce').suppression, 'hardBounce')
  })

  it('marks delivered without suppressing', () => {
    const c = classifyBrevoEvent('delivered')
    assert.equal(c.suppression, undefined)
    assert.equal(c.ledgerStatus, 'delivered')
  })

  it('ignores transient/engagement events (soft bounce keeps sending)', () => {
    assert.equal(classifyBrevoEvent('soft_bounce').suppression, undefined)
    assert.equal(classifyBrevoEvent('opened').suppression, undefined)
    assert.equal(classifyBrevoEvent('click').suppression, undefined)
    assert.equal(classifyBrevoEvent('click').ledgerStatus, undefined)
  })
})
