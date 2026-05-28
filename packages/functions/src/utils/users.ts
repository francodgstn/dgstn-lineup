// Ported from hmd-lineup/functions/src/utils/users.js — logActivity helper only.
// getUserWeeklyReport and findUserWeeklyReportByDate are defined in the analytics module.
import * as admin from 'firebase-admin'
import { to } from './async'

const TEAMS_COLLECTION = 'teams'
const ACTIVITY_LOG_SUBCOLLECTION = 'activity_log'

/**
 * Writes an entry to the team's activity_log subcollection.
 */
export async function logActivity(teamId: string, logData: Record<string, unknown>): Promise<void> {
  const activityLogRef = admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(ACTIVITY_LOG_SUBCOLLECTION)
    .doc()

  const [createErr] = await to(activityLogRef.set(logData))
  if (createErr) {
    console.error('Error creating activity_log entry', createErr.message || createErr)
    throw createErr
  }
}
