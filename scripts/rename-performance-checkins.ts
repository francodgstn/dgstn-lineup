/**
 * One-off backfill: rename the performance-profile storage keys that were
 * previously called "training".
 *   - per-contact subcollection  contacts/{id}/training_checkins → performance_checkins
 *   - team config field          teams/{id}.training_indicators  → performance_indicators
 * Docs/values are copied to the new location, then the old ones are removed.
 * Idempotent: re-running after a successful run finds nothing to do.
 *
 * Usage:
 *   pnpm tsx scripts/rename-performance-checkins.ts --emulator [--dry-run]
 *   pnpm tsx scripts/rename-performance-checkins.ts --creds ./sa.json [--dry-run]
 *
 * Run order per env: deploy rules+indexes first, then this, then the app deploy.
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const emulator = args.includes('--emulator')
const credsPath = args[args.indexOf('--creds') + 1]

const OLD_SUB = 'training_checkins'
const NEW_SUB = 'performance_checkins'
const OLD_FIELD = 'training_indicators'
const NEW_FIELD = 'performance_indicators'

if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-linyup' })
} else if (credsPath && args.includes('--creds')) {
  initializeApp({ credential: cert(credsPath) })
} else {
  console.error('Provide --emulator or --creds <serviceAccount.json>')
  process.exit(1)
}

const db = getFirestore()
db.settings({ ignoreUndefinedProperties: true })

async function run() {
  const tag = dryRun ? '[DRY RUN] ' : ''
  console.log(`${tag}Renaming ${OLD_SUB} → ${NEW_SUB} and team field ${OLD_FIELD} → ${NEW_FIELD}`)

  // 1. Per-contact subcollection
  let contactsTouched = 0
  let checkinsMoved = 0
  const contacts = await db.collection('contacts').get()
  for (const c of contacts.docs) {
    const snap = await c.ref.collection(OLD_SUB).get()
    if (snap.empty) continue
    contactsTouched++
    for (const d of snap.docs) {
      checkinsMoved++
      if (!dryRun) {
        await c.ref.collection(NEW_SUB).doc(d.id).set(d.data())
        await d.ref.delete()
      }
    }
    console.log(`  contact ${c.id}: ${snap.size} check-in(s)`)
  }

  // 2. Team config field
  let teamsTouched = 0
  const teams = await db.collection('teams').get()
  for (const t of teams.docs) {
    const value = t.data()[OLD_FIELD]
    if (value === undefined) continue
    teamsTouched++
    if (!dryRun) {
      await t.ref.update({ [NEW_FIELD]: value, [OLD_FIELD]: FieldValue.delete() })
    }
    console.log(`  team ${t.id}: migrated ${OLD_FIELD}`)
  }

  console.log(
    `\n${tag}${dryRun ? 'would migrate' : 'migrated'} ${checkinsMoved} check-in(s) across ` +
      `${contactsTouched} contact(s); ${teamsTouched} team field(s).`,
  )
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
