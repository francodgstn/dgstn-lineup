import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformPlace } from '../transforms/places'

// Pass 12: places. Imports each team's hmd team_places into the new Linyup model
// (label→name, mapsUrl→mapsLink, scope:'team'). Idempotent — skips docs that
// already exist in the target so a re-run won't duplicate.
export async function pass12Places(cfg: MigrationConfig, teamIds: string[]): Promise<void> {
  console.log('Pass 12: places (team_places)')
  const src = sourceDb()
  const tgt = targetDb()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    const snap = await src.collection('teams').doc(teamId).collection('team_places').get()
    if (snap.empty) continue

    const bw = new BatchWriter(tgt, cfg.dryRun)
    for (const d of snap.docs) {
      const tgtRef = tgt.collection('teams').doc(teamId).collection('team_places').doc(d.id)
      if (!cfg.dryRun) {
        const existing = await tgtRef.get()
        if (existing.exists && !cfg.overwrite) {
          bw.skip()
          continue
        }
      }
      bw.set(tgtRef, {
        teamId,
        ...transformPlace(d.id, d.data()),
        created_at: FieldValue.serverTimestamp(),
        createdBy: 'migration',
      })
    }
    await bw.done()
    console.log(`  ${teamId}: ${snap.size} place(s)`)
  }
}
