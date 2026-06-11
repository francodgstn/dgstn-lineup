/**
 * One-time backfill for the subscription-type pricing rollout.
 *
 * Public visibility used to be implied by `source == 'aggregator'`: the
 * syncSubscriptionTypesToPublicProfile trigger mirrored aggregator types to
 * public_profile so the bio-link could list them. That filter is now an
 * explicit per-type `public` flag. This backfill sets `public: true` on every
 * existing active aggregator subscription type so current bio-links don't lose
 * their plans the moment the new sync ships.
 *
 * It also touches each affected team's subscription_types so the trigger
 * re-materializes public_profile.aggregator_subscription_types with the new
 * shape (incl. prices, which legacy types simply won't have).
 *
 * Auth: gcloud Application Default Credentials (ADC), like backfill-free-plan.
 *
 * Usage:
 *   tsx scripts/backfill-public-subscription-types.ts --project linyup-staging [--apply]
 *
 * Without --apply it only reports what it would change.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'

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
  console.log(
    `\n🔧 Public subscription-type backfill on '${values.project}' ${values.apply ? '(APPLY)' : '(dry-run)'}\n`
  )

  // Collection-group sweep over every team's subscription_types.
  const snap = await db.collectionGroup('subscription_types').get()
  let flagged = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const isActiveAggregator = data.source === 'aggregator' && data.active !== false
    const alreadyPublic = data.public === true
    if (!isActiveAggregator || alreadyPublic) continue

    flagged += 1
    console.log(
      `   ${values.apply ? 'flag' : 'would flag'} public: ${doc.ref.path} (${data.name ?? '?'})`
    )
    if (values.apply) await doc.ref.update({ public: true })
  }

  console.log(
    `\n✅ ${values.apply ? 'Flagged' : 'Would flag'} ${flagged} active aggregator type(s) as public.`
  )
  if (!values.apply) console.log('   Re-run with --apply to write.\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill failed:', err)
    process.exit(1)
  })
