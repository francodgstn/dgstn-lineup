// Unit tests for substituteVariables — focused on the {{payload.*}} resolver
// that exposes inbound-webhook body fields to automation actions.

import assert from 'node:assert/strict'
import { substituteVariables } from './outreachEmail'

const CONTACT = { firstname: 'Ana', lastname: 'Roth' }
const TEAM = 'Studio Nord'
const NOW = new Date('2026-07-17T10:00:00Z')

function sub(str: string, payload?: Record<string, unknown>): string {
  return substituteVariables(str, CONTACT, TEAM, NOW, {}, payload)
}

describe('substituteVariables — payload tokens', () => {
  it('resolves a top-level payload field', () => {
    assert.equal(sub('Plan: {{payload.plan}}', { plan: 'pro' }), 'Plan: pro')
  })

  it('resolves a deeply nested payload path', () => {
    assert.equal(
      sub('Order {{payload.data.order.id}}', { data: { order: { id: 42 } } }),
      'Order 42'
    )
  })

  it('renders non-string scalars via String()', () => {
    assert.equal(sub('{{payload.count}}/{{payload.paid}}', { count: 0, paid: false }), '0/false')
  })

  it('renders an unknown path as empty, not as the literal token', () => {
    assert.equal(sub('Plan: [{{payload.missing}}]', { plan: 'pro' }), 'Plan: []')
  })

  it('renders empty when no payload is supplied at all', () => {
    assert.equal(sub('Plan: [{{payload.plan}}]'), 'Plan: []')
  })

  it('renders empty when a path traverses through a scalar', () => {
    assert.equal(sub('[{{payload.plan.nope}}]', { plan: 'pro' }), '[]')
  })

  it('renders empty for null values', () => {
    assert.equal(sub('[{{payload.plan}}]', { plan: null }), '[]')
  })

  // Objects/arrays collapse to '' so a template can never splat a whole webhook
  // body — which routinely carries the caller's own secrets — into an email.
  it('refuses to render an object value', () => {
    assert.equal(sub('[{{payload.data}}]', { data: { secret: 'sk_live_xyz' } }), '[]')
  })

  it('refuses to render an array value', () => {
    assert.equal(sub('[{{payload.items}}]', { items: [1, 2] }), '[]')
  })

  it('does not treat a prototype key as a payload field', () => {
    assert.equal(sub('[{{payload.constructor}}]', {}), '[]')
  })

  it('leaves the bare {{payload}} token untouched (no dotted path)', () => {
    assert.equal(sub('{{payload}}', { plan: 'pro' }), '{{payload}}')
  })

  it('substitutes contact tokens alongside payload tokens', () => {
    assert.equal(
      sub('Hi {{firstname}}, your {{payload.plan}} is live', { plan: 'pro' }),
      'Hi Ana, your pro is live'
    )
  })

  it('does not let a payload value inject further tokens', () => {
    // The payload replace runs after the contact replaces, so a value that looks
    // like a token is emitted literally rather than re-expanded.
    assert.equal(sub('{{payload.note}}', { note: '{{lastname}}' }), '{{lastname}}')
  })
})
