import assert from 'node:assert/strict'
import { isByoEligible, resolveStudioSender } from './senderResolution'
import type { EmailSenderConfig } from '@linyup/shared'

const MANAGED = 'studios@linyup.com'

function cfg(partial: Partial<EmailSenderConfig>): EmailSenderConfig {
  return {
    type: 'email_sender',
    model: 'managed',
    updatedAt: undefined as unknown as EmailSenderConfig['updatedAt'],
    ...partial,
  }
}

describe('resolveStudioSender', () => {
  it('uses Managed by default when there is no sender config', () => {
    const s = resolveStudioSender({
      teamName: 'HMD Basel',
      contactEmail: 'coach@hmd.ch',
      plan: 'studio',
      config: null,
      managedFrom: MANAGED,
    })
    assert.equal(s.email, MANAGED)
    assert.equal(s.name, 'HMD Basel')
    assert.equal(s.replyTo, 'coach@hmd.ch')
  })

  it('sends from the BYO domain when verified and on a paid plan', () => {
    const s = resolveStudioSender({
      teamName: 'Their Dojo',
      contactEmail: 'c@theirdojo.ch',
      plan: 'studio',
      config: cfg({ model: 'byo_domain', domain: 'theirdojo.ch', from_local_part: 'info', verification_status: 'verified' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, 'info@theirdojo.ch')
    assert.equal(s.replyTo, 'c@theirdojo.ch')
  })

  it('respects a custom From local part on a verified BYO domain', () => {
    const s = resolveStudioSender({
      teamName: 'X',
      plan: 'coach',
      config: cfg({ model: 'byo_domain', domain: 'x.ch', from_local_part: 'hello', verification_status: 'verified' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, 'hello@x.ch')
  })

  it('falls back to Managed while a BYO domain is unverified', () => {
    const s = resolveStudioSender({
      teamName: 'Their Dojo',
      plan: 'studio',
      config: cfg({ model: 'byo_domain', domain: 'theirdojo.ch', verification_status: 'pending' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, MANAGED)
  })

  it('falls back to Managed when a BYO domain verification has failed', () => {
    const s = resolveStudioSender({
      teamName: 'Their Dojo',
      plan: 'studio',
      config: cfg({ model: 'byo_domain', domain: 'theirdojo.ch', verification_status: 'failed' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, MANAGED)
  })

  it('forces Managed for free-plan studios even if a BYO domain is verified', () => {
    const s = resolveStudioSender({
      teamName: 'Their Dojo',
      plan: 'free',
      config: cfg({ model: 'byo_domain', domain: 'theirdojo.ch', verification_status: 'verified' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, MANAGED)
  })

  it('never emits an unauthenticated domain when the config has no domain', () => {
    const s = resolveStudioSender({
      teamName: 'Their Dojo',
      plan: 'studio',
      config: cfg({ model: 'byo_domain', verification_status: 'verified' }),
      managedFrom: MANAGED,
    })
    assert.equal(s.email, MANAGED)
  })

  it('falls back to the Linyup display name when the team name is blank', () => {
    const s = resolveStudioSender({ teamName: '   ', plan: 'studio', config: null, managedFrom: MANAGED })
    assert.equal(s.name, 'Linyup')
  })
})

describe('isByoEligible', () => {
  it('is true for paid plans', () => {
    for (const p of ['coach', 'studio', 'organization'] as const) assert.equal(isByoEligible(p), true)
  })
  it('is false for free / unknown plans', () => {
    assert.equal(isByoEligible('free'), false)
    assert.equal(isByoEligible(undefined), false)
  })
})
