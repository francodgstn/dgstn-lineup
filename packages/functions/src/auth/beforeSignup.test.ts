import assert from 'node:assert/strict'
import type * as admin from 'firebase-admin'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  SIGNUP_ALLOWLIST_COLLECTION,
} from '@linyup/shared'
import { isSignupAllowed } from './beforeSignup'

// Minimal Firestore stand-in: only the collection().doc().get() path the gate
// touches. allowlist = set of doc ids that "exist"; publicDoc = the data of
// app_settings/public (undefined = missing); throwOnPublic = simulate a read error.
function mockDb(opts: {
  allowlist?: Set<string>
  publicDoc?: Record<string, unknown>
  throwOnPublic?: boolean
}): admin.firestore.Firestore {
  const allowlist = opts.allowlist ?? new Set<string>()
  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return {
            async get() {
              if (name === SIGNUP_ALLOWLIST_COLLECTION) {
                return { exists: allowlist.has(id) }
              }
              if (name === APP_SETTINGS_COLLECTION && id === PUBLIC_SETTINGS_DOC) {
                if (opts.throwOnPublic) throw new Error('simulated read failure')
                return { exists: opts.publicDoc !== undefined, data: () => opts.publicDoc }
              }
              return { exists: false }
            },
          }
        },
      }
    },
  } as unknown as admin.firestore.Firestore
}

describe('isSignupAllowed', () => {
  it('allows an allowlisted email even when public signup is closed', async () => {
    const db = mockDb({
      allowlist: new Set(['coach@example.com']),
      publicDoc: { public_signup_enabled: false },
    })
    assert.equal(await isSignupAllowed(db, 'coach@example.com'), true)
  })

  it('allows any email when public signup is open', async () => {
    const db = mockDb({ publicDoc: { public_signup_enabled: true } })
    assert.equal(await isSignupAllowed(db, 'stranger@example.com'), true)
  })

  it('blocks a non-allowlisted email when public signup is closed', async () => {
    const db = mockDb({ publicDoc: { public_signup_enabled: false } })
    assert.equal(await isSignupAllowed(db, 'stranger@example.com'), false)
  })

  it('fails closed when the public flag doc is missing', async () => {
    const db = mockDb({}) // no publicDoc, no allowlist
    assert.equal(await isSignupAllowed(db, 'stranger@example.com'), false)
  })

  it('fails closed when the flag read errors', async () => {
    const db = mockDb({ throwOnPublic: true })
    assert.equal(await isSignupAllowed(db, 'stranger@example.com'), false)
  })

  it('blocks an emailless identity when signup is closed', async () => {
    const db = mockDb({ publicDoc: { public_signup_enabled: false } })
    assert.equal(await isSignupAllowed(db, null), false)
  })

  it('allows an emailless identity when signup is open', async () => {
    const db = mockDb({ publicDoc: { public_signup_enabled: true } })
    assert.equal(await isSignupAllowed(db, null), true)
  })
})
