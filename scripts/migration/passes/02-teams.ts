import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID, matchesTeamSample } from '../config'
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

  const snap = await src.collection('teams').get()

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
      if (existing.exists) {
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
