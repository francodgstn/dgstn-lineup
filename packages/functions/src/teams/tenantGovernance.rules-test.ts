import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

// Security-rules tests for the OPERATOR-OWNED fields on a team document.
//
// `plan`, `plan_status`, `trial_ends_at` and `flags` decide what a studio is
// entitled to, until when, and whether it counts toward platform metrics or can
// be lapsed by the trial sweep. `TenantFlags`' doc comment has always said
// "Operator-set only; never client-writable" — but only `payments` was actually
// guarded, so a team OWNER could grant themselves a plan, clear an expiring
// trial, or set `flags.internal` and vanish from every platform number.
//
// That gap stops being theoretical the moment an owner login is shared, which
// is exactly what a demo tenant is for. These tests are what keep it shut.
//
// Needs the Firestore emulator, so it is NOT part of the default `test` script:
//   pnpm --filter @linyup/functions test:rules

const PROJECT_ID = 'demo-linyup-governance'

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
const TEAM = 'teamA'

let testEnv: RulesTestEnvironment

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'teams', TEAM), {
      name: 'Team A',
      slug: 'team-a',
      plan: 'free',
      plan_status: 'active',
      trial_ends_at: null,
      flags: {},
      payments: {},
      createdBy: 'ownerA',
    })
    await setDoc(doc(db, 'teams', TEAM, 'team_members', 'ownerA'), { role: 'owner', capabilities: [] })
    await setDoc(doc(db, 'teams', TEAM, 'team_members', 'managerA'), { role: 'manager', capabilities: [] })
    await setDoc(doc(db, 'users', 'ownerA'), { currentTeam: TEAM })
    await setDoc(doc(db, 'users', 'managerA'), { currentTeam: TEAM })
  })
}

const asOwner = () => testEnv.authenticatedContext('ownerA').firestore()
const teamDoc = (db: ReturnType<typeof asOwner>) => doc(db, 'teams', TEAM)

