import assert from 'node:assert/strict'
import type * as admin from 'firebase-admin'
import { createTeamNotification } from './teamNotifications'

// Minimal Firestore stand-in: collection(teams).doc(teamId).collection(notifications).doc().set(data),
// capturing whatever the helper actually writes. Same DI shape as
// resolveSingleContact (utils/contacts.ts) — the helper accepts an injectable
// `db` precisely so it can be unit-tested without the Admin SDK / an emulator.
function mockDb(): { db: admin.firestore.Firestore; captured: () => Record<string, unknown> | undefined } {
  let written: Record<string, unknown> | undefined
  const notificationDocRef = {
    id: 'generated-id',
    async set(data: Record<string, unknown>) {
      written = data
    },
  }
  const notificationsCollection = { doc: () => notificationDocRef }
  const teamDocRef = { collection: () => notificationsCollection }
  const teamsCollection = { doc: () => teamDocRef }
  const db = { collection: () => teamsCollection } as unknown as admin.firestore.Firestore
  return { db, captured: () => written }
}

describe('createTeamNotification — the ONE writer of teams/{teamId}/notifications', () => {
  it('always sets status to unread, whatever the caller passes', async () => {
    const { db, captured } = mockDb()
    await createTeamNotification(
      't1',
      { type: 'org_access_request', title: 'Access request', body: 'body' },
      db
    )
    assert.equal(captured()?.status, 'unread')
  })

  it('sets created_at itself — the caller cannot supply one', async () => {
    const { db, captured } = mockDb()
    await createTeamNotification('t1', { type: 'form_submission', title: 't', body: 'b' }, db)
    const createdAt = captured()?.created_at
    assert.ok(createdAt !== undefined && createdAt !== null, 'created_at must be set')
  })

  it('passes a supplied link through untouched', async () => {
    const { db, captured } = mockDb()
    await createTeamNotification(
      't1',
      { type: 'contact_request', title: 't', body: 'b', link: '/contacts?tab=requests' },
      db
    )
    assert.equal(captured()?.link, '/contacts?tab=requests')
  })

  it('defaults an absent link to null, never undefined', async () => {
    const { db, captured } = mockDb()
    await createTeamNotification('t1', { type: 'org_access_request', title: 't', body: 'b' }, db)
    assert.equal(captured()?.link, null)
  })

  it('forwards the type-specific payload fields whole', async () => {
    const { db, captured } = mockDb()
    await createTeamNotification(
      't1',
      {
        type: 'form_submission',
        title: 't',
        body: 'b',
        link: '/plugins/custom-forms/f1?tab=responses',
        form_id: 'f1',
        submission_id: 's1',
        contact_id: 'c1',
      },
      db
    )
    const data = captured()
    assert.equal(data?.form_id, 'f1')
    assert.equal(data?.submission_id, 's1')
    assert.equal(data?.contact_id, 'c1')
  })
})
