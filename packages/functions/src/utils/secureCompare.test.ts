import assert from 'node:assert/strict'
import { timingSafeEqualStr } from './secureCompare'

describe('timingSafeEqualStr', () => {
  it('returns true for equal strings', () => {
    assert.equal(timingSafeEqualStr('whsec_abc123', 'whsec_abc123'), true)
  })

  it('returns false for different strings', () => {
    assert.equal(timingSafeEqualStr('whsec_abc123', 'whsec_abc124'), false)
  })

  it('returns false when lengths differ (no throw)', () => {
    assert.equal(timingSafeEqualStr('short', 'a-much-longer-secret'), false)
  })

  it('treats null/undefined as empty and never throws', () => {
    assert.equal(timingSafeEqualStr(undefined, 'secret'), false)
    assert.equal(timingSafeEqualStr(null, null), true)
    assert.equal(timingSafeEqualStr('', undefined), true)
  })
})
