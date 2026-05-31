import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'

export async function pass01Users(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 1: users')
  const src  = sourceDb()
  const tgt  = targetDb()
  const bw   = new BatchWriter(tgt, cfg.dryRun)

  const snap = await src.collection('users').get()
  for (const d of snap.docs) {
    const tgtRef = tgt.collection('users').doc(d.id)
    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists) { bw.skip(); continue }
    }
    // Drop deprecated subcollection-level fields that now live under teams/
    const data = d.data()
    bw.set(tgtRef, data)
  }
  await bw.done()
}
