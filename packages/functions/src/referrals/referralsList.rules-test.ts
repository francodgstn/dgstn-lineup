import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'

// Security-rules tests for the `referrals` collection LIST rule.
//
// It used to be `allow list: if isAuthed()`, with a comment admitting security
// "relies on the app always filtering by team_id". Client-side filtering is not
// enforcement: any authenticated principal (a contact session included) could
// `getDocs(collection('referrals'))` and read every studio's referral graph and
// reward amounts. The rule now references resource.data.team_id, so Firestore
// admits the query ONLY when it is scoped to a team the caller belongs to.
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
const MY_TEAM = 'teamMine'
const OTHER_TEAM = 'teamOther'

let testEnv: RulesTestEnvironment

describe('firestore.rules — referrals list scoping', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-referrals',
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
      // memberMine belongs to MY_TEAM only.
      await setDoc(doc(db, 'teams', MY_TEAM, 'team_members', 'memberMine'), { role: 'manager' })
      await setDoc(doc(db, 'users', 'memberMine'), { currentTeam: MY_TEAM })
      // One referral in each team, so an unscoped list would span tenants.
      await setDoc(doc(db, 'referrals', 'r_mine'), {
        team_id: MY_TEAM,
        referrer_contact_id: 'c1',
        referred_contact_id: 'c2',
        status: 'friend_booked',
      })
      await setDoc(doc(db, 'referrals', 'r_other'), {
        team_id: OTHER_TEAM,
        referrer_contact_id: 'c3',
        referred_contact_id: 'c4',
        status: 'friend_booked',
      })
    })
  })

  it('an unscoped list of all referrals is REFUSED (the cross-tenant harvest)', async () => {
    const db = testEnv.authenticatedContext('memberMine').firestore()
    await assertFails(getDocs(query(collection(db, 'referrals'))))
  })

  it('a member CAN list referrals scoped to their own team', async () => {
    const db = testEnv.authenticatedContext('memberMine').firestore()
    await assertSucceeds(
      getDocs(query(collection(db, 'referrals'), where('team_id', '==', MY_TEAM)))
    )
  })

  it('a member CANNOT list another team’s referrals, even scoped', async () => {
    const db = testEnv.authenticatedContext('memberMine').firestore()
    await assertFails(
      getDocs(query(collection(db, 'referrals'), where('team_id', '==', OTHER_TEAM)))
    )
  })

  it('a stranger who belongs to no team cannot list any referrals', async () => {
    const db = testEnv.authenticatedContext('stranger').firestore()
    await assertFails(getDocs(query(collection(db, 'referrals'), where('team_id', '==', MY_TEAM))))
  })
})
