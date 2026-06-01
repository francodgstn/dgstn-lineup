import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'

const TEAM_SUBCOLLECTIONS = [
  'team_members',          // must come first — rules depend on this for read access
  'public_profile',        // portal booking settings (ctaLabel, ctaUrl, bookingSettings)
  'subscription_types',
  'subscription_transitions',
  'outreach_templates',
  'automation_rules',
  'team_invitations',
  'contact_requests',
  'team_alerts',
  'alert_presets',
  'leaderboard',
  'activity_log',
  'team_weekly_reports',
]

export async function pass11TeamSubcollections(
  cfg: MigrationConfig,
  teamIds: string[],
): Promise<void> {
  console.log('Pass 11: team subcollections')
  const src = sourceDb()
  const tgt = targetDb()

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    const bw = new BatchWriter(tgt, cfg.dryRun)

    for (const sub of TEAM_SUBCOLLECTIONS) {
      const snap = await src.collection('teams').doc(teamId).collection(sub).get()
      for (const d of snap.docs) {
        const tgtRef = tgt.collection('teams').doc(teamId).collection(sub).doc(d.id)
        if (!cfg.dryRun) {
          const existing = await tgtRef.get()
          if (existing.exists) { bw.skip(); continue }
        }
        bw.set(tgtRef, d.data())
      }
    }

    await bw.done()
  }
}
