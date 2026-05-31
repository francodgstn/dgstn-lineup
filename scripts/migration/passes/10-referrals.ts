import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'

export async function pass10Referrals(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 10: referrals')
  const src = sourceDb()
  const tgt = targetDb()
  const bw  = new BatchWriter(tgt, cfg.dryRun)

  const snap = await src.collection('referrals').get()
  for (const d of snap.docs) {
    const tgtRef = tgt.collection('referrals').doc(d.id)
    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists) { bw.skip(); continue }
    }
    bw.set(tgtRef, d.data())
  }
  await bw.done()
}
