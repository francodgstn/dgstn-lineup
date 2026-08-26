import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rateLimitIp } from './checkout'

// A11 — connect_checkout_attempts held a raw client IP in its doc id and `ip`
// field, in a collection with no purge and no TTL: an unbounded store of
// identifiable access logs, against the 30-day retention privacy.md promises.
// The IP is only ever a bucket key, so the fix is to hash it (no address stored)
// AND sweep dead buckets nightly (no unbounded growth).

describe('A11 — the rate-limit IP subject is hashed, never stored raw', () => {
  it('a real IP becomes a hex digest that does not contain the address', () => {
    const key = rateLimitIp('203.0.113.7')
    assert.ok(!key.includes('203'), 'the raw octets must not survive')
    assert.ok(!key.includes('113'), 'the raw octets must not survive')
    assert.match(key, /^[0-9a-f]{64}$/, 'a sha256 hex digest')
  })

  it('is stable — the same IP always lands in the same bucket', () => {
    assert.equal(rateLimitIp('198.51.100.9'), rateLimitIp('198.51.100.9'))
  })

  it('different IPs get different buckets', () => {
    assert.notEqual(rateLimitIp('198.51.100.9'), rateLimitIp('198.51.100.10'))
  })

  it('the shared no-IP bucket stays the readable "unknown" — not an address', () => {
    assert.equal(rateLimitIp(undefined), 'unknown')
    assert.equal(rateLimitIp(''), 'unknown')
    assert.equal(rateLimitIp('   '), 'unknown')
  })
})

describe('A11 — connect_checkout_attempts is swept, not kept forever', () => {
  const daily = join(__dirname, '..', 'dailyTasks')

  it('purgeCheckoutAttempts runs nightly in dailyTasks', () => {
    const idx = readFileSync(join(daily, 'index.ts'), 'utf8')
    assert.ok(idx.includes('handler: purgeCheckoutAttempts'), 'the sweep must be registered')
  })

  it('it deletes by the hour bucket, retaining days not forever', () => {
    const sweep = readFileSync(join(daily, 'purgeCheckoutAttempts.ts'), 'utf8')
    assert.match(sweep, /connect_checkout_attempts/)
    assert.match(sweep, /where\('bucket', '<', cutoffBucket\)/)
  })
})
