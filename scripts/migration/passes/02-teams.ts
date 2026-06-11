import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID } from '../config'
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
  for (const d of snap.docs) {
    teamIds.push(d.id)
    const srcData = d.data() as Record<string, unknown>
    const tgtRef  = tgt.collection('teams').doc(d.id)

    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
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
