import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb } from '../config'
import { BatchWriter } from '../batch-writer'
import { CANONICAL_SUBSCRIPTION_TYPES } from '../transforms/subscriptions'
import { transformTeamWeeklyReport } from '../transforms/team-weekly-reports'
import { transformAutomationRule } from '../transforms/automation-rules'
import { memberCapsFor, type MemberRole } from '../../lib/roles'

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

// Per-subcollection transforms, applied before a doc is written to target.
// Pulled out of the write loop so the loop body stays a plain read-check-write.
function transformSubcollectionDoc(
  sub: string,
  teamId: string,
  docId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  // team_weekly_reports: remap to the new field contract (drop deprecated fields,
  // derive new affiliation/subscription counts, remap or omit HMD-specific keys).
  if (sub === 'team_weekly_reports') return transformTeamWeeklyReport(data)

  // team_members: denormalize the capability-model fields (capabilities/scope)
  // from the migrated role so the granular-role rules gate consistently.
  if (sub === 'team_members') {
    return { ...data, ...memberCapsFor(((data as { role?: string }).role ?? 'viewer') as MemberRole) }
  }

  // automation_rules: rename the one condition type confirmed to silently break
  // (see transforms/automation-rules.ts for why); loudly flag — never silently
  // drop — condition types that have no Linyup equivalent to map to.
  if (sub === 'automation_rules') {
    const { data: transformed, unmappedConditionTypes } = transformAutomationRule(data)
    if (unmappedConditionTypes.length > 0) {
      console.warn(
        `    ${teamId}: automation_rules/${docId} ('${(data as { name?: string }).name ?? '?'}') ` +
          `carries condition type(s) [${unmappedConditionTypes.join(', ')}] retired from Linyup — ` +
          `migrated as-is but will not fire (the engine fails CLOSED on an unrecognised condition). ` +
          `Review and rebuild it with today's condition types. See scripts/MIGRATE-HMD.md → "Automation rules".`,
      )
    }
    return transformed
  }

  return data
}

// `waiver_policy` is deliberately NOT in this list, and not by omission —
// hmd-lineup has no waiver or documents concept at all (see
// firebasePaths.js), so there is no source doc to copy. A migrated team
// starting with no policy is the honest, safe state: the booking gate fails
// CLOSED on an absent policy, i.e. "no waiver required," never a silently
// skipped requirement. See scripts/MIGRATE-HMD.md → "Documents / Waivers".
// A studio that wants one authors it from /plugins/documents post-migration.

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

        // Apply per-subcollection transforms before writing — see transformSubcollectionDoc.
        const data = transformSubcollectionDoc(sub, teamId, d.id, d.data() as Record<string, unknown>)
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
            ...memberCapsFor('manager'),
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
          ...memberCapsFor('manager'),
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

    // ── Make the Products plugin available (but do NOT flip the shop live) ────
    // Migrated studios land on the studio plan, where the storefront is a core
    // surface, so install the Products plugin eagerly — it costs nothing and
    // saves the studio a settings trip once they have something to sell.
    //
    // `ActivePublicSurfaces.shop` is NOT "has this team installed the products
    // plugin" — per its doc comment (packages/shared/src/types/team.ts) it means
    // "can this studio actually be paid", and `syncTeamPublicProfile` computes it
    // from `payments_enabled` (a chargeable Stripe Connect account) alone (UX-33).
    // A fresh HMD migration never carries a Connect account, so hand-writing
    // `shop: true` here would both misreport a fact the flag doesn't track and
    // put a page of buy buttons in front of a real customer's visitors that the
    // callable refuses at checkout — the exact defect UX-33 exists to prevent
    // (see CLAUDE.md → "Seeded tenants show priced doors ONLY with a Stripe test
    // account"). Leave the flag alone: the sync trigger sets it correctly the
    // first time anything writes the team doc, and until then "not computed yet"
    // is the same safe-closed default every other surface starts from.
    const productsRef = tgt
      .collection('teams').doc(teamId)
      .collection('installed_plugins').doc('products')
    bw.set(productsRef, {
      pluginId: 'products',
      teamId,
      status: 'active',
      config: {},
      installedBy: 'migration',
      installedAt: FieldValue.serverTimestamp(),
    })
    console.log(`    ${teamId}: installed products plugin (shop surface stays gated on a chargeable Connect account)`)

    await bw.done()
  }
}
