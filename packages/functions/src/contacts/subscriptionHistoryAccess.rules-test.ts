import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, deleteDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

// Security-rules test for `contacts/{contactId}/subscription_history` — the ONLY
// store of a contact's plan PERIODS.
//
// `onContactSubscriptionChange` (packages/functions/src/sync/) is the SINGLE
// writer of periods (create + update); a client write racing its set-difference
// reconciliation could open/close a row the trigger doesn't know about and fork
// the two plans' periods apart. `delete` stays open for a team member with
// `contacts.manage` — the contact detail page's per-row trash button
// (`contacts/[id]/page.tsx`) genuinely uses it, and removing a bad record is not
// the same integrity risk as writing one.
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
const TEAM = 'teamSubHist'
const CONTACT = 'contactSubHist'
const MEMBER = 'memberSubHist'
const OUTSIDER = 'outsiderSubHist'

let testEnv: RulesTestEnvironment

const memberDb = () => testEnv.authenticatedContext(MEMBER).firestore()
const outsiderDb = () => testEnv.authenticatedContext(OUTSIDER).firestore()

describe('firestore.rules — contacts/{id}/subscription_history', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-sub-history',
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
      await setDoc(doc(db, 'contacts', CONTACT), { teamId: TEAM, firstname: 'Robin' })
      await setDoc(doc(db, 'contacts', CONTACT, 'subscription_history', 'row1'), {
        subscription_type_id: 'sub-a',
        start_date: new Date(),
        end_date: null,
      })
      // A full-access team member (owner — bypasses the capabilities check).
      await setDoc(doc(db, 'teams', TEAM, 'team_members', MEMBER), { role: 'owner' })
      await setDoc(doc(db, 'users', MEMBER), { currentTeam: TEAM })
      // An authenticated user with no relationship to this team at all.
      await setDoc(doc(db, 'users', OUTSIDER), { currentTeam: 'someOtherTeam' })
    })
  })

  it('a team member CAN delete a row (the contact detail page trash button)', async () => {
    await assertSucceeds(deleteDoc(doc(memberDb(), 'contacts', CONTACT, 'subscription_history', 'row1')))
  })

  it('a team member CANNOT create a row — the trigger is the single writer of periods', async () => {
    await assertFails(
      setDoc(doc(memberDb(), 'contacts', CONTACT, 'subscription_history', 'row2'), {
        subscription_type_id: 'sub-b',
        start_date: new Date(),
        end_date: null,
      })
    )
  })

  it('a team member CANNOT update a row — not even to close it manually', async () => {
    await assertFails(
      updateDoc(doc(memberDb(), 'contacts', CONTACT, 'subscription_history', 'row1'), {
        end_date: new Date(),
      })
    )
  })

  it('a non-member CANNOT read the history', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'contacts', CONTACT, 'subscription_history', 'row1')))
  })
})
