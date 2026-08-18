import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

// Security-rules tests for the event program. This is a MULTI-TENANT boundary:
// program items carry denormalised teamId/orgId/scope precisely so the rules can
// authorise them without a get() on the parent event, and these tests are what
// keep that contract honest.
//
// Needs the Firestore emulator, so it is NOT part of the default `test` script:
//   pnpm --filter @linyup/functions test:rules

const PROJECT_ID = 'demo-linyup-rules'

/** Walk up from the working directory to the repo root's firestore.rules, so
 *  this works whether mocha is invoked from the package or the workspace root
 *  (and regardless of CJS/ESM, where __dirname may be unavailable). */
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

const TEAM_A = 'teamA'
const TEAM_B = 'teamB'
const ORG = 'org1'

const EVENT_TEAM = 'eventTeam'
const EVENT_ORG = 'eventOrg'

let testEnv: RulesTestEnvironment

// ── fixtures ─────────────────────────────────────────────────────────────────
// Written with rules disabled so the tests exercise the rules under test, not
// the setup path.
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()

    await setDoc(doc(db, 'teams', TEAM_A), { name: 'Team A', org_id: ORG })
    await setDoc(doc(db, 'teams', TEAM_B), { name: 'Team B' })

    // Team A: a manager with the events capability, and a viewer without it.
    await setDoc(doc(db, 'teams', TEAM_A, 'team_members', 'managerA'), {
      role: 'manager', capabilities: ['events.manage'],
    })
    await setDoc(doc(db, 'teams', TEAM_A, 'team_members', 'viewerA'), {
      role: 'viewer', capabilities: [],
    })
    await setDoc(doc(db, 'teams', TEAM_B, 'team_members', 'managerB'), {
      role: 'manager', capabilities: ['events.manage'],
    })

    await setDoc(doc(db, 'users', 'managerA'), { currentTeam: TEAM_A })
    await setDoc(doc(db, 'users', 'viewerA'), { currentTeam: TEAM_A })
    await setDoc(doc(db, 'users', 'managerB'), { currentTeam: TEAM_B })
    await setDoc(doc(db, 'users', 'orgAdmin'), { currentTeam: TEAM_A })

    await setDoc(doc(db, 'organizations', ORG), { name: 'Federation' })
    await setDoc(doc(db, 'organizations', ORG, 'org_members', 'orgAdmin'), {
      role: 'org_admin',
    })

    // A team-scoped event and an org-scoped one (the latter has NO teamId —
    // that is exactly what used to lock org events out of their subcollections).
    await setDoc(doc(db, 'events', EVENT_TEAM), {
      teamId: TEAM_A, scope: 'team', title: 'Team camp', deleted_at: null,
    })
    await setDoc(doc(db, 'events', EVENT_ORG), {
      teamId: null, orgId: ORG, scope: 'org', title: 'Federation cup', deleted_at: null,
    })

    // Existing items to exercise update/delete/read.
    await setDoc(doc(db, 'events', EVENT_TEAM, 'program_items', 'i1'), {
      eventId: EVENT_TEAM, teamId: TEAM_A, scope: 'team',
      dayId: 'd1', startTime: '09:00', title: 'Warm-up', order: 0,
    })
    await setDoc(doc(db, 'events', EVENT_ORG, 'program_items', 'i2'), {
      eventId: EVENT_ORG, orgId: ORG, scope: 'org',
      dayId: 'd1', startTime: '09:00', title: 'Weigh-in', order: 0,
    })

    await setDoc(doc(db, 'events', EVENT_ORG, 'categories', 'c1'), { name: 'U18' })
    await setDoc(doc(db, 'events', EVENT_ORG, 'attendees', 'a1'), { contactId: 'c1' })
  })
}

const asManagerA = () => testEnv.authenticatedContext('managerA').firestore()
const asViewerA = () => testEnv.authenticatedContext('viewerA').firestore()
const asManagerB = () => testEnv.authenticatedContext('managerB').firestore()
const asOrgAdmin = () => testEnv.authenticatedContext('orgAdmin').firestore()
const asAnon = () => testEnv.unauthenticatedContext().firestore()

const teamItem = (db: ReturnType<typeof asManagerA>, id = 'i1') =>
  doc(db, 'events', EVENT_TEAM, 'program_items', id)
const orgItem = (db: ReturnType<typeof asManagerA>, id = 'i2') =>
  doc(db, 'events', EVENT_ORG, 'program_items', id)

const NEW_TEAM_ITEM = {
  eventId: EVENT_TEAM, teamId: TEAM_A, scope: 'team',
  dayId: 'd1', startTime: '10:00', title: 'New', order: 1,
}
const NEW_ORG_ITEM = {
  eventId: EVENT_ORG, orgId: ORG, scope: 'org',
  dayId: 'd1', startTime: '10:00', title: 'New', order: 1,
}

