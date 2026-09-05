import fs from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

// Security-rules test for `contacts/{contactId}/push_tokens/{token}` (see
// `PushToken`, packages/shared/src/types/push.ts).
//
// Nothing but the token's own contact session may touch it — no staff arm,
// no `hasRole('admin')` arm, unlike every other contact subcollection. And it
// must be excluded from BOTH the read AND write grant of the generic
// `contacts/{contactId}/{subcollection}/{docId}` catch-all — that catch-all
// is additive with the explicit `/push_tokens/{tokenId}` match, so a broader
// grant sitting beside a narrower one does not lose to it (the same trap
// `contact_notes` / `goals` / `subscription_history` are called out for
// there). This file pins both halves: the self-contact arm works, and the
// catch-all does not leak it to staff.
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
const TEAM = 'teamPT'
const CONTACT = 'contactPT'
const OTHER_CONTACT = 'otherContactPT'
const OWNER = 'ownerPT'
const ADMIN_UID = 'adminPT'
const TOKEN = 'ExponentPushToken[abc123]'

let testEnv: RulesTestEnvironment

const contactSession = (contactId: string) =>
  testEnv
    .authenticatedContext('contact:' + contactId, {
      contactId,
      teamId: TEAM,
      sessionExpires: Date.now() + 3_600_000,
    })
    .firestore()

const ownerSession = () => testEnv.authenticatedContext(OWNER).firestore()
const adminSession = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

const tokenDoc = (contactId: string) => (db: ReturnType<typeof contactSession>) =>
  doc(db, 'contacts', contactId, 'push_tokens', TOKEN)

const tokenPayload = () => ({
  token: TOKEN,
  teamId: TEAM,
  kind: 'expo',
  platform: 'ios',
  app_version: '1.0.0',
  runtime_version: '1.0.0',
  created_at: new Date(),
  last_seen_at: new Date(),
})

describe('firestore.rules — contacts/{id}/push_tokens self-only access', function () {
  this.timeout(30_000)

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-linyup-push-tokens',
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
      await setDoc(doc(db, 'contacts', OTHER_CONTACT), { teamId: TEAM, firstname: 'Elias' })
      await setDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN), tokenPayload())
      // A staff owner of the team, and an operator/admin — both otherwise
      // all-powerful over the contact document.
      await setDoc(doc(db, 'teams', TEAM, 'team_members', OWNER), { role: 'owner' })
      await setDoc(doc(db, 'users', OWNER), { currentTeam: TEAM, roles: {} })
      await setDoc(doc(db, 'users', ADMIN_UID), { roles: { admin: true } })
    })
  })

  // ── The self-contact arm works ──────────────────────────────────────────

  it('a contact CAN create its OWN push token, doc id = the token', async () => {
    const db = contactSession(OTHER_CONTACT)
    await assertSucceeds(setDoc(tokenDoc(OTHER_CONTACT)(db), tokenPayload()))
  })

  it('a contact CAN read its OWN push token', async () => {
    const db = contactSession(CONTACT)
    await assertSucceeds(getDoc(tokenDoc(CONTACT)(db)))
  })

  it('a contact CAN refresh last_seen_at on its OWN push token (the re-registration upsert)', async () => {
    const db = contactSession(CONTACT)
    await assertSucceeds(updateDoc(tokenDoc(CONTACT)(db), { last_seen_at: new Date() }))
  })

  it('a contact CAN delete its OWN push token', async () => {
    const db = contactSession(CONTACT)
    await assertSucceeds(deleteDoc(tokenDoc(CONTACT)(db)))
  })

  // ── Cross-contact: a DIFFERENT contact session is a stranger here ──────────

  it('a DIFFERENT contact session CANNOT read another contact’s push token', async () => {
    const db = contactSession(OTHER_CONTACT)
    await assertFails(getDoc(tokenDoc(CONTACT)(db)))
  })

  it('a DIFFERENT contact session CANNOT write another contact’s push token', async () => {
    const db = contactSession(OTHER_CONTACT)
    await assertFails(updateDoc(tokenDoc(CONTACT)(db), { last_seen_at: new Date() }))
  })

  // ── Staff get NO arm — the catch-all must not leak it ──────────────────────

  it('a team OWNER (canWriteContact) CANNOT read a member’s push tokens', async () => {
    const db = ownerSession()
    await assertFails(getDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN)))
  })

  it('a team OWNER CANNOT write (create/update/delete) a member’s push tokens', async () => {
    const db = ownerSession()
    await assertFails(
      setDoc(doc(db, 'contacts', CONTACT, 'push_tokens', 'forged'), tokenPayload())
    )
    await assertFails(
      updateDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN), { last_seen_at: new Date() })
    )
    await assertFails(deleteDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN)))
  })

  it('a platform ADMIN (hasRole(\'admin\')) CANNOT read a member’s push tokens either', async () => {
    const db = adminSession()
    await assertFails(getDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN)))
  })

  it('a platform ADMIN CANNOT write a member’s push tokens either', async () => {
    const db = adminSession()
    await assertFails(
      updateDoc(doc(db, 'contacts', CONTACT, 'push_tokens', TOKEN), { last_seen_at: new Date() })
    )
  })

  // ── Sanity: staff keep full access to an ordinary sibling subcollection ────
  // (proves the exclusion is scoped to push_tokens, not a wider regression).

  it('sanity: a team OWNER CAN still write an ordinary contact subcollection doc', async () => {
    const db = ownerSession()
    await assertSucceeds(setDoc(doc(db, 'contacts', CONTACT, 'misc', 'm1'), { anything: true }))
  })
})
