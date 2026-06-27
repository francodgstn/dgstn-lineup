import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { CANONICAL_SUBSCRIPTION_TYPES } from '../transforms/subscriptions'
import { transformTeamWeeklyReport } from '../transforms/team-weekly-reports'

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
  console.log('Pass 11: team subcollections (including managers) + org admin membership')
  const src = sourceDb()
  const tgt = targetDb()

  // Resolve org admin UID from target (users were already migrated in pass01).
  // The admin needs a manager team_members entry in every club they aren't already in.
  let adminUid: string | null = null
  const adminSnap = await tgt.collection('users')
    .where('email', '==', cfg.orgAdminEmail)
    .limit(1)
    .get()
  if (adminSnap.empty) {
    console.warn(`  WARN: could not find user with email ${cfg.orgAdminEmail} in target — org admin will not be injected as manager`)
  } else {
    adminUid = adminSnap.docs[0].id
    console.log(`  org admin: ${cfg.orgAdminEmail} → uid=${adminUid}`)
  }

  for (const teamId of teamIds) {
    if (cfg.fromTeam && teamId < cfg.fromTeam) continue
    const bw = new BatchWriter(tgt, cfg.dryRun)

    // Track whether the org admin already appeared in the source team_members.
    // If so, their doc is already handled in the loop below (written or skipped
    // because it existed in target) — we must not add a second set() to the same
    // batch ref.
    let adminHandledInSource = false

    for (const sub of TEAM_SUBCOLLECTIONS) {
      const snap = await src.collection('teams').doc(teamId).collection(sub).get()
      for (const d of snap.docs) {
        const tgtRef = tgt.collection('teams').doc(teamId).collection(sub).doc(d.id)
        if (!cfg.dryRun) {
          const existing = await tgtRef.get()
          if (existing.exists) { bw.skip(); continue }
        }

        // Apply per-subcollection transforms before writing.
        // team_weekly_reports: remap to the new field contract (drop deprecated fields,
        // derive new affiliation/subscription counts, remap or omit HMD-specific keys).
        const data =
          sub === 'team_weekly_reports'
            ? transformTeamWeeklyReport(d.data() as Record<string, unknown>)
            : d.data()
        bw.set(tgtRef, data)

        if (sub === 'team_members' && adminUid && d.id === adminUid) {
          adminHandledInSource = true
        }
      }
    }

    // Inject org admin as manager for clubs where they weren't already a member.
    if (adminUid && !adminHandledInSource) {
      const memberRef = tgt
        .collection('teams').doc(teamId)
        .collection('team_members').doc(adminUid)

      if (!cfg.dryRun) {
        const existing = await memberRef.get()
        if (existing.exists) {
          bw.skip()
          console.log(`    ${teamId}: org admin already in team_members (role=${existing.data()?.role ?? '?'}) — skipping`)
        } else {
          bw.set(memberRef, {
            userId:  adminUid,
            teamId,
            role:    'manager',
            joined:  FieldValue.serverTimestamp(),
            addedBy: 'migration',
          })
          console.log(`    ${teamId}: injected org admin as manager`)
        }
      } else {
        bw.set(memberRef, {
          userId:  adminUid,
          teamId,
          role:    'manager',
          joined:  FieldValue.serverTimestamp(),
          addedBy: 'migration',
        })
      }
    } else if (adminUid && adminHandledInSource) {
      console.log(`    ${teamId}: org admin found in source team_members — migrated as-is`)
    }

    // ── Seed canonical subscription types ────────────────────────────────────
    // Write the 5 HMD Basel canonical subscription types (Essential, Students,
    // Unlimited, Intro Offer, One-time Class) into every team's subscription_types
    // subcollection. These overwrite the canonical ids on each run (idempotent set),
    // so re-running pass11 is safe. Unknown/other existing types are left untouched.
    for (const stype of CANONICAL_SUBSCRIPTION_TYPES) {
      const stRef = tgt
        .collection('teams').doc(teamId)
        .collection('subscription_types').doc(stype.id)
      // Always overwrite canonical types — they are the ground truth for pricing.
      // (No skip-if-exists check: we want these to be authoritative each run.)
      bw.set(stRef, stype)
    }
    console.log(`    ${teamId}: seeded ${CANONICAL_SUBSCRIPTION_TYPES.length} canonical subscription types`)

    await bw.done()
  }
}