describe('firestore.rules — event program items', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
    })
  })

  after(async () => { await testEnv?.cleanup() })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await seed()
  })

  describe('team-scoped event', () => {
    it('a manager with events.manage can read, create, update and delete items', async () => {
      const db = asManagerA()
      await assertSucceeds(getDoc(teamItem(db)))
      await assertSucceeds(setDoc(teamItem(db, 'new1'), NEW_TEAM_ITEM))
      await assertSucceeds(updateDoc(teamItem(db), { title: 'Renamed' }))
      await assertSucceeds(deleteDoc(teamItem(db)))
    })

    it('a viewer may read but never write', async () => {
      const db = asViewerA()
      await assertSucceeds(getDoc(teamItem(db)))
      await assertFails(setDoc(teamItem(db, 'new2'), NEW_TEAM_ITEM))
      await assertFails(updateDoc(teamItem(db), { title: 'Nope' }))
      await assertFails(deleteDoc(teamItem(db)))
    })

    it('another team cannot read or write — the tenant boundary holds', async () => {
      const db = asManagerB()
      await assertFails(getDoc(teamItem(db)))
      await assertFails(updateDoc(teamItem(db), { title: 'Nope' }))
      await assertFails(deleteDoc(teamItem(db)))
    })

    it('a manager cannot forge an item onto another team', async () => {
      // Writing into team A's event but stamping team B's id must fail: the
      // capability is checked against the id ON the document being written.
      await assertFails(
        setDoc(teamItem(asManagerB(), 'forged'), { ...NEW_TEAM_ITEM, teamId: TEAM_B }),
      )
    })

    it('an anonymous visitor is refused', async () => {
      const db = asAnon()
      await assertFails(getDoc(teamItem(db)))
      await assertFails(setDoc(teamItem(db, 'anon'), NEW_TEAM_ITEM))
    })

    it('an org admin of the parent org can read a member team\'s items', async () => {
      await assertSucceeds(getDoc(teamItem(asOrgAdmin())))
    })
  })

  describe('org-scoped event (no teamId)', () => {
    it('an org admin can read, create, update and delete items', async () => {
      const db = asOrgAdmin()
      await assertSucceeds(getDoc(orgItem(db)))
      await assertSucceeds(setDoc(orgItem(db, 'newOrg'), NEW_ORG_ITEM))
      await assertSucceeds(updateDoc(orgItem(db), { title: 'Renamed' }))
      await assertSucceeds(deleteDoc(orgItem(db)))
    })

    it('a member studio can read the org programme but not edit it', async () => {
      const db = asManagerA()
      await assertSucceeds(getDoc(orgItem(db)))
      await assertFails(updateDoc(orgItem(db), { title: 'Nope' }))
      await assertFails(deleteDoc(orgItem(db)))
    })

    it('a studio outside the org is refused entirely', async () => {
      const db = asManagerB()
      await assertFails(getDoc(orgItem(db)))
      await assertFails(setDoc(orgItem(db, 'nope'), NEW_ORG_ITEM))
    })
  })

  // Regression: both blocks used to gate ONLY on belongsToUserTeam(parent),
  // which can never pass for an org event because its teamId is null.
  describe('regression — org-scoped categories & attendees', () => {
    it('an org admin can now manage categories on an org event', async () => {
      const db = asOrgAdmin()
      const ref = doc(db, 'events', EVENT_ORG, 'categories', 'c1')
      await assertSucceeds(getDoc(ref))
      await assertSucceeds(updateDoc(ref, { name: 'U21' }))
    })

    it('an org admin can now read the roster on an org event', async () => {
      await assertSucceeds(
        getDoc(doc(asOrgAdmin(), 'events', EVENT_ORG, 'attendees', 'a1')),
      )
    })

    it('attendees stay function-only for everyone', async () => {
      await assertFails(
        setDoc(doc(asOrgAdmin(), 'events', EVENT_ORG, 'attendees', 'a2'), { contactId: 'x' }),
      )
    })

    it('an unrelated team still cannot reach either subcollection', async () => {
      const db = asManagerB()
      await assertFails(getDoc(doc(db, 'events', EVENT_ORG, 'categories', 'c1')))
      await assertFails(getDoc(doc(db, 'events', EVENT_ORG, 'attendees', 'a1')))
    })
  })

  describe('program templates', () => {
    it('a manager manages team templates; another team cannot read them', async () => {
      const ref = (db: ReturnType<typeof asManagerA>) =>
        doc(db, 'teams', TEAM_A, 'program_templates', 't1')
      await assertSucceeds(setDoc(ref(asManagerA()), { name: 'Camp', scope: 'team', teamId: TEAM_A }))
      await assertSucceeds(getDoc(ref(asManagerA())))
      await assertFails(getDoc(ref(asManagerB())))
      await assertFails(setDoc(ref(asViewerA()), { name: 'Nope' }))
    })

    it('org templates are writable by the org admin and read-only for member studios', async () => {
      const ref = (db: ReturnType<typeof asManagerA>) =>
        doc(db, 'organizations', ORG, 'org_program_templates', 'ot1')
      await assertSucceeds(setDoc(ref(asOrgAdmin()), { name: 'Federation camp', scope: 'org', orgId: ORG }))
      // A member studio may apply it…
      await assertSucceeds(getDoc(ref(asManagerA())))
      // …but never write to it.
      await assertFails(setDoc(ref(asManagerA()), { name: 'Hijacked' }))
      // A studio outside the org sees nothing.
      await assertFails(getDoc(ref(asManagerB())))
    })
  })

  it('the denormalised tenant fields are what authorise an item', async () => {
    // An item with no tenant stamp at all must be refused — this is the
    // invariant the whole no-get() design rests on.
    await assertFails(
      setDoc(teamItem(asManagerA(), 'untagged'), {
        eventId: EVENT_TEAM, dayId: 'd1', startTime: '10:00', title: 'Untagged', order: 0,
      }),
    )
    assert.ok(true)
  })
})
