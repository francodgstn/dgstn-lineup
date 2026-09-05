// ONE writer for teams/{teamId}/notifications — every TeamNotification document
// is built HERE; no call site hand-rolls a document of its own. See
// packages/shared/src/types/teamNotification.ts for the full "why" (the same
// absence is what let the retired `team_alerts` grow two incompatible writer
// shapes and a reader that matched neither).
//
// The caller supplies `type` / `title` / `body` / `link` plus whichever
// type-specific payload fields `TeamNotification` declares for that `type`
// (orgId/orgName, contact_id/contact_name/request_id, form_id/submission_id…).
// This helper owns `status` and `created_at` — a caller cannot set either, and
// every notification is born `'unread'`.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { NOTIFICATIONS_SUBCOLLECTION, TEAMS_COLLECTION } from '@linyup/shared'
import type { TeamNotification } from '@linyup/shared'

/** Everything a caller may set. `id` / `status` / `created_at` / `read_at` are
 *  owned by `createTeamNotification`, not the caller. */
export type TeamNotificationInput = Omit<TeamNotification, 'id' | 'status' | 'created_at' | 'read_at'>

export async function createTeamNotification(
  teamId: string,
  input: TeamNotificationInput,
  db: admin.firestore.Firestore = admin.firestore()
): Promise<admin.firestore.DocumentReference> {
  const ref = db
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(NOTIFICATIONS_SUBCOLLECTION)
    .doc()
  await ref.set({
    ...input,
    link: input.link ?? null,
    status: 'unread',
    created_at: FieldValue.serverTimestamp(),
  })
  return ref
}
