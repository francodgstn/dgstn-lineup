import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readGatewayData, legacyGatewayDataFields } from '@linyup/shared'

/**
 * The dotted-vs-nested `gateway_data` shape.
 *
 * `set()` takes a dotted key LITERALLY; only `update()` reads it as a field
 * path. The SaaS webhook persists with `set(…, { merge: true })`, so every
 * event it wrote before the fix stored top-level fields NAMED
 * "gateway_data.subscription_id" and never built the map that eleven readers
 * expect. Nothing threw — each miss returned `undefined` — so a live paying
 * studio had a dead billing portal and a webhook whose idempotency check never
 * matched.
 */
describe('readGatewayData', () => {
  it('reads the legacy dotted-literal shape the webhook actually wrote', () => {
    const doc = {
      gateway_type: 'stripe',
      'gateway_data.subscription_id': 'sub_1Tl8NiGz6xwscm1esVGryAv2',
      'gateway_data.customer_id': 'cus_123',
      'gateway_data.last_event_id': 'evt_1U4wq0Gz6xwscm1ePB35od9E',
    }
    // The read that was there before returns undefined for all three.
    assert.equal(
      (doc as Record<string, unknown> & { gateway_data?: { subscription_id?: string } })
        .gateway_data?.subscription_id,
      undefined
    )
    const gateway = readGatewayData(doc)
    assert.equal(gateway.subscription_id, 'sub_1Tl8NiGz6xwscm1esVGryAv2')
    assert.equal(gateway.customer_id, 'cus_123')
    assert.equal(gateway.last_event_id, 'evt_1U4wq0Gz6xwscm1ePB35od9E')
  })

  it('reads the nested shape the fixed writer and the add-on writers produce', () => {
    const gateway = readGatewayData({
      gateway_data: { subscription_id: 'sub_new', activeAddOns: [{ pluginId: 'p', itemId: 'i' }] },
    })
    assert.equal(gateway.subscription_id, 'sub_new')
    assert.deepEqual(gateway.activeAddOns, [{ pluginId: 'p', itemId: 'i' }])
  })

  it('lets the NESTED value win per key — a healed doc makes the literal stale', () => {
    const gateway = readGatewayData({
      'gateway_data.subscription_id': 'sub_stale',
      'gateway_data.customer_id': 'cus_only_literal',
      gateway_data: { subscription_id: 'sub_current' },
    })
    assert.equal(gateway.subscription_id, 'sub_current')
    // …while a key that exists ONLY as a literal is still read, not dropped.
    assert.equal(gateway.customer_id, 'cus_only_literal')
  })

  it('survives the shapes the seeders and createOrganization write', () => {
    assert.deepEqual(readGatewayData({ gateway_data: null }), {})
    assert.deepEqual(readGatewayData({}), {})
    assert.deepEqual(readGatewayData(null), {})
    assert.deepEqual(readGatewayData(undefined), {})
  })

  it('does not mistake a same-prefixed sibling field for a gateway_data key', () => {
    const gateway = readGatewayData({ gateway_data_migrated_at: 1, gateway_type: 'stripe' })
    assert.deepEqual(gateway, {})
  })

  it('legacyGatewayDataFields names exactly the literals, for FieldValue.delete()', () => {
    assert.deepEqual(
      legacyGatewayDataFields({
        'gateway_data.subscription_id': 'sub_1',
        'gateway_data.customer_id': 'cus_1',
        gateway_data: { activeAddOns: [] },
        gateway_type: 'stripe',
      }).sort(),
      ['gateway_data.customer_id', 'gateway_data.subscription_id']
    )
    assert.deepEqual(legacyGatewayDataFields({ gateway_data: { subscription_id: 'x' } }), [])
  })
})

describe('the SaaS webhook never reintroduces the dotted shape', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('builds gateway_data as a nested object, not as dotted keys', () => {
    // The exact construct that caused this: a dotted string key assigned into
    // the object that is later handed to set().
    const dotted = src.match(/update\[['"]gateway_data\.[^'"]+['"]\]\s*=(?!\s*FieldValue\.delete)/g)
    assert.equal(
      dotted,
      null,
      `dotted gateway_data writes are back: ${JSON.stringify(dotted)} — set() stores these as ` +
        `literal field names, so the nested map every reader wants is never created`
    )
    assert.ok(
      /update\.gateway_data = gatewayData/.test(src),
      'the nested gateway_data map must be what gets persisted'
    )
  })

  it('still persists with set+merge, which is WHY the nested shape is required', () => {
    // If this ever becomes update(), dotted keys would be correct again — but
    // update() throws on a missing doc and this handler creates one.
    assert.ok(
      /await subRef\.set\(update, \{ merge: true \}\)/.test(src),
      'the persist call changed — re-derive whether dotted keys are now field paths'
    )
  })

  it('reads its idempotency marker through the same helper that reads both shapes', () => {
    assert.ok(
      /const lastEventId = readGatewayData\(existing\.data\(\)\)\.last_event_id/.test(src),
      'the idempotency check must tolerate a doc still carrying the literal, or a ' +
        'Stripe retry against an un-migrated doc is processed twice'
    )
  })

  it('carries a literal over before deleting it', () => {
    // A payment.succeeded event knows no subscription id; deleting that literal
    // without copying it first would destroy the only copy on the document.
    const heal = src.slice(src.indexOf('legacyGatewayDataFields(existing.data())'))
    assert.ok(
      /if \(!\(key in gatewayData\)\) gatewayData\[key\] = existing\.data\(\)!\[field\]/.test(heal),
      'the carry-over must precede the delete'
    )
    assert.ok(
      heal.indexOf('gatewayData[key] = existing.data()![field]') <
        heal.indexOf('update[field] = FieldValue.delete()'),
      'the carry-over must precede the delete'
    )
  })
})
