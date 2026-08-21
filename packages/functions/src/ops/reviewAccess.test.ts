import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { decideReviewCode, type ReviewAccess } from './reviewAccess'

// `decideReviewCode` is the whole decision with the Firestore read lifted out,
// which is why it can be tested at all. Each arm below is a way the fixed-code
// bypass could be left open by accident.

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0)
const EMAIL = 'app.review@example.com'

function access(overrides: Record<string, unknown> = {}): ReviewAccess {
  return {
    enabled: true,
    email: EMAIL,
    code: '135790',
    expires_at: Timestamp.fromMillis(NOW + 7 * 24 * 3600 * 1000),
    ...overrides,
  } as ReviewAccess
}

describe('decideReviewCode — the fixed-code bypass, and every way it stays shut', () => {
  it('issues the fixed code for the one configured address', () => {
    const a = access()
    assert.equal(decideReviewCode(a, EMAIL, NOW), '135790')
  })

  it('returns null for every other address', () => {
    const a = access()
    // The neighbouring cases that matter: a different person, and a near-miss.
    for (const other of ['someone.else@example.com', 'app.review@example.org', 'app.review+x@example.com']) {
      assert.equal(decideReviewCode(a, other, NOW), null, `${other} must not match`)
    }
  })

  it('returns null when disabled — this is the kill switch', () => {
    const a = access({ enabled: false })
    assert.equal(decideReviewCode(a, EMAIL, NOW), null)
  })

  it('returns null once EXPIRED, so nobody has to remember to turn it off', () => {
    const a = access({ expires_at: Timestamp.fromMillis(NOW - 1000) })
    assert.equal(decideReviewCode(a, EMAIL, NOW), null)
  })

  it('treats a MISSING or unparseable expiry as expired, never as forever', () => {
    for (const bad of [undefined, null, 'next tuesday', 12345]) {
      const a = access({ expires_at: bad })
      assert.equal(decideReviewCode(a, EMAIL, NOW), null, `expiry ${String(bad)} must not open the door`)
    }
  })

  it('refuses a stored code that is not six digits', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '', undefined]) {
      const a = access({ code: bad })
      assert.equal(decideReviewCode(a, EMAIL, NOW), null, `code ${String(bad)} must be refused`)
    }
  })

  it('returns null when nothing is configured at all', () => {
    assert.equal(decideReviewCode(null, EMAIL, NOW), null)
  })

  it('normalises the stored address, so casing and stray spaces still match', () => {
    const a = access({ email: '  App.Review@Example.com ' })
    assert.equal(decideReviewCode(a, EMAIL, NOW), '135790')
  })
})
