/**
 * Nudges every team so `syncTeamPublicProfile` recomputes its
 * `teams/{teamId}/public_profile/{teamId}` mirror.
 *
 * ── WHY THIS IS NEEDED, AND WHY IT IS NOT OPTIONAL ──────────────────────────
 * The mirror is the ONLY thing a public surface may read — a public route
 * cannot read `teams/{id}` at all — so every flag a public page gates on has to
 * be copied there by `syncTeamPublicProfile`, which runs on a TEAM WRITE and
 * nothing else.
 *
 * That is fine for a flag introduced before its readers. It is NOT fine for a
 * flag added later: the day it deploys, every existing team's mirror predates
 * the field, so the gate reads `undefined`, fails closed, and the feature is
 * invisible — to exactly the studios who already had the thing switched on.
 * `onInstalledPluginStatusChange` does not save you: it fires when an install
 * CHANGES, so a studio whose install predates the deploy is never touched.
 *
 * The immediate case is `gamificationEnabled` (the Space's Gamification tab),
 * but the script is deliberately written for the mirror as a whole rather than
 * that one field — the next added flag will have the same problem, and this
 * should be re-runnable for it rather than copied.
 *
 * ── WHY A NUDGE, NOT A RE-IMPLEMENTATION ────────────────────────────────────
 * `scripts/backfill-document-mirrors.ts` deliberately writes the mirror itself,
 * because the trigger may not be deployed on the target and because the bytes
 * must match a frozen snapshot. Neither applies here, and the opposite argument
 * does: the team mirror is computed from a dozen inputs (active surfaces, plugin
 * installs, payments, coaches, booking windows…). A second implementation would
 * be wrong the first time any of them changed. So this writes ONE field and lets
 * the deployed trigger — the single owner of that document — do the work.
 *
 * It writes `surfaces_updated_at`, the SAME field `touchTeamForSurfaceRecompute`
 * uses (`packages/functions/src/utils/plugins.ts`), so this introduces no new
 * convention and nothing has to learn about a backfill-only marker.
 *
 * PRECONDITION: `syncTeamPublicProfile` must already be deployed to the target.
 * A nudge against an environment whose trigger predates the field recomputes the
 * mirror WITHOUT it, silently. `--verify` re-reads the mirrors afterwards and
 * reports how many carry the field, so a stale deploy is visible rather than
 * assumed.
 *
 * Auth: gcloud Application Default Credentials (ADC).
 *
 * Usage:
 *   tsx scripts/backfill-team-public-profile.ts --project linyup-staging            # dry run
 *   tsx scripts/backfill-team-public-profile.ts --project linyup-staging --apply
 *   tsx scripts/backfill-team-public-profile.ts --project linyup-staging --apply --verify gamificationEnabled
 *   tsx scripts/backfill-team-public-profile.ts --emulator --apply                  # local
 */

import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldValue } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION } from '@linyup/shared'

// The literal the trigger itself uses (`syncTeamPublicProfile.ts:49`). There is
// no team-scoped constant in paths.ts — only `USER_PUBLIC_PROFILE_SUBCOLLECTION`,
// which happens to hold the same string for a different collection, so borrowing
// it here would read as a different thing than it is.
const PUBLIC_PROFILE = 'public_profile'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    emulator: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    /** Field to report on after the nudge, e.g. `gamificationEnabled`. */
    verify: { type: 'string' },
    /** Pause between batches, ms. The trigger fans out; do not stampede it. */
    pause: { type: 'string' },
  },
})

const BATCH = 100
const pauseMs = Number(values.pause ?? '1000')

if (values.emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
  admin.initializeApp({ projectId: 'demo-linyup' })
} else {
  if (!values.project) {
    console.error('❌ --project is required (or pass --emulator)')
    process.exit(1)
  }
  admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
}

const db = admin.firestore()
const target = values.emulator ? `emulator (${process.env.FIRESTORE_EMULATOR_HOST})` : values.project!

async function confirm(question: string): Promise<boolean> {
  if (values.yes) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim() === 'yes'
}

async function main() {
  const teams = await db.collection(TEAMS_COLLECTION).select().get()
  console.log(`\nTarget : ${target}`)
  console.log(`Teams  : ${teams.size}`)

  if (!values.apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    console.log('Each team gets ONE field written (surfaces_updated_at), which fires')
    console.log('syncTeamPublicProfile and rewrites its public_profile mirror.\n')
    return
  }

  // A cloud write asks, the way sandbox:reset and lead --reset do. This is a
  // low-risk write, but it fans out to one trigger invocation per team and that
  // is worth being deliberate about on a real project.
  if (!values.emulator) {
    const ok = await confirm(
      `\nThis nudges all ${teams.size} teams on "${values.project}", firing syncTeamPublicProfile\n` +
        `for each. Type "yes" to continue: `
    )
    if (!ok) {
      console.log('Aborted.')
      return
    }
  }

  let written = 0
  for (let i = 0; i < teams.docs.length; i += BATCH) {
    const slice = teams.docs.slice(i, i + BATCH)
    const batch = db.batch()
    for (const doc of slice) {
      batch.set(doc.ref, { surfaces_updated_at: FieldValue.serverTimestamp() }, { merge: true })
    }
    await batch.commit()
    written += slice.length
    console.log(`  nudged ${written}/${teams.size}`)
    if (i + BATCH < teams.docs.length && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs))
    }
  }

  console.log(`\n✅ Nudged ${written} team(s).`)

  if (!values.verify) {
    console.log('   Pass --verify <field> to confirm the mirrors actually gained it.\n')
    return
  }

  // The triggers are asynchronous, so give them a moment before reading back.
  // This is a REPORT, not a gate: a low count means the deployed trigger is
  // older than the field, which is precisely the failure this flag exists to
  // make visible rather than leave to be discovered by a user.
  console.log(`\nWaiting 15s for triggers to settle, then checking "${values.verify}"…`)
  await new Promise((r) => setTimeout(r, 15_000))

  let present = 0
  let missing = 0
  const missingIds: string[] = []
  for (const doc of teams.docs) {
    const mirror = await doc.ref.collection(PUBLIC_PROFILE).doc(doc.id).get()
    if (mirror.exists && mirror.get(values.verify) !== undefined) present += 1
    else {
      missing += 1
      if (missingIds.length < 10) missingIds.push(doc.id)
    }
  }

  console.log(`\n  ${values.verify} present : ${present}`)
  console.log(`  ${values.verify} missing : ${missing}`)
  if (missing > 0) {
    console.log(`  e.g. ${missingIds.join(', ')}`)
    console.log(
      `\n⚠️  Missing on ${missing} team(s). The usual cause is that syncTeamPublicProfile on\n` +
        `   "${target}" predates the field — deploy functions, then re-run this.\n` +
        `   (Some may also be legitimately absent if the writer omits the field when false.)\n`
    )
  } else {
    console.log('\n✅ Every team mirror carries the field.\n')
  }
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
