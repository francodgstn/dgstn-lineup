// Tears down plugin-specific public artefacts when a plugin is deactivated.
// Triggered on every write to teams/{teamId}/installed_plugins/{pluginId}.
import { FieldValue } from 'firebase-admin/firestore'
import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  unpublishSiteForTeam,
  deleteAllCoursePublicProfiles,
  deleteAllDocumentPublicProfiles,
} from '../utils/plugins'
import { TEAMS_COLLECTION } from '@linyup/shared'

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

    // Only act when transitioning away from 'active':
    //   - doc deleted (afterStatus undefined) while it was active before, OR
    //   - status changed from 'active' to something else
    const wasActive = beforeStatus === 'active'
    const isStillActive = afterStatus === 'active'
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

    // Touch the team doc so syncTeamPublicProfile recomputes active_public_surfaces.
    // A lightweight server-timestamp update on a dedicated field avoids a full
    // team-document rewrite while still firing the onDocumentWritten trigger.
    await admin
      .firestore()
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .set({ plugins_updated_at: FieldValue.serverTimestamp() }, { merge: true })
  }
)
