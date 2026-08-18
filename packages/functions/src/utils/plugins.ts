// Shared plugin teardown helpers.
// Called from onInstalledPluginStatusChange (trigger) and downgradeTeamToFree
// (saas-billing) so teardown logic is never duplicated.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  TEAMS_COLLECTION,
  SITE_PUBLISHED_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  ORG_SITE_PUBLISHED_COLLECTION,
  ORG_SITE_DRAFTS_COLLECTION,
  COURSES_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  ORGANIZATIONS_COLLECTION,
  ORG_INSTALLED_PLUGINS_SUBCOLLECTION,
} from '@linyup/shared'

/**
 * Nudges the team document so `syncTeamPublicProfile` re-runs and recomputes
 * `active_public_surfaces`.
 *
 * The signals that decide surface liveness (a published site, a published
 * course/form/document) live OUTSIDE the team doc — in `site_published`, the
 * `courses`/`forms`/`documents` collections — so publishing or unpublishing that
 * content does NOT re-trigger the `onDocumentWritten('teams/{teamId}')` sync.
 * A tiny server-timestamp write on a dedicated field fires that trigger without
 * rewriting the team document. Nothing reads `surfaces_updated_at`; it exists
 * solely to re-run the recompute. Call it from any flow that flips a surface's
 * published state (see website callables + the content public_profile syncs).
 */
export async function touchTeamForSurfaceRecompute(teamId: string): Promise<void> {
  await admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .set({ surfaces_updated_at: FieldValue.serverTimestamp() }, { merge: true })
}

/**
 * The resolved ACTIVE install of `pluginId` for `teamId` — the team's own, or
 * the one its organisation installed on its behalf. Null when neither is active.
 *
 * ── ORG_ID IS THE GRANT ──────────────────────────────────────────────────────
 * This is `useInstalledPlugins`' doctrine (see its header) applied server-side.
 * An org install confers the feature on every member studio, and there is no
 * second plan check here for the same reason there is none there: joining an org
 * sets `plan: 'organization'` in the same write as `org_id`, and every plugin is
 * included at that tier, so the team's own plan already says yes.
 *
 * This function used to read the TEAM path only, which made an org-level install
 * invisible to every server-side gate — a studio could see a feature in its own
 * sidebar and be refused by the callable behind it.
 *
 * ── AN INACTIVE TEAM DOCUMENT DOES NOT VETO AN ACTIVE ORG ONE ────────────────
 * The obvious "the team document wins if it exists" reading is WRONG, and the
 * client is the specification: `useInstalledPlugins` filters to
 * `status === 'active'` FIRST and only then lets a team entry take precedence
 * over an org one. A veto here would refuse exactly what the studio can see.
 * Precedence between two ACTIVE documents still favours the team's, which is
 * why its config is returned in preference.
 */
export async function resolveActivePluginInstall(
  teamId: string,
  pluginId: string,
): Promise<Record<string, unknown> | null> {
  const db = admin.firestore()
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId)

  const [installSnap, teamSnap] = await Promise.all([
    teamRef.collection(INSTALLED_PLUGINS_SUBCOLLECTION).doc(pluginId).get(),
    teamRef.get(),
  ])
  if (installSnap.exists && installSnap.data()?.status === 'active') {
    return installSnap.data() ?? null
  }

  const orgId = teamSnap.data()?.org_id as string | undefined
  if (!orgId) return null

  const orgSnap = await db
    .collection(ORGANIZATIONS_COLLECTION)
    .doc(orgId)
    .collection(ORG_INSTALLED_PLUGINS_SUBCOLLECTION)
    .doc(pluginId)
    .get()
  return orgSnap.exists && orgSnap.data()?.status === 'active' ? (orgSnap.data() ?? null) : null
}

/** Is a plugin installed AND active for this team — its own, or its org's? */
export async function pluginIsActive(teamId: string, pluginId: string): Promise<boolean> {
  return (await resolveActivePluginInstall(teamId, pluginId)) !== null
}

/**
 * THE install gate for a plugin-delivered capability. One helper, so a new entry
 * point is a one-line addition rather than a re-derivation of what "installed"
 * means.
 *
 * ── WHERE IT BELONGS, AND WHERE IT MUST NOT GO ──────────────────────────────
 * On CREATION — selling a gift card, minting one, creating a promo code. NEVER
 * on consuming what already exists:
 *
 *   • An outstanding gift card is money the studio has ALREADY TAKEN. Refusing
 *     to redeem it because somebody unticked a plugin would be the studio
 *     keeping a customer's money and giving nothing back.
 *   • A live promo code caught mid-checkout belongs to a visitor who did
 *     nothing wrong. This matches the `requirePlan` gate it replaces, which was
 *     creation-only for the same reason.
 *
 * `packages/functions/src/connect/pluginGate.test.ts` re-derives the call sites
 * from the source, so a new creation path that forgets this fails the build,
 * and a redemption path that adds it fails too.
 */
