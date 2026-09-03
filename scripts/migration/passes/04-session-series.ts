import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformSessionSeries } from '../transforms/session-series'

export async function pass04SessionSeries(
  cfg: MigrationConfig,
  teamIds: string[],
): Promise<void> {
  console.log('Pass 4: session_series')
  const src = sourceDb()
  const tgt = targetDb()
  const bw  = new BatchWriter(tgt, cfg.dryRun)

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    const snap = await src.collection('session_series').where('teamId', '==', teamId).get()
    for (const d of snap.docs) {
      const tgtRef = tgt.collection('session_series').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
      }
      bw.set(tgtRef, transformSessionSeries(d.data() as Record<string, unknown>))
    }
  }
  await bw.done()
}
