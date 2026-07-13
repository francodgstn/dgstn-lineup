import assert from 'node:assert/strict'
import {
  normalizeKioskConfig,
  toKioskPublicConfig,
  DEFAULT_KIOSK_CONFIG,
  type KioskConfig,
} from '@linyup/shared'

// Regression tests for the kiosk config normalization that feeds
// syncTeamPublicProfile's public denormalization. A freshly-installed kiosk
// persists `config: {}`; before normalization, toKioskPublicConfig({}) threw on
// `c.lock.enabled` and aborted the whole public-profile sync — so the public
// kiosk page always showed "Kiosk mode isn't available for this studio".
// Run: pnpm --filter @linyup/functions test  (build @linyup/shared first).

describe('normalizeKioskConfig', () => {
  it('fills a complete config from defaults when given an empty object', () => {
    assert.deepEqual(normalizeKioskConfig({}), DEFAULT_KIOSK_CONFIG)
  })

  it('treats undefined/null like an empty config', () => {
    assert.deepEqual(normalizeKioskConfig(undefined), DEFAULT_KIOSK_CONFIG)
    assert.deepEqual(normalizeKioskConfig(null), DEFAULT_KIOSK_CONFIG)
  })

  it('deep-merges partial nested fields onto the defaults', () => {
    const cfg = normalizeKioskConfig({
      title: 'Front desk',
      features: { walkIn: false },
      lock: { enabled: true, pin: '1234', epoch: 2 },
    } as Partial<KioskConfig>)
    assert.equal(cfg.title, 'Front desk')
    // untouched feature flags keep their defaults
    assert.equal(cfg.features.schedule, DEFAULT_KIOSK_CONFIG.features.schedule)
    assert.equal(cfg.features.walkIn, false)
    // nested lock merged; standby fully defaulted
    assert.equal(cfg.lock.enabled, true)
    assert.equal(cfg.lock.epoch, 2)
    assert.deepEqual(cfg.standby, DEFAULT_KIOSK_CONFIG.standby)
  })
})

describe('toKioskPublicConfig via normalizeKioskConfig', () => {
  it('does not throw on an empty stored config and strips the PIN', () => {
    const pub = toKioskPublicConfig(
      normalizeKioskConfig({ lock: { enabled: true, pin: '9999', epoch: 1 } } as Partial<KioskConfig>)
    )
    assert.equal(pub.lock.enabled, true)
    assert.equal(pub.lock.epoch, 1)
    // the PIN must never reach the world-readable public config
    assert.equal((pub.lock as unknown as Record<string, unknown>).pin, undefined)
    // a complete public config is produced (the fields the public kiosk page reads)
    assert.ok(pub.features)
    assert.ok(pub.standby)
    assert.equal(pub.scheduleView, DEFAULT_KIOSK_CONFIG.scheduleView)
  })

  it('throws WITHOUT normalization on an empty config (documents the original bug)', () => {
    assert.throws(() => toKioskPublicConfig({} as KioskConfig))
  })
})
