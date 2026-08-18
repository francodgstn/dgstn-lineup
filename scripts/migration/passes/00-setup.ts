import { FieldValue } from 'firebase-admin/firestore'
import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, ORG_ID, ORG_NAME, HMD_ORG_RANKING_SYSTEMS, EXPECTED_HMD_MODULES } from '../config'

// Path constants + default statuses mirror @linyup/shared (not importable under
// tsconfig.scripts.json). The org-level 'club' affiliation type + the reused org
// membership statuses back the migration's org-issued affiliations.
const AFFILIATION_TYPES_SUBCOLLECTION = 'affiliation_types'
const ORG_AFFILIATION_STATUSES_SUBCOLLECTION = 'affiliation_statuses'

const DEFAULT_ORG_AFFILIATION_STATUSES = [
  { id: 'guest',        label: 'Guest',        description: 'No membership process started.',                    color: 'gray',   order: 0, isBuiltIn: true, countsAsActive: false, isFinal: false },
  { id: 'requested',    label: 'Requested',    description: 'Member has submitted a request, awaiting review.',  color: 'yellow', order: 1, isBuiltIn: true, countsAsActive: false, isFinal: false },
  { id: 'under_review', label: 'Under review', description: 'Documents are being reviewed by the organisation.', color: 'blue',   order: 2, isBuiltIn: true, countsAsActive: false, isFinal: false },
  { id: 'almost_ready', label: 'Almost ready', description: 'Review complete, awaiting final confirmation.',     color: 'purple', order: 3, isBuiltIn: true, countsAsActive: false, isFinal: false },
  { id: 'active',       label: 'Active',       description: 'Valid membership, recognised by the federation.',    color: 'green',  order: 4, isBuiltIn: true, countsAsActive: true,  isFinal: false },
  { id: 'expired',      label: 'Expired',      description: 'Membership period has ended. Renewal required.',     color: 'red',    order: 5, isBuiltIn: true, countsAsActive: false, isFinal: true },
] as const

const ORG_CLUB_AFFILIATION_TYPE = {
  id: 'club', key: 'club', label: 'Club membership', default_issuer: 'org', org_id: ORG_ID, active: true, order: 0,
}

