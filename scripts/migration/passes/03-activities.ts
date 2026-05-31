import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformActivity } from '../transforms/activities'

export async function pass03Activities(
  cfg: MigrationConfig,
  teamIds: string[],
): Promise<Map<string, { name: string; type: string }>> {
  console.log('Pass 3: activities')
  const src       = sourceDb()
  const tgt       = targetDb()
  const bw        = new BatchWriter(tgt, cfg.dryRun)
  const activityMap = new Map<string, { name: string; type: string }>()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    const snap = await src.collection('activities').where('teamId', '==', teamId).get()
    for (const d of snap.docs) {
      const data = transformActivity(d.data() as Record<string, unknown>)
      activityMap.set(d.id, {
        name: String(data.name ?? ''),
        type: String(data.type ?? 'group_class'),
      })
      const tgtRef = tgt.collection('activities').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists) { bw.skip(); continue }
      }
      bw.set(tgtRef, data)
    }
  }
  await bw.done()
  return activityMap
}
