import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformTeam } from '../transforms/teams'

// Fields that must always be correct regardless of whether the doc already existed.
// Handles the case where the emulator was seeded before migration ran.
const ALWAYS_MERGE = {
  plan:           'club',
  plan_status:    'active',
  org_id:         ORG_ID,
  organizationId: ORG_ID,
}

export async function pass02Teams(cfg: MigrationConfig): Promise<string[]> {
  console.log('Pass 2: teams')
  const src    = sourceDb()
  const tgt    = targetDb()
  const bw     = new BatchWriter(tgt, cfg.dryRun)
  const teamIds: string[] = []

  const snap = await src.collection('teams').get()
  for (const d of snap.docs) {
    teamIds.push(d.id)
    const tgtRef = tgt.collection('teams').doc(d.id)

    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists) {
        // Doc already exists (e.g. from emulator seed) — merge the org/plan
        // fields that migration is responsible for, leave everything else alone.
        bw.merge(tgtRef, ALWAYS_MERGE)
        continue
      }
    }

    bw.set(tgtRef, transformTeam(d.id, d.data() as Record<string, unknown>))
  }
  await bw.done()
  return teamIds
}
