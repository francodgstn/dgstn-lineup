/**
 * Hard-delete ONE tenant's data — the GDPR erasure / "reset this account" tool.
 *
 * This is the invocation path `purgeTeam` never had. The function has existed and
 * been correct for a long time, but it was not re-exported from the functions
 * entrypoint, had no callable and no script — so seven of the twelve boxes in
 * `docs/launch/data-safety-checklist.md` §3, and the founder runbook's "wipe and
 * restart a team" rollback, all described something nobody could actually run.
 *
 * Deliberately a SCRIPT and not a callable: a callable would be new public attack
 * surface for a function whose entire purpose is irreversible deletion.
 *
 * WHAT IT DELETES: every tenant-scoped Firestore document (from the shared
 * manifest in `packages/shared/src/tenantData.ts` — never a hand-copied list),
 * the `teams/{teamId}` subtree with all its subcollections, and the team's
 * Storage prefix. Auth users are KEPT — a person may belong to more than one team.
 *
 * WHAT IT DOES NOT DELETE: provider-side state. The Stripe Connect account and
 * its member subscriptions survive and keep charging real cards until someone
 * cancels them by hand in the Stripe dashboard. The script says so, loudly, at
 * the end of a real run.
 *
 * Auth: gcloud Application Default Credentials (ADC), same as the seed/reset
 * scripts. `gcloud auth application-default login` if it complains.
 *
 * Usage:
 *   pnpm purge:team --team <teamId> --project <projectId>            # DRY RUN (default)
 *   pnpm purge:team --team <teamId> --project <projectId> --apply    # really delete (prompts)
 *   pnpm purge:team --team <teamId> --project <projectId> --apply --yes   # skip the prompt
 *
 * Safety:
 *   - Dry-run is the DEFAULT. Deleting requires --apply, matching the backfill
 *     scripts' convention.
 *   - --project is REQUIRED and never inferred. This script is the one tool here
 *     that legitimately runs against production, so the target is always typed.
 *   - Before deleting it prints the team's NAME and creation date, because the
 *     realistic failure is a mistyped team id that happens to exist.
 *   - Requires an interactive typed confirmation of the team id; --yes is the
 *     non-interactive escape hatch and the ONLY way it runs without a TTY.
 */

import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { purgeTeam } from '../packages/functions/src/saas-billing/purgeTeam'

const { values } = parseArgs({
  options: {
    team: { type: 'string' },
    project: { type: 'string' },
    apply: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
})

const teamId = values.team?.trim()
const projectId = values.project?.trim()
const apply = values.apply
const skipPrompt = values.yes

function usage(msg: string): never {
  console.error(`\n❌ ${msg}\n`)
  console.error('   Usage: pnpm purge:team --team <teamId> --project <projectId> [--apply] [--yes]')
  console.error('   Dry run is the default; --apply is required to delete anything.\n')
  process.exit(1)
}

if (!teamId) usage('--team <teamId> is required.')
if (!projectId) usage('--project <projectId> is required — this script is never allowed to guess.')

admin.initializeApp({ credential: applicationDefault(), projectId })

async function main(): Promise<void> {
  const db = admin.firestore()

  // Show WHICH team before touching anything. A mistyped id that happens to
  // exist is the realistic way this goes wrong, and a name is the only thing a
  // human can actually check an id against.
  const teamSnap = await db.collection(TEAMS_COLLECTION).doc(teamId!).get()
  if (!teamSnap.exists) {
    console.error(`\n❌ No team '${teamId}' in project '${projectId}'. Nothing to do.`)
    console.error('   Check the project — the same team id does not exist in every environment.\n')
    process.exit(1)
  }
  const team = teamSnap.data() ?? {}
  const created = team.created_at?.toDate?.()

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`  Project : ${projectId}`)
  console.log(`  Team    : ${teamId}`)
  console.log(`  Name    : ${team.name ?? '(unnamed)'}`)
  console.log(`  Plan    : ${team.plan ?? '(none)'}`)
  if (created) console.log(`  Created : ${created.toISOString().slice(0, 10)}`)
  console.log(`  Mode    : ${apply ? '*** REAL DELETE ***' : 'dry run (nothing will be deleted)'}`)
  console.log(`${'─'.repeat(70)}\n`)

  if (!apply) {
    await purgeTeam(teamId!, true)
    console.log('\n✅ Dry run complete. Nothing was deleted.')
    console.log('   Review the counts above, then re-run with --apply to delete.\n')
    return
  }

  if (!skipPrompt) {
    if (!process.stdin.isTTY) {
      console.error('❌ Refusing to delete non-interactively without --yes.')
      console.error('   Re-run with --yes (CI), or drop --apply to preview.\n')
      process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`Type the team id '${teamId}' to confirm deletion: `)
    rl.close()
    if (answer.trim() !== teamId) {
      console.error('\n❌ Confirmation did not match — aborted. Nothing was deleted.\n')
      process.exit(1)
    }
  }

  await purgeTeam(teamId!, false)

  console.log(`\n✅ Purged team ${teamId} from ${projectId} (Firestore + Storage).`)
  console.log('   Auth users were KEPT — a person may belong to more than one team.')
  console.log('\n⚠️  STILL TO DO BY HAND, in the Stripe dashboard:')
  console.log('   • Cancel/disconnect the team\'s Connect account')
  console.log('   • Cancel its member subscriptions and any SaaS subscription')
  console.log('   Until you do, a deleted studio keeps charging real cards.\n')
}

main().catch((err) => {
  console.error('\n❌ purge-team failed:', err)
  process.exit(1)
})