describe('firestore.rules — tenant governance fields', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
    })
  })

  after(async () => {
    await testEnv?.cleanup()
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await seed()
  })

  it('an owner can still edit ordinary team details', async () => {
    const db = asOwner()
    await assertSucceeds(getDoc(teamDoc(db)))
    await assertSucceeds(updateDoc(teamDoc(db), { name: 'Renamed', description: 'Hello' }))
  })

  it('an owner CANNOT grant themselves a plan', async () => {
    await assertFails(updateDoc(teamDoc(asOwner()), { plan: 'organization' }))
  })

  it('an owner CANNOT change plan_status or extend a trial', async () => {
    // The seed is plan_status 'active', so the write has to CHANGE it — the
    // guard compares values, not key presence, so re-writing the same value is
    // a no-op and is deliberately allowed (an idempotent save must not fail).
    await assertFails(updateDoc(teamDoc(asOwner()), { plan_status: 'trial' }))
    await assertFails(
      updateDoc(teamDoc(asOwner()), { trial_ends_at: new Date(Date.now() + 9e8) })
    )
  })

  it('re-writing an unchanged governed value is allowed — it changes nothing', async () => {
    // Not a loophole: a settings form that round-trips the whole document must
    // still be able to save. What the guard stops is a DIFFERENT value.
    await assertSucceeds(updateDoc(teamDoc(asOwner()), { plan_status: 'active', plan: 'free' }))
  })

  it('an owner CANNOT set flags.internal and disappear from platform metrics', async () => {
    await assertFails(updateDoc(teamDoc(asOwner()), { flags: { internal: true } }))
    await assertFails(updateDoc(teamDoc(asOwner()), { flags: { comped: true } }))
  })

  it('the payments guard still holds', async () => {
    await assertFails(updateDoc(teamDoc(asOwner()), { payments: { connectEnabled: true } }))
  })

  it('a legitimate edit that leaves every governed field untouched succeeds', async () => {
    // The shape the settings form actually writes: unrelated keys only. If this
    // ever fails, the guard has become too broad and studios cannot edit
    // themselves.
    const db = asOwner()
    await assertSucceeds(
      updateDoc(teamDoc(db), { name: 'Studio A', sport_type: 'bjj', settings: { booking: {} } })
    )
    // `withSecurityRulesDisabled` resolves void, so read into a local.
    let plan: unknown
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'teams', TEAM))
      plan = snap.data()?.plan
    })
    assert.equal(plan, 'free', 'plan must be untouched by an ordinary edit')
  })

  it('SIGNUP still works — create carries plan and trial, and is not an update', async () => {
    // `provisionTeam` (apps/web/src/lib/provisioning.ts) writes plan/plan_status/
    // trial_ends_at on the CREATE. The guard is on update only, and this is what
    // proves self-service signup was not collateral damage.
    const db = testEnv.authenticatedContext('newOwner').firestore()
    await assertSucceeds(
      setDoc(doc(db, 'teams', 'brandNewTeam'), {
        name: 'Brand New',
        slug: 'brand-new',
        plan: 'studio',
        plan_status: 'trial',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        createdBy: 'newOwner',
      })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// team_members SELF-PROVISION — the regression net for the 2026-08-26 takeover.
//
// The signup rule that lets a new owner write their OWN membership used to be
// tied to nothing about `teamId`, so any authenticated principal (a passwordless
// `contact:` session included) could write an owner membership into someone
// else's team and, because `hasTeamRole` reads the role off that very doc,
// become its owner. It was reproduced end-to-end before the fix; these are the
// tests that keep it shut.
//
// Runs against the isolated `demo-linyup-*` emulator only.
describe('firestore.rules — team_members self-provision', function () {
  this.timeout(30_000)

  const VICTIM = 'victimTeam'
  // Shaped like a passwordless CONTACT session uid (`contact:{id}`), because
  // that was the cheapest identity that reached the hole.
  const ATTACKER = 'contact:attacker-1'

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-takeover',
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
      await setDoc(doc(db, 'teams', VICTIM), {
        name: 'Victim Studio',
        slug: 'victim-studio',
        plan: 'studio',
        createdBy: 'realOwner',
      })
      await setDoc(doc(db, 'teams', VICTIM, 'team_members', 'realOwner'), {
        role: 'owner',
        capabilities: [],
      })
      // A manager who legitimately belongs to the victim team — for the
      // self-escalation guard below.
      await setDoc(doc(db, 'teams', VICTIM, 'team_members', 'managerV'), {
        role: 'manager',
        capabilities: [],
      })
    })
  })

  it('a stranger CANNOT self-provision owner on a team they did not create', async () => {
    // THE takeover write. This is the one that used to succeed.
    const db = testEnv.authenticatedContext(ATTACKER).firestore()
    await assertFails(
      setDoc(doc(db, 'teams', VICTIM, 'team_members', ATTACKER), {
        role: 'owner',
        userId: ATTACKER,
      })
    )
  })

  it('a stranger CANNOT self-provision a NON-owner role either', async () => {
    // The first disjunct needs owner ROLE (they have none); the second needs
    // createdBy (not them). A viewer seat is refused for the same reason.
    const db = testEnv.authenticatedContext(ATTACKER).firestore()
    await assertFails(
      setDoc(doc(db, 'teams', VICTIM, 'team_members', ATTACKER), {
        role: 'viewer',
        userId: ATTACKER,
      })
    )
  })

  it('an existing member CANNOT rewrite their own doc to escalate to owner', async () => {
    // resource != null, so the create-only self-provision branch does not apply;
    // and they are not an owner, so the owner branch does not either. This is the
    // half of the fix that `resource == null` provides.
    const db = testEnv.authenticatedContext('managerV').firestore()
    await assertFails(
      updateDoc(doc(db, 'teams', VICTIM, 'team_members', 'managerV'), { role: 'owner' })
    )
  })

  it('the real signup path still works — creator writes their own owner doc', async () => {
    // provisionTeam writes the team doc (createdBy = self) then the owner
    // membership, both as the creator. The fix must not break this.
    const uid = 'freshOwner'
    const db = testEnv.authenticatedContext(uid).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'teams', 'freshTeam'), {
        name: 'Fresh',
        slug: 'fresh',
        plan: 'studio',
        plan_status: 'trial',
        createdBy: uid,
      })
    )
    await assertSucceeds(
      setDoc(doc(db, 'teams', 'freshTeam', 'team_members', uid), { role: 'owner', userId: uid })
    )
  })

  it('an owner can still add a co-owner on a paid plan (the studio seat feature)', async () => {
    // The first disjunct: an owner on studio/org may write SOMEBODY ELSE'S
    // membership. Proves the fix did not touch the legitimate multi-user path.
    const db = testEnv.authenticatedContext('realOwner').firestore()
    await assertSucceeds(
      setDoc(doc(db, 'teams', VICTIM, 'team_members', 'invitedUser'), {
        role: 'manager',
        userId: 'invitedUser',
      })
    )
  })
})
