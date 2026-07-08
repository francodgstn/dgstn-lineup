import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { buildCreditSummary } from './onCreditGrantWrite'
import type { CreditGrant } from '@linyup/shared'

const NOW = new Date('2026-07-08T12:00:00Z')

function grant(partial: Partial<CreditGrant>): CreditGrant {
  return {
    id: 'g1',
    teamId: 't1',
    subscription_type_id: 'sub-a',
    credits_total: 5,
    credits_used: 0,
    source: 'seed',
    ...partial,
  } as CreditGrant
}

describe('buildCreditSummary', () => {
  it('sums remaining credits per type', () => {
    const summary = buildCreditSummary(
      [
        grant({ id: 'g1', credits_total: 5, credits_used: 2 }),
        grant({ id: 'g2', credits_total: 3, credits_used: 0 }),
        grant({ id: 'g3', subscription_type_id: 'sub-b', credits_total: 10, credits_used: 9 }),
      ],
      NOW,
    )
    assert.deepEqual(
      summary.map((e) => [e.subscription_type_id, e.remaining]),
      [
        ['sub-a', 6],
        ['sub-b', 1],
      ],
    )
  })

  it('ignores exhausted and expired grants', () => {
    const past = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'))
    const summary = buildCreditSummary(
      [
        grant({ id: 'g1', credits_total: 3, credits_used: 3 }), // exhausted
        grant({ id: 'g2', credits_total: 5, credits_used: 0, expires_at: past }), // expired
      ],
      NOW,
    )
    assert.deepEqual(summary, [])
  })

  it('tracks the soonest upcoming expiry', () => {
    const soon = Timestamp.fromDate(new Date('2026-08-01T00:00:00Z'))
    const later = Timestamp.fromDate(new Date('2026-12-01T00:00:00Z'))
    const summary = buildCreditSummary(
      [
        grant({ id: 'g1', expires_at: later }),
        grant({ id: 'g2', expires_at: soon }),
      ],
      NOW,
    )
    assert.equal(summary.length, 1)
    assert.equal((summary[0].next_expires_at as Timestamp).toMillis(), soon.toMillis())
  })

  it('a no-expiry grant leaves next_expires_at from dated siblings', () => {
    const soon = Timestamp.fromDate(new Date('2026-08-01T00:00:00Z'))
    const summary = buildCreditSummary(
      [grant({ id: 'g1', expires_at: null }), grant({ id: 'g2', expires_at: soon })],
      NOW,
    )
    assert.equal(summary[0].remaining, 10)
    assert.equal((summary[0].next_expires_at as Timestamp).toMillis(), soon.toMillis())
  })
})
