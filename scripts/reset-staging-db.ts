/**
 * DB reset for the **linyup-staging** Firebase project.
 *
 * Deletes EVERY document in EVERY top-level Firestore collection (recursively,
 * including subcollections) and EVERY Firebase Auth user, then prints a summary.
 *
 * Auth: uses gcloud Application Default Credentials (ADC) — same as seed-staging.
 *
 * Usage (the --confirm flag is mandatory — without it the script is a no-op):
 *   pnpm reset:staging              # has --confirm wired in package.json
 *   tsx scripts/reset-staging-db.ts --confirm
 *
 * Safety:
 *   - Hard-codes the project to `linyup-staging`. It refuses to run against any
 *     other project id, so it can never be pointed at production by accident.
 *   - Requires the explicit --confirm flag.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'

const PROJECT_ID = 'linyup-staging'

// Guard: never allow this destructive script to target anything but staging.
const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
if (envProject && envProject !== PROJECT_ID) {
  console.error(`❌ Refusing to run: ambient project '${envProject}' != '${PROJECT_ID}'.`)
  process.exit(1)
}

const { values } = parseArgs({ options: { confirm: { type: 'boolean', default: false } } })

if (!values.confirm) {
  console.error('❌ Refusing to run without --confirm.')
  console.error(`   This deletes ALL Firestore data and ALL Auth users in '${PROJECT_ID}'.`)
  console.error('   Re-run:  pnpm reset:staging   (or add --confirm)')
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID })

const db = admin.firestore()
const auth = admin.auth()

async function deleteAllFirestore(): Promise<{ collections: number; docs: number }> {
  const collections = await db.listCollections()
  let docCount = 0

  // Count top-level docs for the summary (subcollection docs are removed by
  // recursiveDelete but not counted individually — they vanish with their parent).
  for (const col of collections) {
    const snap = await col.get()
    docCount += snap.size
  }

  // recursiveDelete handles subcollections and batching internally.
  for (const col of collections) {
    process.stdout.write(`   deleting collection '${col.id}'… `)
    await db.recursiveDelete(col)
    console.log('done')
  }

  return { collections: collections.length, docs: docCount }
}

async function deleteAllAuthUsers(): Promise<number> {
  let deleted = 0
  let pageToken: string | undefined

  do {
    const result = await auth.listUsers(1000, pageToken)
    const uids = result.users.map((u) => u.uid)
    if (uids.length > 0) {
      // deleteUsers handles up to 1000 uids per call.
      const res = await auth.deleteUsers(uids)
      deleted += res.successCount
      if (res.failureCount > 0) {
        for (const err of res.errors) {
          console.warn(`   WARN failed to delete uid=${uids[err.index]}: ${err.error.message}`)
        }
      }
    }
    pageToken = result.pageToken
  } while (pageToken)

  return deleted
}

async function main() {
  console.log(`\n🧨 Resetting Firebase project: ${PROJECT_ID}\n`)

  console.log('1/2  Firestore…')
  const { collections, docs } = await deleteAllFirestore()

  console.log('\n2/2  Auth users…')
  const usersDeleted = await deleteAllAuthUsers()

  console.log('\n✅ Reset complete.')
  console.log('   ┌──────────────────────────────┬───────────┐')
  console.log('   │ Firestore top-level docs      │ ' + String(docs).padStart(9) + ' │')
  console.log('   │ Firestore collections cleared │ ' + String(collections).padStart(9) + ' │')
  console.log('   │ Auth users deleted            │ ' + String(usersDeleted).padStart(9) + ' │')
  console.log('   └──────────────────────────────┴───────────┘\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌ Reset failed:', err); process.exit(1) })
