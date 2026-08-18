// THE ONE WRITER OF "this team is now on the Free plan".
//
// It lives in its own module for exactly one reason: an ORGANISATION lapse has
// to move its member studios to Free too (UX-9 / UX-10), and `orgs/lifecycle.ts`
// importing `saas-billing/index.ts` — a module whose top level REGISTERS every
// billing function — would be a cycle. The rule it protects is more important
// than the file it lives in: there is one downgrade path for both tiers, and an
// org-specific copy of this teardown must never be written.
//
// Callers: `saas-billing/index.ts` (the trial sweep + a cancelled team
// subscription) and `orgs/lifecycle.ts` (a lapsed organisation, per member
// studio). `orgTierRails.test.ts` re-derives that set from the source.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { TEAMS_COLLECTION, INSTALLED_PLUGINS_SUBCOLLECTION } from '@linyup/shared'
import { unpublishSiteForTeam, deleteAllCoursePublicProfiles } from '../utils/plugins'

/**
 * Move a team onto the Free plan (trial lapsed, paid subscription cancelled, or
 * the organisation that paid for it stopped paying).
 *
 * Clears the legacy wall/purge markers and deactivates plugin installs — Free
 * has no plugin access; install config is preserved so a later upgrade can
 * reactivate without losing settings.
 *
 * WHAT THIS DESTROYS, and what comes back:
 *   • published website  → `site_published/{teamId}` deleted, the DRAFT is kept.
 *     Recovered by re-publishing.
 *   • course mirrors     → `courses/{id}/public_profile/{id}` deleted for every
 *     course. NOT recovered by re-installing the plugin (UX-16: nothing rewrites
 *     a mirror on reinstall) — each course has to be re-published by hand. A
 *     contact who BOUGHT a course keeps the entitlement and loses the listing.
 *
 * Idempotent: a second call finds no active installs, so no teardown re-runs; the
 * team-doc update rewrites the same values.
 */
export async function downgradeTeamToFree(
  teamId: string,
  opts: { fromTrial: boolean }
): Promise<void> {
  const db = admin.firestore()
  const update: Record<string, unknown> = {
    plan: 'free',
    plan_status: 'active',
    suspended_at: FieldValue.delete(),
    purge_at: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  }
  if (opts.fromTrial) update.downgraded_from_trial_at = FieldValue.serverTimestamp()
  await db.collection(TEAMS_COLLECTION).doc(teamId).update(update)

  const installs = await db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(INSTALLED_PLUGINS_SUBCOLLECTION)
    .where('status', '==', 'active')
    .get()

  const activePluginIds = installs.docs.map((d) => d.id)

  for (const d of installs.docs) {
    await d.ref.set(
      { status: 'inactive', updated_at: FieldValue.serverTimestamp() },
      { merge: true }
    )
  }

  // Tear down plugin-specific public artefacts that would otherwise remain
  // visible after a downgrade (the plugin-status trigger only fires on
  // installed_plugins writes; it runs in parallel with this path so we also
  // tear down here to guarantee the artefacts are removed synchronously).
  const teardowns: Promise<void>[] = []
  if (activePluginIds.includes('website')) {
    teardowns.push(unpublishSiteForTeam(teamId))
  }
  if (activePluginIds.includes('online-courses')) {
    teardowns.push(deleteAllCoursePublicProfiles(teamId))
  }
  await Promise.all(teardowns)
}
