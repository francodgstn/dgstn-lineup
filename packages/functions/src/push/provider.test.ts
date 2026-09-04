import assert from 'node:assert/strict'
import { getPushProvider } from './provider'

// The ONE decision point for which vendor a `PushToken.kind` resolves to
// (module header). Pinned here so a future edit can't quietly change the
// live/declared split without a failing test.
describe('push/provider — getPushProvider', () => {
  const originalEnv = process.env.PUSH_PROVIDER

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PUSH_PROVIDER
    else process.env.PUSH_PROVIDER = originalEnv
  })

  it("resolves 'expo' to the live Expo provider", () => {
    delete process.env.PUSH_PROVIDER
    const provider = getPushProvider('expo')
    assert.ok(provider)
    assert.equal(provider!.kind, 'expo')
  })

  it("resolves 'fcm' to a provider that throws on send — declared, not live", async () => {
    delete process.env.PUSH_PROVIDER
    const provider = getPushProvider('fcm')
    assert.ok(provider)
    assert.equal(provider!.kind, 'fcm')
    await assert.rejects(() => provider!.send([]))
  })

  it("PUSH_PROVIDER=none degrades to null for every kind — the escape hatch", () => {
    process.env.PUSH_PROVIDER = 'none'
    assert.equal(getPushProvider('expo'), null)
    assert.equal(getPushProvider('fcm'), null)
  })

  it('an unset PUSH_PROVIDER dispatches by kind rather than picking one vendor for all', () => {
    delete process.env.PUSH_PROVIDER
    assert.equal(getPushProvider('expo')!.kind, 'expo')
    assert.equal(getPushProvider('fcm')!.kind, 'fcm')
  })
})
