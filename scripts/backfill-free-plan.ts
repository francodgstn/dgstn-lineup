/**
 * One-time backfill for the Free-plan rollout.
 *
 * 1. Touches every team doc (bumps `updated_at`) so the syncTeamPublicProfile
 *    trigger re-runs and materializes `public_profile.showBranding` — until it
 *    exists, NO portal shows the "Powered by Linyup" badge (paid portals are
 *    unaffected either way).
 * 2. Converts any team stranded on the legacy wall-era `plan_status='expired'`
 *    to the Free plan (plan='free', plan_status='active', wall markers
 *    cleared). The daily handleTrialLifecycle sweep does this too — running it
 *    here just avoids waiting a day.
 *
 * Auth: gcloud Application Default Credentials (ADC), like seed-staging.
 *
 * Usage:
 *   tsx scripts/backfill-free-plan.ts --project linyup-staging [--apply]
 *
 * Without --apply it only reports what it would change.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldValue } from 'firebase-admin/firestore'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging)')
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

async function main() {
  console.log(`\n🔧 Free-plan backfill on '${values.project}' ${values.apply ? '(APPLY)' : '(dry-run)'}\n`)

  const teams = await db.collection('teams').get()
  let touched = 0
  let converted = 0

  for (const doc of teams.docs) {
    const data = doc.data()
    const isLegacyExpired = data.plan_status === 'expired'

    if (values.apply) {
      const update: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() }
      if (isLegacyExpired) {
        update.plan = 'free'
        update.plan_status = 'active'
        update.suspended_at = FieldValue.delete()
        update.purge_at = FieldValue.delete()
        update.downgraded_from_trial_at = FieldValue.serverTimestamp()
      }
      await doc.ref.update(update)
    }

    touched += 1
    if (isLegacyExpired) {
      converted += 1
      console.log(`   ${values.apply ? 'converted' : 'would convert'} legacy expired team ${doc.id} (${data.name ?? '?'}) → free`)
    }
  }

  console.log(`\n✅ ${values.apply ? 'Touched' : 'Would touch'} ${touched} team docs (re-syncs public_profile.showBranding), ${converted} legacy expired → free.`)
  if (!values.apply) console.log('   Re-run with --apply to write.\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌ Backfill failed:', err); process.exit(1) })
