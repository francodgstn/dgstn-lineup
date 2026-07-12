// Tears down plugin-specific public artefacts when a plugin is deactivated —
// and runs per-plugin ACTIVATION hooks (finance: seed chart + rebuild ledger).
// Triggered on every write to teams/{teamId}/installed_plugins/{pluginId}.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  unpublishSiteForTeam,
  deleteAllCoursePublicProfiles,
  deleteAllDocumentPublicProfiles,
  touchTeamForSurfaceRecompute,
} from '../utils/plugins'
import { rebuildLedgerForTeam } from '../accounting/rebuild'

export const onInstalledPluginStatusChange = onDocumentWritten(
  'teams/{teamId}/installed_plugins/{pluginId}',
  async (event) => {
    const { teamId, pluginId } = event.params

    const beforeStatus = event.data?.before.exists
      ? (event.data.before.data()?.status as string | undefined)
      : undefined
    const afterStatus = event.data?.after.exists
      ? (event.data.after.data()?.status as string | undefined)
      : undefined

    // Recompute active_public_surfaces on EVERY write — not just deactivation.
    // Installing a plugin (or editing its config, e.g. kiosk's denormalized
    // public subset) can flip a surface live just as much as deactivating one
    // can flip it dark, so this must run unconditionally, ahead of the
    // teardown-only early-return below.
    await touchTeamForSurfaceRecompute(teamId)

    const wasActive = beforeStatus === 'active'
    const isStillActive = afterStatus === 'active'

    // ACTIVATION hook — finance plugin: seed the chart of accounts + settings
    // and replay the whole finance journal into the accounting ledger, so the
    // ledger appears fully populated the moment the plugin is installed. Fires
    // for studio/org direct installs AND coach add-on installs alike (both
    // write this doc). Timeout note: the default trigger window comfortably
    // covers current journal volumes; the "Rebuild ledger" button is the
    // manual escape hatch for anything bigger.
    if (pluginId === 'finance' && !wasActive && isStillActive) {
      try {
        await rebuildLedgerForTeam(teamId)
      } catch (err) {
        console.error(`[accounting] install-time rebuild failed team=${teamId}:`, err)
      }
      return
    }

    // Only tear down plugin-specific public artefacts when transitioning away
    // from 'active':
    //   - doc deleted (afterStatus undefined) while it was active before, OR
    //   - status changed from 'active' to something else
    if (!wasActive || isStillActive) return

    if (pluginId === 'website') {
      // Tear down published site: remove site_published/{teamId} + flag draft disabled.
      await unpublishSiteForTeam(teamId)
    } else if (pluginId === 'online-courses') {
      // Batch-delete all course/public_profile summaries for this team.
      await deleteAllCoursePublicProfiles(teamId)
    } else if (pluginId === 'documents') {
      // Batch-delete all document/public_profile summaries for this team.
      await deleteAllDocumentPublicProfiles(teamId)
    }
    // NOTE: 'finance' intentionally has NO teardown — accounting/journal data
    // are financial records and persist across deactivation (a coach add-on
    // cancel deletes the install doc but never the data); reinstall re-seeds
    // idempotently and the rebuild reconciles the gap.
  }
)
