import assert from 'node:assert/strict'
import { groupByKind, partitionReceipts } from './sendPush'

describe('push/sendPush — groupByKind', () => {
  it('buckets registrations by vendor kind, preserving order within a bucket', () => {
    const regs = [
      { contactId: 'c1', token: 't1', kind: 'expo' as const },
      { contactId: 'c1', token: 't2', kind: 'fcm' as const },
      { contactId: 'c2', token: 't3', kind: 'expo' as const },
    ]
    const grouped = groupByKind(regs)
    assert.deepEqual(
      grouped.get('expo')!.map((r) => r.token),
      ['t1', 't3']
    )
    assert.deepEqual(
      grouped.get('fcm')!.map((r) => r.token),
      ['t2']
    )
  })

  it('an empty list produces an empty map', () => {
    assert.equal(groupByKind([]).size, 0)
  })
})

describe('push/sendPush — partitionReceipts', () => {
  const regs = [
    { contactId: 'c1', token: 'ok1', kind: 'expo' as const },
    { contactId: 'c1', token: 'dead1', kind: 'expo' as const },
    { contactId: 'c2', token: 'err1', kind: 'expo' as const },
  ]

  it('counts ok receipts and never touches the token doc for them', () => {
    const { sentCount, dead } = partitionReceipts([{ token: 'ok1', status: 'ok' }], regs)
    assert.equal(sentCount, 1)
    assert.deepEqual(dead, [])
  })

  it('collects ONLY dead receipts for pruning — error is left alone', () => {
    const { sentCount, dead } = partitionReceipts(
      [
        { token: 'ok1', status: 'ok' },
        { token: 'dead1', status: 'dead', error: 'gone' },
        { token: 'err1', status: 'error', error: 'transient' },
      ],
      regs
    )
    assert.equal(sentCount, 1)
    assert.deepEqual(
      dead.map((d) => d.token),
      ['dead1']
    )
  })

  it('a receipt for a token not in the registration list is ignored rather than crashing', () => {
    const { dead } = partitionReceipts([{ token: 'unknown-token', status: 'dead' }], regs)
    assert.deepEqual(dead, [])
  })
})
