import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'

export async function pass01Users(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 1: users (active only)')
  const src = sourceDb()
  const tgt = targetDb()
  const bw  = new BatchWriter(tgt, cfg.dryRun)

  // disabled_at == null matches both null and missing field (active users only)
  const snap = await src.collection('users').where('disabled_at', '==', null).get()
  console.log(`  found ${snap.size} active users`)

  for (const d of snap.docs) {
    const tgtRef = tgt.collection('users').doc(d.id)
    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
    }
    bw.set(tgtRef, d.data())
  }
  await bw.done()
}
