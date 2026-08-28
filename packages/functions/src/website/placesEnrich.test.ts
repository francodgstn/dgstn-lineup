import assert from 'node:assert/strict'
import { applyPlacePool, sanitizeContactSection, type PlacePool } from './index'
import type { WebsiteSection } from '@linyup/shared'

/**
 * Firestore rejects a document containing `undefined` ANYWHERE, and the failure
 * is the whole write — so these tests assert on key PRESENCE, not just value.
 * `'address' in section` is the assertion that matters; `=== undefined` passes
 * for both the safe shape (no key) and the shape that took staging down.
 */
function hasUndefined(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUndefined)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => v === undefined || hasUndefined(v))
  }
  return false
}

const pool = (primary: PlacePool['primary'], byId: PlacePool['byId'] = new Map()): PlacePool => ({ byId, primary })

describe('website/applyPlacePool — no undefined reaches the published doc', () => {
  it('a primary place with a NAME BUT NO ADDRESS leaves no address key (the staging publish failure)', () => {
    // sanitizeContactSection cleans the absent address away; the enrichment must
    // not put the key back holding undefined.
    const section = sanitizeContactSection({ heading: 'Find us' }, 'c1') as WebsiteSection
    assert.equal('address' in section, false, 'precondition: sanitizer left no address key')

    applyPlacePool([section], pool({ name: 'Dojo Basel' }))

    assert.equal('address' in section, false, 'address key must not be created')
    assert.equal(hasUndefined(section), false)
    assert.equal((section as { mapQuery?: string }).mapQuery, 'Dojo Basel', 'falls back to the place name')
  })

  it('fills the address when the primary place has one', () => {
    const section = sanitizeContactSection({ heading: 'Find us' }, 'c1') as WebsiteSection
    applyPlacePool([section], pool({ name: 'Dojo Basel', address: 'Steinenring 1, Basel' }))
    assert.equal((section as { address?: string }).address, 'Steinenring 1, Basel')
    assert.equal((section as { mapQuery?: string }).mapQuery, 'Steinenring 1, Basel')
  })

  it("never overwrites an address the studio wrote", () => {
    const section = sanitizeContactSection({ address: 'Studio address' }, 'c1') as WebsiteSection
    applyPlacePool([section], pool({ name: 'Dojo Basel', address: 'Primary address' }))
    assert.equal((section as { address?: string }).address, 'Studio address')
  })

  it('a places section whose ids resolve to nothing leaves no places key', () => {
    const section = { id: 'p1', type: 'places', placeIds: ['gone'], columns: 3 } as unknown as WebsiteSection
    applyPlacePool([section], pool(null))
    assert.equal('places' in section, false, 'places key must not be created as undefined')
    assert.equal(hasUndefined(section), false)
  })

  it('embeds resolved places, and drops a stale embed when the selection empties', () => {
    const byId = new Map([['a', { id: 'a', name: 'Hall A', address: 'Street 1' }]])
    const section = { id: 'p1', type: 'places', placeIds: ['a'], columns: 3 } as unknown as WebsiteSection
    applyPlacePool([section], pool(null, byId))
    assert.deepEqual((section as { places?: unknown[] }).places, [{ id: 'a', name: 'Hall A', address: 'Street 1' }])

    // Selection cleared on a later publish: the previously embedded data must go
    // away entirely rather than linger as an undefined key.
    ;(section as { placeIds?: string[] }).placeIds = []
    applyPlacePool([section], pool(null, byId))
    assert.equal('places' in section, false)
    assert.equal(hasUndefined(section), false)
  })

  it('leaves a contact section untouched when the team has no primary place', () => {
    const section = sanitizeContactSection({ heading: 'Find us' }, 'c1') as WebsiteSection
    applyPlacePool([section], pool(null))
    assert.equal('address' in section, false)
    assert.equal('mapQuery' in section, false)
  })
})
