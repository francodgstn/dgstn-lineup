import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// Security-rules test for the contact-notes self-read exclusion.
//
// The contacts subcollection catch-all grants a contact's own session
// (isSelfContact) read on every subcollection. `contact_notes` is the studio's
// PRIVATE staff commentary about a contact and must NOT be readable by that
// contact — the catch-all now withholds the contact-facing predicates for it
// while every other subcollection keeps the self-read.
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
const TEAM = 'teamN'
const CONTACT = 'contactN'

let testEnv: RulesTestEnvironment

const contactSession = () =>
  testEnv
    .authenticatedContext('contact:' + CONTACT, {
      contactId: CONTACT,
      teamId: TEAM,
      sessionExpires: Date.now() + 3_600_000,
    })
    .firestore()

describe('firestore.rules — contact_notes self-read exclusion', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-contact-notes',
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
      await setDoc(doc(db, 'contacts', CONTACT), { teamId: TEAM, firstname: 'Nadia' })
      // The staff-private note, and a benign self-readable subcollection doc.
      await setDoc(doc(db, 'contacts', CONTACT, 'contact_notes', 'n1'), {
        content: 'Behind on payments; watch attendance.',
        source: 'staff',
      })
      await setDoc(doc(db, 'contacts', CONTACT, 'misc', 'm1'), { anything: true })
      // A staff member of the team.
      await setDoc(doc(db, 'teams', TEAM, 'team_members', 'staffN'), { role: 'manager' })
      await setDoc(doc(db, 'users', 'staffN'), { currentTeam: TEAM })
    })
  })

  it('a contact CANNOT read the studio’s private notes about itself', async () => {
    const db = contactSession()
    await assertFails(getDoc(doc(db, 'contacts', CONTACT, 'contact_notes', 'n1')))
  })

  it('a contact CAN still read its own other subcollection docs (self-read intact)', async () => {
    const db = contactSession()
    await assertSucceeds(getDoc(doc(db, 'contacts', CONTACT, 'misc', 'm1')))
  })

  it('team staff CAN still read contact_notes', async () => {
    const db = testEnv.authenticatedContext('staffN').firestore()
    await assertSucceeds(getDoc(doc(db, 'contacts', CONTACT, 'contact_notes', 'n1')))
  })
})
