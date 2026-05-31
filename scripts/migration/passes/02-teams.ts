import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformTeam } from '../transforms/teams'

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
      if (existing.exists) { bw.skip(); continue }
    }
    bw.set(tgtRef, transformTeam(d.id, d.data() as Record<string, unknown>))
  }
  await bw.done()
  return teamIds
}
