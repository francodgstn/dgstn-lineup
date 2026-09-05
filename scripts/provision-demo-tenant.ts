/**
 * Provision the demo tenant — and NOTHING else.
 *
 *   pnpm provision:demo --project linyup-prod
 *   pnpm provision:demo --project linyup-staging --code 424242
 *   pnpm provision:demo --project linyup-prod --dry-run
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `seedReviewTenant` was reachable only from the three FULL seeders
 * (seed-emulator, seed-sandbox, seed-staging), each of which also creates demo
 * studios, contacts and sessions across the whole project. On production that is
 * not a seed, it is contamination — so there was no safe way to provision the one
 * tenant a store reviewer actually signs into.
 *
 * That tenant needs re-provisioning on a schedule set by other people:
 *
 *  - the fixed review code expires 60 days after the last run, and a lapsed code
 *    is an automatic store rejection;
 *  - closed-test testers share the tenant, so a curious "Delete account" tap or a
 *    renamed contact needs repairing — a run is the repair;
 *  - a provisioner FIX (like `allowBooking`, without which the app opens empty)
 *    only reaches an environment when the provisioner is actually run there.
 *
 * ── WHAT IT TOUCHES ─────────────────────────────────────────────────────────
 *
 * `teams/linyup-demo` and its activities, contacts, sessions and bookings;
 * `messaging_policies/linyup-demo` (silent — it must never email anybody); and
 * `app_settings/review_access`. Sessions inside the demo tenant are deleted and
 * recreated so the schedule is never stale. Nothing outside `linyup-demo` is
 * read or written.
 *
 * Credentials come from ADC (`gcloud auth application-default login`), same as
 * the staging seeder.
 */
import * as admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { createInterface } from 'node:readline/promises'
import { printMemberAppLogin, seedReviewTenant } from './lib/mobile'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

const KNOWN = ['linyup-staging', 'linyup-sandbox', 'linyup-prod', 'demo-linyup']
const projectId = arg('project')
const dryRun = has('dry-run')

if (!projectId) {
  console.error('Usage: pnpm provision:demo --project <projectId> [--code nnnnnn] [--dry-run] [--yes]')
  console.error(`Known projects: ${KNOWN.join(', ')}`)
  process.exit(1)
}
if (!KNOWN.includes(projectId)) {
  // A typo here would create a tenant in a project nobody is watching.
  console.error(`Unknown project '${projectId}'. Expected one of: ${KNOWN.join(', ')}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const isProd = projectId === 'linyup-prod'

  console.log(`\n  Demo tenant provisioning`)
  console.log(`  project   ${projectId}${isProd ? '   ← PRODUCTION' : ''}`)
  console.log(`  scope     teams/linyup-demo only — nothing else in the project is touched`)
  console.log(`  note      the tenant's sessions are deleted and recreated\n`)

  if (dryRun) {
    console.log('  --dry-run: nothing written.\n')
    return
  }

  // Production is the one that reaches real people, so it asks. Everything else
  // is a demo or a sandbox and does not need a ceremony.
  if (isProd && !has('yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`  Type the project id to continue: `)
    rl.close()
    if (answer.trim() !== projectId) {
      console.error('\n  Aborted — that did not match.\n')
      process.exit(1)
    }
  }

  admin.initializeApp({ credential: applicationDefault(), projectId })
  const db = admin.firestore()
  db.settings({ ignoreUndefinedProperties: true })

  const seed = await seedReviewTenant({
    db,
    seededBy: `provision-demo-tenant (${projectId})`,
    code: arg('code'),
  })

  console.log(`  ✓ provisioned ${seed.teamId}`)
  console.log(
    `    ${seed.counts.activities} activities · ${seed.counts.sessions} sessions · ` +
      `${seed.counts.contacts} contacts (${seed.counts.testers} testers) · ` +
      `${seed.counts.bookings} bookings · ${seed.counts.attended} attendances`
  )
  printMemberAppLogin(seed)
}

main().catch((err) => {
  console.error('\n  Provisioning failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
