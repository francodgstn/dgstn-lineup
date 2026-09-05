import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID, matchesTeamSample, EXCLUDED_SOURCE_TEAMS } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformTeam } from '../transforms/teams'

// Fields that must always be correct regardless of whether the doc already existed.
// Handles the case where the emulator was seeded before migration ran.
const ALWAYS_MERGE = {
  plan:           'studio',
  plan_status:    'active',
  org_id:         ORG_ID,
  organizationId: ORG_ID,
}

export async function pass02Teams(cfg: MigrationConfig): Promise<string[]> {
  console.log('Pass 2: teams + org_teams + org ranking_systems')
  const src    = sourceDb()
  const tgt    = targetDb()
  const bw     = new BatchWriter(tgt, cfg.dryRun)
  const teamIds: string[] = []

  const all = await src.collection('teams').get()

  // ── EXCLUSIONS FIRST, and they are absolute ───────────────────────────────
  // Applied BEFORE the sample and before the unmatched-name check, so an
  // excluded club cannot be reached by naming it in `--teams` either. Dropped
  // here rather than in each pass because every downstream pass is scoped by the
  // ids this one returns, so one filter removes the club's contacts, sessions
  // and check-ins with it.
  const excluded = all.docs.filter((d) => EXCLUDED_SOURCE_TEAMS.includes(d.id))
  if (excluded.length > 0) {
    console.log(
      `   excluded ${excluded.length} club(s): ` +
        excluded.map((d) => `${String(d.data().name ?? '(unnamed)')} [${d.id}]`).join(', ')
    )
  }
  const snap = {
    docs: all.docs.filter((d) => !EXCLUDED_SOURCE_TEAMS.includes(d.id)),
    get size() {
      return this.docs.length
    },
  }

  // ── THE SAMPLE, resolved once and reported ────────────────────────────────
  // `--teams` exists so a transform can be changed and looked at in seconds
  // instead of minutes. It is applied HERE, at the only pass that reads the
  // club list, so every downstream pass is scoped by the ids this returns and
  // no other pass needs to know the flag exists.
  const selected = snap.docs.filter((d) =>
    matchesTeamSample(cfg.teams, d.id, String(d.data().name ?? ''))
  )

  if (cfg.teams?.length) {
    // FAIL LOUDLY on a name that matched nothing. Importing three clubs when
    // four were named — or none when all four were misspelled — looks exactly
    // like success until somebody goes looking for the missing data.
    const unmatched = cfg.teams.filter(
      (want) =>
        !snap.docs.some((d) => matchesTeamSample([want], d.id, String(d.data().name ?? '')))
    )
    if (unmatched.length > 0) {
      const available = snap.docs
        .map((d) => `     ${String(d.data().name ?? '(unnamed)')}   [${d.id}]`)
        .sort()
        .join('\n')
      console.error(
        `\n❌ --teams named ${unmatched.length} club(s) that do not exist in the source:\n` +
          unmatched.map((u) => `     ${u}`).join('\n') +
          `\n\n   Clubs available:\n` +
          available
      )
      process.exit(1)
    }
    console.log(
      `   sample: ${selected.length} of ${snap.size} clubs — ` +
        selected.map((d) => String(d.data().name ?? d.id)).join(', ')
    )
  }

  for (const d of selected) {
    teamIds.push(d.id)
    const srcData = d.data() as Record<string, unknown>
    const tgtRef  = tgt.collection('teams').doc(d.id)

    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      // NOT under --overwrite, deliberately. A team doc accumulates state the
      // source has no copy of — the Connect/payments block, bookingSettings,
      // plan — so a full re-set would silently un-configure a working tenant to
      // fix a field the source owns. The partial merge below is what the source
      // is actually authoritative for.
      //
      // ── "EXISTS" IS NOT THE SAME AS "IS A TENANT" ───────────────────────
      // A team document can be RESURRECTED as a stub by a trigger.
      // `touchTeamForSurfaceRecompute` (functions/src/utils/plugins.ts) writes
      // `surfaces_updated_at` with `set(..., {merge: true})`, which CREATES the
      // document, and it is called from the content public_profile syncs — which
      // fire on delete as much as on write. So `--reset`, deleting a club's
      // events and activities, fires those syncs and leaves behind a team doc
      // holding one timestamp and nothing else.
      //
      // Pass 2 then saw `exists`, merged four fields, and never wrote the name.
      // It cost HMD Team Galli its identity on a run that reported success:
      // `verify` counts documents, not fields, so nothing anywhere noticed. The
      // club with the most data was the one it hit, because it generated the
      // most delete events.
      //
      // A document with no `name` has no accumulated tenant state to protect —
      // that is exactly what the guard above exists for — so it is treated as
      // absent and written whole. Reported rather than quietly repaired: the
      // resurrection is a real defect in the triggers, and silently papering
      // over it here is how it would never be found.
      const stub = existing.exists && !existing.data()?.name
      if (stub) {
        console.warn(
          `   ⚠️  teams/${d.id} existed with no name — a trigger-resurrected stub. ` +
            `Writing it whole.`
        )
      }
      if (existing.exists && !stub) {
        bw.merge(tgtRef, ALWAYS_MERGE)
      } else {
        bw.set(tgtRef, transformTeam(d.id, srcData))
      }
    } else {
      bw.set(tgtRef, transformTeam(d.id, srcData))
    }

    // org_teams subcollection entry — one per club, idempotent via merge
    const orgTeamRef = tgt
      .collection('organizations').doc(ORG_ID)
      .collection('org_teams').doc(d.id)
    bw.merge(orgTeamRef, {
      teamId:  d.id,
      orgId:   ORG_ID,
      status:  'active',
      joined:  FieldValue.serverTimestamp(),
      addedBy: 'migration',
    })
  }

  await bw.done()

  return teamIds
}
