// Ported from hmd-lineup/functions/src/triggerScoresRebuild/index.js
// Creates a rebuild_jobs document and returns immediately; actual processing is done by
// the processScoresRebuildJob Firestore trigger (heavy async work runs in background).
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { getTeamRole } from '../utils/teams'
import { resolveGamificationSettings } from '../utils/scoring'

const TEAMS_COLLECTION = 'teams'
const REBUILD_JOBS_SUBCOLLECTION = 'rebuild_jobs'

export const triggerScoresRebuild = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const callerId = request.auth.uid
  const {
    teamId,
    startDate,
    rebuildScores,
    rebuildLeaderboardCounters,
    rebuildLeaderboardHistory,
    rebuildActivities,
    rebuildStreaks,
    rebuildCurrentLeaderboard,
  } = request.data as {
    teamId: string
    startDate: string
    rebuildScores?: boolean
    rebuildLeaderboardCounters?: boolean
    rebuildLeaderboardHistory?: boolean
    rebuildActivities?: boolean
    rebuildStreaks?: boolean
    rebuildCurrentLeaderboard?: boolean
  }

  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!startDate) throw new HttpsError('invalid-argument', 'startDate is required')

  const parsedDate = new Date(startDate)
  if (isNaN(parsedDate.getTime())) throw new HttpsError('invalid-argument', 'startDate must be a valid ISO date string')

  const [roleErr, callerRole] = await to(getTeamRole(callerId, teamId))
  if (roleErr) throw new HttpsError('internal', 'Failed to verify permissions')
  if (!callerRole || !(['owner', 'manager'] as const).includes(callerRole as 'owner' | 'manager')) {
    throw new HttpsError('permission-denied', 'Only team owners and managers can rebuild scoring history')
  }

  const db = admin.firestore()
  const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamErr || !teamDoc || !teamDoc.exists) throw new HttpsError('not-found', 'Team not found')

  const settings = resolveGamificationSettings(teamDoc.data()?.settings?.gamification)
  if (!settings.enabled) throw new HttpsError('failed-precondition', 'Gamification is not enabled for this team')

  const stepFlags: Record<string, boolean> = {}
  if (rebuildScores !== undefined) stepFlags.rebuildScores = rebuildScores
  if (rebuildLeaderboardCounters !== undefined) stepFlags.rebuildLeaderboardCounters = rebuildLeaderboardCounters
  if (rebuildLeaderboardHistory !== undefined) stepFlags.rebuildLeaderboardHistory = rebuildLeaderboardHistory
  if (rebuildActivities !== undefined) stepFlags.rebuildActivities = rebuildActivities
  if (rebuildStreaks !== undefined) stepFlags.rebuildStreaks = rebuildStreaks
  if (rebuildCurrentLeaderboard !== undefined) stepFlags.rebuildCurrentLeaderboard = rebuildCurrentLeaderboard

  const jobRef = db.collection(TEAMS_COLLECTION).doc(teamId).collection(REBUILD_JOBS_SUBCOLLECTION).doc()
  await jobRef.set({
    teamId,
    startDate,
    ...stepFlags,
    status: 'pending',
    created_at: FieldValue.serverTimestamp(),
    triggered_by: callerId,
  })

  return { jobId: jobRef.id }
})
