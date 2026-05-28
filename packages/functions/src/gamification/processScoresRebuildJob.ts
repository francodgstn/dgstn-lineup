// Ported from hmd-lineup/functions/src/processScoresRebuildJob/index.js
// Firestore onCreate trigger on teams/{teamId}/rebuild_jobs/{jobId}.
// Executes the full score rebuild asynchronously, updating job status so the frontend
// can react via onSnapshot. Timeout 540s / 1GiB for large datasets.
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { to } from '../utils/async'
import { resolveGamificationSettings } from '../utils/scoring'
import {
  updateTeamLeaderboard,
  getMonthlyLeaderboardPositions,
  snapshotLeaderboardHistory,
} from '../utils/leaderboard'
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

export const processScoresRebuildJob = onDocumentCreated(
  {
    document: `${TEAMS_COLLECTION}/{teamId}/rebuild_jobs/{jobId}`,
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (event) => {
    const db = admin.firestore()
    const jobRef = event.data!.ref
    const { teamId } = event.params
    const jobData = event.data!.data()

    const {
      startDate,
      rebuildScores = true,
      rebuildLeaderboardCounters = true,
      rebuildLeaderboardHistory = false,
      rebuildActivities = true,
      rebuildStreaks = true,
      rebuildCurrentLeaderboard = true,
    } = jobData as {
      startDate: string
      rebuildScores?: boolean
      rebuildLeaderboardCounters?: boolean
      rebuildLeaderboardHistory?: boolean
      rebuildActivities?: boolean
      rebuildStreaks?: boolean
      rebuildCurrentLeaderboard?: boolean
    }

    await jobRef.update({ status: 'running' })

    try {
      const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
      if (teamErr || !teamDoc || !teamDoc.exists) throw new Error('Team not found')

      const settings = resolveGamificationSettings(teamDoc.data()?.settings?.gamification)
      const months = generateMonthList(startDate)
      if (months.length === 0) throw new Error('No months to process')

      console.log(
        `[rebuild job] team=${teamId} months=${months.length} (${months[0]} → ${months[months.length - 1]}) steps: scores=${rebuildScores} counters=${rebuildLeaderboardCounters} history=${rebuildLeaderboardHistory} activities=${rebuildActivities} streaks=${rebuildStreaks} leaderboard=${rebuildCurrentLeaderboard}`
      )

      const activityScoresCache: Record<string, number> = {}
      const allContactIds = new Set<string>()
      let totalRecalculated = 0

      // ── Scores ────────────────────────────────────────────────────────────────
      if (rebuildScores) {
        for (const month of months) {
          try {
            const { contactIds, recalculatedCount } = await recalculateMonthForTeam(db, teamId, month, settings, activityScoresCache)
            contactIds.forEach((id) => allContactIds.add(id))
            totalRecalculated += recalculatedCount
            console.log(`[rebuild job] month ${month}: ${recalculatedCount} contacts`)
          } catch (err) {
            console.error(`[rebuild job] error in month ${month}:`, (err as Error).message)
          }
        }
      }

      // ── Leaderboard counters (times_leader / times_top5) ──────────────────────
      if (rebuildLeaderboardCounters) {
        const [activeErr, activeSnap] = await to(
          db.collection(CONTACTS_COLLECTION).where('teamId', '==', teamId).where('deleted_at', '==', null).get()
        )
        const activeContactIdSet = new Set(!activeErr && activeSnap ? activeSnap.docs.map((d) => d.id) : [])
        const contactIdArray = Array.from(allContactIds).filter((id) => activeContactIdSet.has(id))

        // Reset counters
        for (let i = 0; i < contactIdArray.length; i += BATCH_SIZE) {
          const batch = db.batch()
          contactIdArray.slice(i, i + BATCH_SIZE).forEach((id) => {
            batch.update(db.collection(CONTACTS_COLLECTION).doc(id), { times_leader: 0, times_top5: 0 })
          })
          await batch.commit()
        }

        // Accumulate across months
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
            console.error(`[rebuild job] leaderboard counters error for ${month}:`, (err as Error).message)
          }
        }

        for (const [contactId, counts] of Object.entries(leaderboardCounts)) {
          try {
            await db.collection(CONTACTS_COLLECTION).doc(contactId).update(counts)
          } catch (err) {
            console.error(`[rebuild job] leaderboard write error for ${contactId}:`, (err as Error).message)
          }
        }
      }

      // ── Leaderboard history snapshots ──────────────────────────────────────────
      if (rebuildLeaderboardHistory) {
        for (const month of months) {
          try {
            await snapshotLeaderboardHistory(teamId, month)
            console.log(`[rebuild job] leaderboard history snapped: ${month}`)
          } catch (err) {
            console.error(`[rebuild job] leaderboard history error for ${month}:`, (err as Error).message)
          }
        }
      }

      // ── distinct_activities ────────────────────────────────────────────────────
      if (rebuildActivities) {
        const [activeErr2, activeSnap2] = await to(
          db.collection(CONTACTS_COLLECTION).where('teamId', '==', teamId).where('deleted_at', '==', null).get()
        )
        const activeContactIdSet2 = new Set(!activeErr2 && activeSnap2 ? activeSnap2.docs.map((d) => d.id) : [])
        const contactIdArray2 = Array.from(allContactIds).filter((id) => activeContactIdSet2.has(id))

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

        for (let i = 0; i < contactIdArray2.length; i += BATCH_SIZE) {
          const batch = db.batch()
          contactIdArray2.slice(i, i + BATCH_SIZE).forEach((id) => {
            batch.update(db.collection(CONTACTS_COLLECTION).doc(id), {
              distinct_activities: contactActivities[id] ? Array.from(contactActivities[id]) : [],
            })
          })
          await batch.commit()
        }
      }

      // ── Streaks ────────────────────────────────────────────────────────────────
      if (rebuildStreaks) {
        for (const contactId of allContactIds) {
          try {
            const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
            const [getErr, contactSnap] = await to(contactRef.get())
            const existingMaxStreak = !getErr && contactSnap && contactSnap.exists ? (contactSnap.data()?.max_streak as number) || 0 : 0
            const streakResult = await computeContactStreak(db, contactId, teamId, settings)
            await contactRef.update({
              current_streak: streakResult.current_streak,
              streak_last_qualified_week: streakResult.streak_last_qualified_week,
              max_streak: Math.max(streakResult.max_streak, existingMaxStreak),
            })
          } catch (err) {
            console.error(`[rebuild job] streak error for ${contactId}:`, (err as Error).message)
          }
        }
      }

      // ── Current leaderboard ────────────────────────────────────────────────────
      if (rebuildCurrentLeaderboard) {
        const now = new Date()
        const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        await updateTeamLeaderboard(teamId, curMonth)
      }

      const stepsRun = [
        rebuildScores && 'scores',
        rebuildLeaderboardCounters && 'counters',
        rebuildLeaderboardHistory && 'history',
        rebuildActivities && 'activities',
        rebuildStreaks && 'streaks',
        rebuildCurrentLeaderboard && 'leaderboard',
      ].filter(Boolean).join(', ')

      const message = `Rebuilt [${stepsRun}] for ${allContactIds.size} contacts across ${months.length} months (${months[0]} → ${months[months.length - 1]})`
      console.log(`[rebuild job] completed: ${message}`)

      await jobRef.update({
        status: 'completed',
        message,
        contacts_count: allContactIds.size,
        months_processed: months.length,
        recalculated_scores: totalRecalculated,
        completed_at: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[rebuild job] failed:', (err as Error).message ?? err)
      await jobRef.update({
        status: 'failed',
        error: (err as Error).message ?? 'Unknown error',
        failed_at: FieldValue.serverTimestamp(),
      })
    }
  }
)