export async function pass00Setup(cfg: MigrationConfig): Promise<void> {
  console.log('Pass 0: org setup')
  const src = sourceDb()
  const tgt = targetDb()

  // Resolve the admin user UID from their email in the source users collection
  const userSnap = await src.collection('users')
    .where('email', '==', cfg.orgAdminEmail)
    .limit(1)
    .get()

  if (userSnap.empty) {
    console.warn(`  WARN: no user found with email ${cfg.orgAdminEmail} — org will be created without a createdBy UID`)
  }

  const adminUid = userSnap.empty ? null : userSnap.docs[0].id
  console.log(`  org admin: ${cfg.orgAdminEmail} → uid=${adminUid ?? 'unknown'}`)

  if (cfg.dryRun) {
    console.log(`  [dry-run] would create organizations/${ORG_ID} and org_members/${adminUid}`)
    return
  }

  // Create/update the org document with ranking systems (always merge so re-runs are safe)
  const orgRef = tgt.collection('organizations').doc(ORG_ID)
  const orgSnap = await orgRef.get()
  if (orgSnap.exists) {
    // Always update ranking_systems even if org already existed
    await orgRef.set({ ranking_systems: HMD_ORG_RANKING_SYSTEMS }, { merge: true })
    console.log(`  organizations/${ORG_ID} updated — ranking systems applied`)
  } else {
    await orgRef.set({
      name:             ORG_NAME,
      slug:             ORG_ID,
      createdBy:        adminUid,
      created:          FieldValue.serverTimestamp(),
      ranking_systems:  HMD_ORG_RANKING_SYSTEMS,
    })
    console.log(`  created organizations/${ORG_ID} with ${HMD_ORG_RANKING_SYSTEMS.length} ranking systems`)
  }

  // Seed the org membership statuses (reused as affiliation statuses) + the
  // org-level 'club' affiliation type that backs org-issued affiliations.
  for (const st of DEFAULT_ORG_AFFILIATION_STATUSES) {
    await orgRef.collection(ORG_AFFILIATION_STATUSES_SUBCOLLECTION).doc(st.id).set(st)
  }
  await orgRef
    .collection(AFFILIATION_TYPES_SUBCOLLECTION)
    .doc(ORG_CLUB_AFFILIATION_TYPE.id)
    .set(ORG_CLUB_AFFILIATION_TYPE)
  console.log(`  seeded ${DEFAULT_ORG_AFFILIATION_STATUSES.length} membership statuses + org 'club' affiliation type`)

  // Create the org_admin member doc (idempotent)
  if (adminUid) {
    const memberRef = orgRef.collection('org_members').doc(adminUid)
    const memberSnap = await memberRef.get()
    if (memberSnap.exists) {
      console.log(`  org_members/${adminUid} already exists — skipping`)
    } else {
      await memberRef.set({
        userId:  adminUid,
        email:   cfg.orgAdminEmail,
        role:    'org_admin',
        joined:  FieldValue.serverTimestamp(),
      })
      console.log(`  created org_members/${adminUid} (org_admin)`)
    }
  }

  // Pre-install the HMD plugin CONTAINER at org level (idempotent).
  //
  // The container ONLY. Its members (today: hmd-fighting-cup) are materialized
  // by the `onOrgBundleInstallChange` trigger from `config.modules` — writing
  // them here would make this script a second writer of member installs, which
  // the bundle census test forbids and which would drift from the reconciler's
  // idea of what the container owns (no `installedByBundle` stamp, so the
  // reconciler would never clean them up).
  const containerPluginId = 'hmd'
  const pluginRef = orgRef.collection('installed_plugins').doc(containerPluginId)
  const pluginSnap = await pluginRef.get()
  if (pluginSnap.exists) {
    console.log(`  installed_plugins/${containerPluginId} already exists — skipping`)
  } else {
    await pluginRef.set({
      pluginId:    containerPluginId,
      orgId:       ORG_ID,
      installedAt: FieldValue.serverTimestamp(),
      installedBy: 'migration',
      status:      'active',
      // Empty: an absent module reads as ON, so every member ships enabled and a
      // module added later reaches this org without a data edit.
      config:      {},
    })
    console.log(`  created installed_plugins/${containerPluginId} (org-level container, migration)`)
  }

  // The members are the reconciler's job, and it only runs if the functions are
  // deployed against this target. Say so loudly rather than leaving a migration
  // that looks like it worked and left HMD without its Fighting Cup.
  await assertBundleMembersMaterialized(orgRef, containerPluginId, EXPECTED_HMD_MODULES)
}

/**
 * Wait briefly for the bundle reconciler to materialize a container's members,
 * and WARN clearly if it does not.
 *
 * Deliberately a warning and not a throw: the emulator target frequently runs
 * without the functions emulator, and failing a two-hour data migration over a
 * document that one deploy will create is the wrong trade. But saying nothing is
 * worse — the container looks installed while the feature it packages is absent.
 */
async function assertBundleMembersMaterialized(
  orgRef: FirebaseFirestore.DocumentReference,
  containerId: string,
  expected: readonly string[],
): Promise<void> {
  const deadline = Date.now() + 15_000
  let missing: string[] = []
  do {
    const snaps = await Promise.all(
      expected.map((id) => orgRef.collection('installed_plugins').doc(id).get()),
    )
    missing = expected.filter((_, i) => !snaps[i].exists)
    if (missing.length === 0) {
      console.log(`  bundle '${containerId}' reconciled — members: ${expected.join(', ')}`)
      return
    }
    await new Promise((r) => setTimeout(r, 1500))
  } while (Date.now() < deadline)

  console.warn(
    `  WARN: bundle '${containerId}' has not materialized ${missing.join(', ')}.
` +
    `        The onOrgBundleInstallChange trigger is what creates these. Deploy the
` +
    `        Cloud Functions against this target (or start the functions emulator) and
` +
    `        re-run this pass — the container install alone gives HMD nothing.`,
  )
}
