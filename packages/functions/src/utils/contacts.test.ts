import assert from 'node:assert/strict'
import type * as admin from 'firebase-admin'
import { resolveSingleContact } from './contacts'

// Minimal Firestore stand-in: collection().where().where().get() returning the
// seeded contact docs. We ignore the filter values and just hand back the docs —
// the active-vs-archived/deleted filtering happens inside resolveSingleContact.
function mockDb(docs: Array<{ id: string; data: Record<string, unknown> }>): admin.firestore.Firestore {
  const query = {
    where() {
      return query
    },
    async get() {
      return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) }
    },
  }
  return {
    collection() {
      return query
    },
  } as unknown as admin.firestore.Firestore
}

const active = (email: string) => ({ teamId: 't1', email, archived_at: null, deleted_at: null })

describe('resolveSingleContact', () => {
  it('returns null with count 0 when no email is given', async () => {
    const res = await resolveSingleContact('t1', '', mockDb([]))
    assert.deepEqual(res, { contactId: null, count: 0 })
  })

  it('returns null with count 0 when no contact matches', async () => {
    const res = await resolveSingleContact('t1', 'nobody@example.com', mockDb([]))
    assert.deepEqual(res, { contactId: null, count: 0 })
  })

  it('links when exactly one active contact matches', async () => {
    const db = mockDb([{ id: 'c1', data: active('a@example.com') }])
    const res = await resolveSingleContact('t1', 'a@example.com', db)
    assert.deepEqual(res, { contactId: 'c1', count: 1 })
  })

  it('normalizes the email before matching', async () => {
    const db = mockDb([{ id: 'c1', data: active('a@example.com') }])
    const res = await resolveSingleContact('t1', '  A@Example.com ', db)
    assert.equal(res.contactId, 'c1')
  })

  it('returns null (ambiguous) when multiple active contacts share the email', async () => {
    const db = mockDb([
      { id: 'c1', data: active('family@example.com') },
      { id: 'c2', data: active('family@example.com') },
    ])
    const res = await resolveSingleContact('t1', 'family@example.com', db)
    assert.deepEqual(res, { contactId: null, count: 2 })
  })

  it('ignores archived and deleted contacts, leaving one active match', async () => {
    const db = mockDb([
      { id: 'c1', data: active('a@example.com') },
      { id: 'c2', data: { teamId: 't1', email: 'a@example.com', archived_at: 123, deleted_at: null } },
      { id: 'c3', data: { teamId: 't1', email: 'a@example.com', archived_at: null, deleted_at: 456 } },
    ])
    const res = await resolveSingleContact('t1', 'a@example.com', db)
    assert.deepEqual(res, { contactId: 'c1', count: 1 })
  })
})
