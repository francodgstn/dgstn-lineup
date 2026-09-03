import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// Security-rules test for the `app_settings` collection's two postures:
//
//   app_settings/public  and  app_settings/mobile   → world-readable, never
//     client-writable. The member app reads `mobile` (minimum supported
//     version + store links) BEFORE anyone has signed in.
//   everything else — `review_access` above all — → default-deny. That doc
//     holds a fixed sign-in code; a client read of it would be a credential
//     leak, and the rules file has no match for it on purpose.
//
//   pnpm --filter @linyup/functions test:rules

function findRules(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'firestore.rules')
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8')
    dir = path.dirname(dir)
  }
  throw new Error('firestore.rules not found above ' + process.cwd())
}

const RULES = findRules()
let testEnv: RulesTestEnvironment

const anonymous = () => testEnv.unauthenticatedContext().firestore()
const contactSession = () =>
  testEnv
    .authenticatedContext('contact:cAS', {
      contactId: 'cAS',
      teamId: 'tAS',
      sessionExpires: Date.now() + 3_600_000,
    })
    .firestore()

describe('firestore.rules — app_settings: two public docs, everything else denied', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-app-settings',
      firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
    })
  })
  after(async () => {
    await testEnv?.cleanup()
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'app_settings', 'public'), { public_signup_enabled: true })
      await setDoc(doc(db, 'app_settings', 'mobile'), { min_supported_version: '1.0.0' })
      await setDoc(doc(db, 'app_settings', 'review_access'), {
        enabled: true,
        email: 'app.review@example.com',
        code: '123456',
      })
    })
  })

  it('app_settings/mobile is readable with no auth at all', async () => {
    await assertSucceeds(getDoc(doc(anonymous(), 'app_settings', 'mobile')))
  })

  it('app_settings/mobile is readable by a contact session', async () => {
    await assertSucceeds(getDoc(doc(contactSession(), 'app_settings', 'mobile')))
  })

  it('app_settings/mobile is never client-writable', async () => {
    await assertFails(
      setDoc(doc(anonymous(), 'app_settings', 'mobile'), { min_supported_version: '9.9.9' })
    )
    await assertFails(
      setDoc(doc(contactSession(), 'app_settings', 'mobile'), { min_supported_version: '9.9.9' })
    )
  })

  it('app_settings/public stays readable (the signup flag the web reads)', async () => {
    await assertSucceeds(getDoc(doc(anonymous(), 'app_settings', 'public')))
  })

  it('app_settings/review_access is DENIED to everyone — it holds a sign-in code', async () => {
    await assertFails(getDoc(doc(anonymous(), 'app_settings', 'review_access')))
    await assertFails(getDoc(doc(contactSession(), 'app_settings', 'review_access')))
    await assertFails(
      setDoc(doc(contactSession(), 'app_settings', 'review_access'), { enabled: false })
    )
  })
})
