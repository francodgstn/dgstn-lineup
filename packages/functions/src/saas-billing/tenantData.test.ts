// Completeness guard for the tenant-data manifest (packages/shared/src/tenantData.ts).
//
// Every top-level Firestore collection MUST be consciously classified as either
// tenant-scoped (TENANT_DATA_COLLECTIONS / the team subtree) or platform-wide
// (PLATFORM_COLLECTIONS), or explicitly retired. This test discovers top-level
// collections from the exported `*_COLLECTION` constants, so adding a new one
// without classifying it fails CI — preventing tenant data from silently leaking
// out of per-team teardown/export.

import * as assert from 'assert'
import * as shared from '@linyup/shared'
import {
  TENANT_DATA_COLLECTIONS,
  PLATFORM_COLLECTIONS,
  RETIRED_TOP_LEVEL_COLLECTIONS,
  TENANT_TEAM_DOC_COLLECTION,
} from '@linyup/shared'

describe('tenant-data manifest', () => {
  // All top-level collection names = every exported string constant whose name
  // ends in `_COLLECTION` (subcollections use the `_SUBCOLLECTION` suffix).
  const allTopLevel = Object.entries(shared)
    .filter(([k, v]) => k.endsWith('_COLLECTION') && typeof v === 'string')
    .map(([, v]) => v as string)

  const tenant = new Set(TENANT_DATA_COLLECTIONS.map((c) => c.collection))

  it('classifies every top-level collection as tenant, platform, or retired', () => {
    const classified = new Set<string>([
      ...tenant,
      ...PLATFORM_COLLECTIONS,
      ...RETIRED_TOP_LEVEL_COLLECTIONS,
      TENANT_TEAM_DOC_COLLECTION,
    ])
    const unclassified = [...new Set(allTopLevel)].filter((c) => !classified.has(c))
    assert.deepStrictEqual(
      unclassified,
      [],
      `Unclassified top-level collection(s): ${unclassified.join(', ')}. ` +
        `Register each in TENANT_DATA_COLLECTIONS or PLATFORM_COLLECTIONS ` +
        `(packages/shared/src/tenantData.ts).`
    )
  })

  it('never classifies a collection as both tenant and platform', () => {
    const overlap = PLATFORM_COLLECTIONS.filter((c) => tenant.has(c))
    assert.deepStrictEqual(overlap, [], `Collection(s) in both tenant & platform: ${overlap.join(', ')}`)
  })

  it('uses only supported match strategies', () => {
    for (const c of TENANT_DATA_COLLECTIONS) {
      assert.ok(
        c.match.by === 'field' || c.match.by === 'docId',
        `${c.collection}: unsupported match strategy`
      )
      if (c.match.by === 'field') {
        assert.ok(c.match.field.length > 0, `${c.collection}: empty match field`)
      }
    }
  })
})
