import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformEvent } from '../transforms/events'

export async function pass08Events(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 8: events + invitations + attendees')
  const src = sourceDb()
  const tgt = targetDb()
  const bw  = new BatchWriter(tgt, cfg.dryRun)

  const snap = await src.collection('events').get()
  for (const d of snap.docs) {
    const tgtRef = tgt.collection('events').doc(d.id)
    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists) { bw.skip(); continue }
    }
    bw.set(tgtRef, transformEvent(d.data() as Record<string, unknown>))

    for (const sub of ['invitations', 'attendees'] as const) {
      const subSnap = await src.collection('events').doc(d.id).collection(sub).get()
      for (const sd of subSnap.docs) {
        const subRef = tgt.collection('events').doc(d.id).collection(sub).doc(sd.id)
        if (!cfg.dryRun) {
          const existing = await subRef.get()
          if (existing.exists) { bw.skip(); continue }
        }
        bw.set(subRef, sd.data())
      }
    }
  }
  await bw.done()
}
