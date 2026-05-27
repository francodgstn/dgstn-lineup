/**
 * Firestore onUpdate trigger for sessions.
 * When a session's `start` or `activityId` changes, recalculates gamification
 * scores for all participants of that session.
 * No-op when gamification is disabled (coach plan) — always safe to run.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { format } from 'date-fns'
import { to } from '../utils/async'
import { resolveGamificationSettings, type GamificationSettings } from '../utils/scoring'
import { updateTeamLeaderboard } from '../utils/leaderboard'
import { computeContactMonthScore, computeContactStreak } from '../utils/scoreComputation'
import {
  SESSIONS_COLLECTION,
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  PARTICIPANTS_SUBCOLLECTION,
  MONTHLY_SCORES_SUBCOLLECTION,
} from '@lineup/shared'


const MONTH_FORMAT = 'yyyy-MM'

function timestampsEqual(
  a: Timestamp | null | undefined,
  b: Timestamp | null | undefined
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds
}

async function recalculateMonthlyScoreSummary(
  contactId: string,
  month: string,
  teamId: string,
  settings: GamificationSettings
): Promise<void> {
  const db = admin.firestore()
  const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
  const monthlyScoresRef = contactRef.collection(MONTHLY_SCORES_SUBCOLLECTION)

  const result = await computeContactMonthScore(db, contactId, teamId, month, settings, null)

  const now = new Date()
  const currentMonth = format(now, MONTH_FORMAT)

  if (result.sessionsCount === 0) {
    // No sessions attended — remove monthly score and clear denormalised field
    const [, existingScores] = await to(
      monthlyScoresRef.where('month', '==', month).where('team_id', '==', teamId).limit(1).get()
    )
    if (existingScores && !existingScores.empty) {
      await existingScores.docs[0].ref.delete()
    }
    if (month === currentMonth) {
      await contactRef.update({ current_month_score: FieldValue.delete() })
      await updateTeamLeaderboard(teamId, currentMonth)
    }
    const streakResult = await computeContactStreak(db, contactId, teamId, settings)
    await contactRef.update({
      current_streak: streakResult.current_streak,
      streak_last_qualified_week: streakResult.streak_last_qualified_week,
    })
    return
  }

  const [findErr, existingScores] = await to(
    monthlyScoresRef.where('month', '==', month).where('team_id', '==', teamId).limit(1).get()
  )
  if (findErr) throw findErr

  const docRef =
    !existingScores || existingScores.empty ? monthlyScoresRef.doc() : existingScores.docs[0].ref

  await docRef.set(
    {
      month,
      team_id: teamId,
      total_points: result.totalPoints,
      final_score: result.finalScore,
      sessions_count: result.sessionsCount,
      updated_at: FieldValue.serverTimestamp(),
      weekly_bonus: FieldValue.delete(),
    },
    { merge: true }
  )

  if (month === currentMonth) {
    await contactRef.update({ current_month_score: result.finalScore })
    await updateTeamLeaderboard(teamId, currentMonth)
  }

  const streakResult = await computeContactStreak(db, contactId, teamId, settings)
  await contactRef.update({
    current_streak: streakResult.current_streak,
    streak_last_qualified_week: streakResult.streak_last_qualified_week,
  })
}

export const onSessionUpdate = onDocumentUpdated(
  `${SESSIONS_COLLECTION}/{sessionId}`,
  async (event) => {
    const { sessionId } = event.params
    const before = event.data!.before.data()
    const after = event.data!.after.data()

    const startChanged = !timestampsEqual(
      before.start as Timestamp | null,
      after.start as Timestamp | null
    )
    const activityChanged = before.activityId !== after.activityId

    if (!startChanged && !activityChanged) return

    console.log(
      `onSessionUpdate: session ${sessionId} changed —`,
      startChanged ? 'start' : '',
      activityChanged ? 'activityId' : ''
    )

    const teamId = (after.teamId ?? after.teacher) as string | undefined
    if (!teamId) return

    const db = admin.firestore()
    const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
    if (teamErr || !teamDoc || !teamDoc.exists) return

    // No-op when gamification is disabled (coach plan)
    const settings = resolveGamificationSettings(
      teamDoc.data()?.settings?.gamification as Partial<GamificationSettings> | undefined
    )
    if (!settings.enabled) return

    const newStartDate = (after.start as Timestamp | null)?.toDate()
    if (!newStartDate) return

    const newMonth = format(newStartDate, MONTH_FORMAT)

    const [partErr, participantsSnap] = await to(
      db
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection(PARTICIPANTS_SUBCOLLECTION)
        .get()
    )
    if (partErr || !participantsSnap || participantsSnap.empty) return

    const oldStartDate = (before.start as Timestamp | null)?.toDate()
    const oldMonth = oldStartDate ? format(oldStartDate, MONTH_FORMAT) : null

    const affectedMonths = new Set<string>([newMonth])
    if (oldMonth && oldMonth !== newMonth) affectedMonths.add(oldMonth)

    let recalculatedCount = 0
    for (const participantDoc of participantsSnap.docs) {
      const contactId = participantDoc.id
      for (const month of affectedMonths) {
        try {
          await recalculateMonthlyScoreSummary(contactId, month, teamId, settings)
          recalculatedCount++
        } catch (err) {
          console.error(
            `Error recalculating monthly score for contact ${contactId}, month ${month}:`,
            err
          )
        }
      }
    }

    console.log(`onSessionUpdate: recalculated scores for ${recalculatedCount} contact-months`)
  }
)
