import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { getTeamRole } from '../utils/teams'
import { resolveGamificationSettings } from '../utils/scoring'
import { updateTeamLeaderboard, incrementLeaderboardCounters, clearTeamLeaderboard } from '../utils/leaderboard'
import { recalculateMonthForTeam, computeContactStreak } from '../utils/scoreComputation'


const CONTACTS_COLLECTION = 'contacts'
const TEAMS_COLLECTION = 'teams'
const MONTHLY_SCORES_SUBCOLLECTION = 'monthly_scores'

export const recalculateScores = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')

  const { teamId, month } = request.data as { teamId?: string; month?: string }
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    throw new HttpsError('invalid-argument', 'month is required in YYYY-MM format')

  const [roleErr, callerRole] = await to(getTeamRole(request.auth.uid, teamId))
  if (roleErr) throw new HttpsError('internal', 'Failed to verify permissions')
  if (!['owner', 'manager'].includes(callerRole as string))
    throw new HttpsError('permission-denied', 'Only team owners and managers can recalculate scores')

  const db = admin.firestore()
  const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamErr || !teamDoc || !teamDoc.exists) throw new HttpsError('not-found', 'Team not found')

  const settings = resolveGamificationSettings(teamDoc.data()?.settings?.gamification)
  if (!settings.enabled) throw new HttpsError('failed-precondition', 'Gamification is not enabled for this team')

  const activityScoresCache: Record<string, number> = {}
  const { contactIds, recalculatedCount } = await recalculateMonthForTeam(db, teamId, month, settings, activityScoresCache)

  for (const contactId of contactIds) {
    try {
      const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)
      const [contactGetErr, contactSnap] = await to(contactRef.get())
      const existingMaxStreak = (!contactGetErr && contactSnap && contactSnap.exists)
        ? ((contactSnap.data()?.max_streak as number) || 0)
        : 0
      const streakResult = await computeContactStreak(db, contactId, teamId, settings)
      await contactRef.update({
        current_streak: streakResult.current_streak,
        streak_last_qualified_week: streakResult.streak_last_qualified_week,
        max_streak: Math.max(streakResult.max_streak, existingMaxStreak),
      })
    } catch (err) {
      console.error(`Error recalculating streak for contact ${contactId}:`, err)
    }
  }

  const now = new Date()
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (month === curMonth) {
    await updateTeamLeaderboard(teamId, curMonth)
    const [topErr, topSnap] = await to(
      db.collection(CONTACTS_COLLECTION)
        .where('teamId', '==', teamId)
        .where('deleted_at', '==', null)
        .where('current_month_score', '>', 0)
        .orderBy('current_month_score', 'desc')
        .limit(5)
        .get(),
    )
    if (!topErr && topSnap) {
      const top5Ids = topSnap.docs.map((d) => d.id)
      await incrementLeaderboardCounters(top5Ids[0] ?? null, top5Ids)
    }
  }

  return { success: true, message: `Recalculated scores for ${recalculatedCount} contacts`, contacts_count: recalculatedCount }
})

export const resetScores = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')

  const { teamId, month } = request.data as { teamId?: string; month?: string }
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    throw new HttpsError('invalid-argument', 'month is required in YYYY-MM format')

  const [roleErr, callerRole] = await to(getTeamRole(request.auth.uid, teamId))
  if (roleErr) throw new HttpsError('internal', 'Failed to verify permissions')
  if (!['owner', 'manager'].includes(callerRole as string))
    throw new HttpsError('permission-denied', 'Only team owners and managers can reset scores')

  const db = admin.firestore()
  const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamErr || !teamDoc || !teamDoc.exists) throw new HttpsError('not-found', 'Team not found')

  const contactIds = new Set<string>()
  const BATCH_SIZE = 400
  let batch = db.batch()
  let batchCount = 0

  const [msErr, msSnap] = await to(
    db.collectionGroup(MONTHLY_SCORES_SUBCOLLECTION)
      .where('team_id', '==', teamId)
      .where('month', '==', month)
      .get(),
  )
  if (msErr || !msSnap) throw new HttpsError('internal', 'Failed to fetch monthly scores')

  for (const doc of msSnap.docs) {
    const contactId = doc.ref.parent.parent!.id
    contactIds.add(contactId)
    batch.delete(doc.ref)
    batchCount++
    if (batchCount >= BATCH_SIZE) {
      await batch.commit()
      batch = db.batch()
      batchCount = 0
    }
  }

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (month === currentMonth) {
    for (const contactId of contactIds) {
      batch.update(db.collection(CONTACTS_COLLECTION).doc(contactId), {
        current_month_score: FieldValue.delete(),
        current_streak: FieldValue.delete(),
        streak_last_qualified_week: FieldValue.delete(),
      })
      batchCount++
      if (batchCount >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchCount = 0
      }
    }
  }

  if (batchCount > 0) await batch.commit()
  if (month === currentMonth) await clearTeamLeaderboard(teamId, month)

  return { success: true, message: `Reset scores for ${contactIds.size} contacts`, contacts_count: contactIds.size }
})