export async function assertPluginInstalled(teamId: string, pluginId: string): Promise<void> {
  if (await pluginIsActive(teamId, pluginId)) return
  throw new HttpsError('failed-precondition', `The ${pluginId} plugin is not installed`, {
    reason: 'plugin_not_installed',
    pluginId,
  })
}

/**
 * Removes the public site snapshot and flags the site draft as disabled.
 * Mirrors the core of unpublishWebsite callable (website/index.ts) without
 * the auth/RBAC guards that are only relevant for the user-facing callable.
 */
export async function unpublishSiteForTeam(teamId: string): Promise<void> {
  const db = admin.firestore()
  await db.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).delete()
  await db.doc(`${SITE_DRAFTS_COLLECTION}/${teamId}`).set(
    { enabled: false, updated_at: FieldValue.serverTimestamp() },
    { merge: true }
  )
}

/**
 * The organisation-level counterpart: removes `org_site_published/{orgId}` and
 * flags the org draft disabled. Mirrors the core of the unpublishOrgWebsite
 * callable (orgWebsite/index.ts) without its auth guard.
 *
 * It exists because no trigger tears an ORG's artefacts down.
 * `onInstalledPluginStatusChange` is bound to
 * `teams/{teamId}/installed_plugins/{pluginId}` only, and the org-level trigger
 * that does now exist (`plugins/bundleTriggers.ts`) owns bundle reconciliation
 * and nothing else — deliberately, because the org lapse path is
 * resumable-not-atomic and a teardown step inside an eventually-consistent
 * trigger could leave a public site up after a half-run lapse. So deactivating
 * an org's `website` install still tears nothing down by itself, and
 * orgs/lifecycle.ts calls this explicitly.
 */
export async function unpublishSiteForOrg(orgId: string): Promise<void> {
  const db = admin.firestore()
  await db.doc(`${ORG_SITE_PUBLISHED_COLLECTION}/${orgId}`).delete()
  await db.doc(`${ORG_SITE_DRAFTS_COLLECTION}/${orgId}`).set(
    { enabled: false, updated_at: FieldValue.serverTimestamp() },
    { merge: true }
  )
}

/**
 * Batch-deletes every courses/{courseId}/public_profile/{courseId} summary
 * belonging to the team, effectively unpublishing all course listings.
 * Mirrors what syncCoursePublicProfile does for a single course on delete/
 * unpublish, applied to all courses of the team at once.
 *
 * ONE-WAY: nothing rewrites a mirror on reinstall (syncCoursePublicProfile fires
 * on a `courses/{id}` write only), and a contact who BOUGHT a course reaches it
 * through this mirror — so whether it runs at all is a decision, not a detail.
 * Both callers take it from `CourseMirrorDisposition` (saas-billing/downgrade.ts),
 * which is where that decision is written down.
 */
export async function deleteAllCoursePublicProfiles(teamId: string): Promise<void> {
  const db = admin.firestore()
  // Fetch all courses for the team (no status filter — removes all summaries
  // regardless of current status, since the plugin is no longer active).
  const coursesSnap = await db
    .collection(COURSES_COLLECTION)
    .where('teamId', '==', teamId)
    .get()

  if (coursesSnap.empty) return

  // Firestore batches are capped at 500 ops. Split into chunks.
  const BATCH_SIZE = 400
  const docs = coursesSnap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const courseDoc of docs.slice(i, i + BATCH_SIZE)) {
      const profileRef = courseDoc.ref.collection('public_profile').doc(courseDoc.id)
      batch.delete(profileRef)
    }
    await batch.commit()
  }
}

// There is deliberately NO deleteAllDocumentPublicProfiles here.
//
// It existed to tear down every document mirror when the Documents plugin was
// deactivated — which `downgradeTeamToFree` triggers for every lapsed team.
// Documents is now a default feature with no install to deactivate, and under a
// waiver gate that teardown was actively dangerous: a downgrade would have
// deleted the public copy of a document the booking gate points at, and emptied
// `signup_documents` in the same beat. Retiring a plan must not delete evidence.
//
// If some future feature needs a bulk mirror teardown, write it for that feature
// — do not resurrect this one.
