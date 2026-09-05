import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// Security-rules test for the asset register (teams/{id}/asset_register).
//
// The access matrix, which is NOT the same on both axes and is the whole point
// of the test: a MANAGER maintains the list (the head coach is the person who
// knows what kit exists), a COACH sees none of it (equipment cost is not
// coach-visible), and nobody outside the team touches it at all.
//
// Manager-write is safe only while the ledger is cash-basis and no posting
// reads these docs; the accrual phase routes writes through callables, and
// this test is what should fail loudly when that happens.
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
const TEAM = 'teamAR'
const OTHER_TEAM = 'teamAR2'
const ASSET = 'assetAR'

let testEnv: RulesTestEnvironment

const asUser = (uid: string) => testEnv.authenticatedContext(uid).firestore()

const assetDoc = (db: ReturnType<typeof asUser>, team = TEAM) =>
  doc(db, 'teams', team, 'asset_register', ASSET)

describe('firestore.rules — asset_register access', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-asset-register',
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
      await setDoc(assetDoc(db as never), {
        id: ASSET,
        teamId: TEAM,
        name: 'Tatami mats',
        category: 'leasehold',
        cost_minor: 1_240_000,
        quantity: 1,
        useful_life_months: 120,
        status: 'active',
      })
      for (const [uid, role] of [
        ['ownerAR', 'owner'],
        ['managerAR', 'manager'],
        ['coachAR', 'coach'],
      ] as const) {
        await setDoc(doc(db, 'teams', TEAM, 'team_members', uid), { role })
        await setDoc(doc(db, 'users', uid), { currentTeam: TEAM })
      }
      // A manager of a DIFFERENT team — the tenant boundary.
      await setDoc(doc(db, 'teams', OTHER_TEAM, 'team_members', 'outsiderAR'), { role: 'manager' })
      await setDoc(doc(db, 'users', 'outsiderAR'), { currentTeam: OTHER_TEAM })
    })
  })

  it('an owner reads and writes', async () => {
    const db = asUser('ownerAR')
    await assertSucceeds(getDoc(assetDoc(db)))
    await assertSucceeds(setDoc(assetDoc(db), { name: 'Tatami mats (renewed)' }, { merge: true }))
  })

  it('a MANAGER reads and writes — the head coach maintains the kit list', async () => {
    const db = asUser('managerAR')
    await assertSucceeds(getDoc(assetDoc(db)))
    await assertSucceeds(setDoc(assetDoc(db), { quantity: 2 }, { merge: true }))
  })

  it('a coach reads nothing — equipment cost is not coach-visible', async () => {
    const db = asUser('coachAR')
    await assertFails(getDoc(assetDoc(db)))
    await assertFails(setDoc(assetDoc(db), { quantity: 99 }, { merge: true }))
  })

  it('a manager of another team is refused on both axes', async () => {
    const db = asUser('outsiderAR')
    await assertFails(getDoc(assetDoc(db)))
    await assertFails(setDoc(assetDoc(db), { quantity: 99 }, { merge: true }))
  })

  it('an unauthenticated client is refused', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(assetDoc(db as never)))
    await assertFails(setDoc(assetDoc(db as never), { quantity: 99 }, { merge: true }))
  })
})
