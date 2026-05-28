// Ported from hmd-lineup/functions/src/recalculateScoresFromDate/index.js
// Synchronous full recalculation callable — processes every month from startDate to now.
// Use triggerScoresRebuild + processScoresRebuildJob for the async (non-blocking) variant.
// Timeout 540s / 1GiB for large datasets.
import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { getTeamRole } from '../utils/teams'
import { resolveGamificationSettings } from '../utils/scoring'
import { updateTeamLeaderboard, getMonthlyLeaderboardPositions } from '../utils/leaderboard'
import { computeContactStreak, recalculateMonthForTeam } from '../utils/scoreComputation'

const CONTACTS_COLLECTION = 'contacts'
const TEAMS_COLLECTION = 'teams'
const BATCH_SIZE = 500

function generateMonthList(startDateStr: string): string[] {
  const start = new Date(startDateStr)
  const now = new Date()
  const months: string[] = []
  let year = start.getFullYear()
  let month = start.getMonth()
  const endYear = now.getFullYear()
  const endMonth = now.getMonth()
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`)
    month++
    if (month > 11) { month = 0; year++ }
  }
  return months
}

export const recalculateScoresFromDate = onCall(
  { timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

    const callerId = request.auth.uid
    const { teamId, startDate } = request.data as { teamId: string; startDate: string }

    if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
    if (!startDate) throw new HttpsError('invalid-argument', 'startDate is required')

    const parsedDate = new Date(startDate)
    if (isNaN(parsedDate.getTime())) throw new HttpsError('invalid-argument', 'startDate must be a valid ISO date string')

    const [roleErr, callerRole] = await to(getTeamRole(callerId, teamId))
    if (roleErr) { console.error('Error getting caller role:', roleErr); throw new HttpsError('internal', 'Failed to verify permissions') }
    if (!callerRole || !(['owner', 'manager'] as const).includes(callerRole as 'owner' | 'manager')) {
      throw new HttpsError('permission-denied', 'Only team owners and managers can recalculate scores')
    }

    const db = admin.firestore()
    const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
    if (teamErr || !teamDoc || !teamDoc.exists) throw new HttpsError('not-found', 'Team not found')

    const settings = resolveGamificationSettings(teamDoc.data()?.settings?.gamification)
    if (!settings.enabled) throw new HttpsError('failed-precondition', 'Gamification is not enabled for this team')

    const months = generateMonthList(startDate)
    if (months.length === 0) throw new HttpsError('invalid-argument', 'No months to process — startDate may be in the future')

    console.log(`Recalculating scores for team ${teamId} across ${months.length} months: ${months[0]} to ${months[months.length - 1]}`)

    const activityScoresCache: Record<string, number> = {}
    const allContactIds = new Set<string>()
    let totalRecalculated = 0

    // ── Monthly scores ─────────────────────────────────────────────────────────
    for (const month of months) {
      try {
        const { contactIds, recalculatedCount } = await recalculateMonthForTeam(db, teamId, month, settings, activityScoresCache)
        contactIds.forEach((id) => allContactIds.add(id))
        totalRecalculated += recalculatedCount
        console.log(`Month ${month}: recalculated ${recalculatedCount} contacts`)
      } catch (err) {
        console.error(`Error processing month ${month}:`, (err as Error).message ?? err)
      }
    }

    const contactIdArray = Array.from(allContactIds)

    // ── Reset leaderboard counters ─────────────────────────────────────────────
    for (let i = 0; i < contactIdArray.length; i += BATCH_SIZE) {
      const resetBatch = db.batch()
      contactIdArray.slice(i, i + BATCH_SIZE).forEach((id) => {
        resetBatch.update(db.collection(CONTACTS_COLLECTION).doc(id), { times_leader: 0, times_top5: 0 })
      })
      await resetBatch.commit()
    }

    // ── Accumulate leaderboard positions ──────────────────────────────────────
    const leaderboardCounts: Record<string, { times_leader: number; times_top5: number }> = {}
    for (const month of months) {
      try {
        const { leaderId, top5Ids } = await getMonthlyLeaderboardPositions(teamId, month)
        for (const contactId of top5Ids) {
          if (!leaderboardCounts[contactId]) leaderboardCounts[contactId] = { times_leader: 0, times_top5: 0 }
          leaderboardCounts[contactId].times_top5++
          if (contactId === leaderId) leaderboardCounts[contactId].times_leader++
        }
      } catch (err) {
        console.error(`Error computing leaderboard positions for ${month}:`, (err as Error).message ?? err)
      }
    }

    for (const [contactId, counts] of Object.entries(leaderboardCounts)) {
      try {
        await db.collection(CONTACTS_COLLECTION).doc(contactId).update(counts)
      } catch (err) {
        console.error(`Error writing leaderboard counters for ${contactId}:`, (err as Error).message ?? err)
      }
    }

    // ── distinct_activities ────────────────────────────────────────────────────
    const contactActivities: Record<string, Set<string>> = {}
    for (const month of months) {
      const monthDate = new Date(`${month}-01T00:00:00`)
      const mStart = Timestamp.fromDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1))
      const mEnd = Timestamp.fromDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59))
      const [sessErr, sessSnap] = await to(
        db.collection('sessions').where('teamId', '==', teamId).where('start', '>=', mStart).where('start', '<=', mEnd).get()
      )
      if (sessErr || !sessSnap || sessSnap.empty) continue
      for (const sessionDoc of sessSnap.docs) {
        const activityId = sessionDoc.data().activityId as string | undefined
        if (!activityId) continue
        const [partErr, partSnap] = await to(sessionDoc.ref.collection('participants').get())
        if (partErr || !partSnap || partSnap.empty) continue
        for (const partDoc of partSnap.docs) {
          const cId = partDoc.id
          if (!contactActivities[cId]) contactActivities[cId] = new Set()
          contactActivities[cId].add(activityId)
        }
      }
    }

    for (let i = 0; i < contactIdArray.length; i += BATCH_SIZE) {
      const actBatch = db.batch()
      contactIdArray.slice(i, i + BATCH_SIZE).forEach((id) => {
        actBatch.update(db.collection(CONTACTS_COLLECTION).doc(id), {
          distinct_activities: contactActivities[id] ? Array.from(contactActivities[id]) : [],
        })
      })
      await actBatch.commit()
    }

    // ── Streaks ────────────────────────────────────────────────────────────────
    let streakUpdates = 0
    for (const contactId of allContactIds) {
      try {
        const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
        const [contactGetErr, contactSnap] = await to(contactRef.get())
        const existingMaxStreak = !contactGetErr && contactSnap && contactSnap.exists ? (contactSnap.data()?.max_streak as number) || 0 : 0
        const streakResult = await computeContactStreak(db, contactId, teamId, settings)
        await contactRef.update({
          current_streak: streakResult.current_streak,
          streak_last_qualified_week: streakResult.streak_last_qualified_week,
          max_streak: Math.max(streakResult.max_streak, existingMaxStreak),
        })
        streakUpdates++
      } catch (err) {
        console.error(`Error recalculating streak for contact ${contactId}:`, (err as Error).message ?? err)
      }
    }

    // ── Current leaderboard ────────────────────────────────────────────────────
    const now = new Date()
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    await updateTeamLeaderboard(teamId, curMonth)

    return {
      success: true,
      months_processed: months.length,
      contacts_count: allContactIds.size,
      recalculated_scores: totalRecalculated,
      streak_updates: streakUpdates,
      message: `Recalculated scores for ${allContactIds.size} contacts across ${months.length} months (${months[0]} to ${months[months.length - 1]})`,
    }
  }
)
