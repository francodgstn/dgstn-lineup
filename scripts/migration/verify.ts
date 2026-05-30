/**
 * Post-migration verification script.
 *
 * Usage:
 *   tsx scripts/migration/verify.ts \
 *     --source-creds ./keys/hmd-prod-sa.json \
 *     --target-creds ./keys/lineup-staging-sa.json \
 *     [--from-team <teamId>]
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import path from 'path'
import { TEAM_CONFIGS } from './config'

const args           = process.argv.slice(2)
const flag           = (name: string) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined }
const sourceCredsPath = flag('--source-creds')
const targetCredsPath = flag('--target-creds')
const FROM_TEAM       = flag('--from-team')

if (!sourceCredsPath || !targetCredsPath) {
  console.error('Usage: tsx scripts/migration/verify.ts --source-creds <path> --target-creds <path>')
  process.exit(1)
}

function initDb(credsPath: string, name: string) {
  const creds = JSON.parse(readFileSync(path.resolve(credsPath), 'utf8'))
  const app   = initializeApp({ credential: cert(creds) }, name)
  return getFirestore(app)
}

const srcDb = initDb(sourceCredsPath, 'verify-source')
const tgtDb = initDb(targetCredsPath, 'verify-target')

let passed = 0
let failed = 0

function ok(msg: string)   { console.log(`  ✓ ${msg}`); passed++ }
function fail(msg: string) { console.error(`  ✗ ${msg}`); failed++ }

// ── 1. Count parity ───────────────────────────────────────────────────────────

async function checkCountParity(col: string): Promise<void> {
  const [srcCount, tgtCount] = await Promise.all([
    srcDb.collection(col).count().get().then(s => s.data().count),
    tgtDb.collection(col).count().get().then(s => s.data().count),
  ])
  if (srcCount === tgtCount) {
    ok(`${col}: count matches (${srcCount})`)
  } else {
    fail(`${col}: source=${srcCount} target=${tgtCount} (delta ${tgtCount - srcCount})`)
  }
}

// ── 2. Contact spot-check ─────────────────────────────────────────────────────

async function spotCheckContacts(teamId: string): Promise<void> {
  const snap = await tgtDb.collection('contacts').where('teamId', '==', teamId).limit(5).get()
  for (const doc of snap.docs) {
    const subs = ['goals', 'subscription_history', 'monthly_scores', 'contact_weekly_reports']
    for (const sub of subs) {
      const subSnap = await doc.ref.collection(sub).count().get()
      const srcSnap = await srcDb.collection('contacts').doc(doc.id).collection(sub).count().get()
      if (subSnap.data().count >= srcSnap.data().count) {
        ok(`contacts/${doc.id}/${sub}: ${subSnap.data().count} docs`)
      } else {
        fail(`contacts/${doc.id}/${sub}: target=${subSnap.data().count} < source=${srcSnap.data().count}`)
      }
    }
  }
}

// ── 3. Session integrity ──────────────────────────────────────────────────────

async function checkSessionIntegrity(teamId: string): Promise<void> {
  const snap = await tgtDb.collection('sessions').where('teamId', '==', teamId).limit(3).get()
  for (const doc of snap.docs) {
    const participantsCount = (await doc.ref.collection('participants').count().get()).data().count
    const storedCount       = (doc.data().participants_count as number | undefined) ?? 0
    if (participantsCount === storedCount) {
      ok(`sessions/${doc.id}: participants_count matches (${storedCount})`)
    } else {
      fail(`sessions/${doc.id}: participants_count=${storedCount} but sub-count=${participantsCount}`)
    }
  }
}

// ── 4. Referential integrity ──────────────────────────────────────────────────

async function checkReferentialIntegrity(teamId: string): Promise<void> {
  const contacts = await tgtDb.collection('contacts').where('teamId', '==', teamId).limit(50).get()
  const subTypes = new Set(
    (await tgtDb.collection('teams').doc(teamId).collection('subscription_types').get()).docs.map(d => d.id)
  )

  let broken = 0
  for (const doc of contacts.docs) {
    const subId = doc.data().subscription_type_id as string | undefined
    if (subId && !subTypes.has(subId)) broken++
  }

  if (broken === 0) {
    ok(`[${teamId}] referential integrity: all subscription_type_ids resolve`)
  } else {
    fail(`[${teamId}] referential integrity: ${broken} contacts have unresolvable subscription_type_id`)
  }
}

// ── 5. Auth sync ──────────────────────────────────────────────────────────────

async function checkAuthSync(): Promise<void> {
  // We can only check Firestore side — confirm users collection is non-empty
  const count = (await tgtDb.collection('users').count().get()).data().count
  if (count > 0) {
    ok(`users collection has ${count} docs (auth UIDs should match — verify manually)`)
  } else {
    fail('users collection is empty — did you run firebase auth:import?')
  }
}

// ── 6. Gamification sanity ────────────────────────────────────────────────────

async function checkGamification(teamId: string): Promise<void> {
  const snap = await tgtDb.collection('contacts').where('teamId', '==', teamId).limit(3).get()
  for (const doc of snap.docs) {
    const scoreSnap = await doc.ref.collection('monthly_scores').count().get()
    if (scoreSnap.data().count > 0) {
      ok(`contacts/${doc.id}/monthly_scores: ${scoreSnap.data().count} entries`)
    } else {
      fail(`contacts/${doc.id}/monthly_scores: 0 entries — gamification history missing`)
    }
  }
}

// ── 7. Skipped collections must not exist ────────────────────────────────────

const SKIPPED_COLLECTIONS = [
  'coach_availability',
  'coach_slots',
  'verification_codes',
  'auth_tokens',
  'booking_verification_codes',
  'referral_codes',
  'categories',
  'projects',
]

async function checkSkippedCollections(): Promise<void> {
  for (const col of SKIPPED_COLLECTIONS) {
    const snap = await tgtDb.collection(col).limit(1).get()
    if (snap.empty) {
      ok(`${col}: correctly absent from target`)
    } else {
      fail(`${col}: found in target — should have been skipped`)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Migration Verification ===\n')

  const teams = FROM_TEAM
    ? TEAM_CONFIGS.filter(t => t.id === FROM_TEAM)
    : TEAM_CONFIGS

  console.log('1. Count parity')
  await checkCountParity('users')
  await checkCountParity('contacts')
  await checkCountParity('sessions')
  await checkCountParity('activities')
  await checkCountParity('referrals')

  console.log('\n2. Contact spot-check')
  for (const cfg of teams) await spotCheckContacts(cfg.id)

  console.log('\n3. Session integrity')
  for (const cfg of teams) await checkSessionIntegrity(cfg.id)

  console.log('\n4. Referential integrity')
  for (const cfg of teams) await checkReferentialIntegrity(cfg.id)

  console.log('\n5. Auth sync')
  await checkAuthSync()

  console.log('\n6. Gamification sanity')
  for (const cfg of teams) await checkGamification(cfg.id)

  console.log('\n7. Skipped collections')
  await checkSkippedCollections()

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Verify failed:', err)
  process.exit(1)
})
