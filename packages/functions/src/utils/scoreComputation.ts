import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { to } from './async'
import {
  calculateAttendancePoints,
  getTimeMultiplier,
  calculateMonthlyScore,
  calculateStreak,
  type GamificationSettings,
} from './scoring'

const SESSIONS_COLLECTION = 'sessions'
const CONTACTS_COLLECTION = 'contacts'
const ACTIVITIES_COLLECTION = 'activities'
const MONTHLY_SCORES_SUBCOLLECTION = 'monthly_scores'

const ISO_WEEK_FORMAT = `R-'W'II`

export async function fetchActivityScoresCache(
  db: admin.firestore.Firestore,
  sessionDocs: admin.firestore.QueryDocumentSnapshot[],
  defaultBaseScore: number,
): Promise<Record<string, number>> {
  const activityIds = [
    ...new Set(sessionDocs.map((doc) => (doc.data().activityId as string | undefined)).filter(Boolean) as string[]),
  ]
  const cache: Record<string, number> = {}
  for (const actId of activityIds) {
    const [actErr, actDoc] = await to(db.collection(ACTIVITIES_COLLECTION).doc(actId).get())
    if (!actErr && actDoc && actDoc.exists) {
      const bs = actDoc.data()?.base_score
      if (bs != null) cache[actId] = bs as number
    }
  }
  return cache
}

export async function recalculateMonthForTeam(
  db: admin.firestore.Firestore,
  teamId: string,
  month: string,
  settings: GamificationSettings,
  activityScoresCache: Record<string, number>,
): Promise<{ contactIds: string[]; recalculatedCount: number }> {
  const monthDate = new Date(`${month}-01T00:00:00`)
  const mStart = Timestamp.fromDate(startOfMonth(monthDate))
  const mEnd = Timestamp.fromDate(endOfMonth(monthDate))

  const [sessionsErr, sessionsSnap] = await to(
    db.collection(SESSIONS_COLLECTION)
      .where('teamId', '==', teamId)
      .where('start', '>=', mStart)
      .where('start', '<=', mEnd)
      .get(),
  )
  if (sessionsErr || !sessionsSnap || sessionsSnap.empty) {
    return { contactIds: [], recalculatedCount: 0 }
  }

  // Merge new activity IDs into cache
  const newIds = [...new Set(
    sessionsSnap.docs.map((d) => d.data().activityId as string | undefined).filter(Boolean) as string[],
  )].filter((id) => !(id in activityScoresCache))
  for (const actId of newIds) {
    const [err, doc] = await to(db.collection(ACTIVITIES_COLLECTION).doc(actId).get())
    if (!err && doc && doc.exists) {
      const bs = doc.data()?.base_score
      if (bs != null) activityScoresCache[actId] = bs as number
    }
  }

  const contactScores: Record<string, { logs: Array<{ iso_week: string; base_score: number; time_multiplier: number }> }> = {}

  for (const sessionDoc of sessionsSnap.docs) {
    const sessionData = sessionDoc.data()
    const sessionStartDate: Date | undefined = sessionData.start?.toDate()
    if (!sessionStartDate) continue

    const isoWeek = format(sessionStartDate, ISO_WEEK_FORMAT)
    const baseScore = (activityScoresCache[sessionData.activityId as string] ?? settings.default_base_score)
    const timeMultiplier = getTimeMultiplier(sessionStartDate, settings.time_multipliers)

    const [partErr, partSnap] = await to(
      db.collection(SESSIONS_COLLECTION).doc(sessionDoc.id).collection('participants').get(),
    )
    if (partErr || !partSnap || partSnap.empty) continue

    for (const partDoc of partSnap.docs) {
      const contactId = partDoc.id
      if (!contactScores[contactId]) contactScores[contactId] = { logs: [] }
      contactScores[contactId].logs.push({ iso_week: isoWeek, base_score: baseScore, time_multiplier: timeMultiplier })
    }
  }

  const contactIds = Object.keys(contactScores)
  let recalculatedCount = 0

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = month === currentMonth
  const BATCH_SIZE = 100

  if (isCurrentMonth) {
    const [allContactsErr, allContactsSnap] = await to(
      db.collection(CONTACTS_COLLECTION)
        .where('teamId', '==', teamId)
        .where('deleted_at', '==', null)
        .get(),
    )
    if (!allContactsErr && allContactsSnap && !allContactsSnap.empty) {
      for (let s = 0; s < allContactsSnap.docs.length; s += BATCH_SIZE) {
        const clearBatch = db.batch()
        for (const d of allContactsSnap.docs.slice(s, s + BATCH_SIZE)) {
          clearBatch.update(d.ref, { current_month_score: FieldValue.delete() })
        }
        await clearBatch.commit()
      }
    }
  }

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batchIds = contactIds.slice(i, i + BATCH_SIZE)
    const batch = db.batch()

    for (const contactId of batchIds) {
      const entry = contactScores[contactId]
      const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)

      let totalPoints = 0
      for (const log of entry.logs) {
        totalPoints += calculateAttendancePoints(log.base_score, log.time_multiplier)
      }
      const finalScore = calculateMonthlyScore(totalPoints, settings.monthly_cap)

      const [msErr, msSnap] = await to(
        contactRef.collection(MONTHLY_SCORES_SUBCOLLECTION)
          .where('month', '==', month)
          .where('team_id', '==', teamId)
          .limit(1)
          .get(),
      )
      const msRef = (!msErr && msSnap && !msSnap.empty)
        ? msSnap.docs[0].ref
        : contactRef.collection(MONTHLY_SCORES_SUBCOLLECTION).doc()

      batch.set(msRef, {
        month,
        team_id: teamId,
        total_points: totalPoints,
        final_score: finalScore,
        sessions_count: entry.logs.length,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true })

      if (isCurrentMonth) {
        batch.update(contactRef, { current_month_score: finalScore })
      }
      recalculatedCount++
    }

    const [commitErr] = await to(batch.commit())
    if (commitErr) throw new Error(`Failed to write recalculated scores for ${month}`)
  }

  return { contactIds, recalculatedCount }
}

/**
 * Compute the monthly score for a single contact in a given month.
 * Used by onSessionUpdate to recalculate after session edits.
 */
export async function computeContactMonthScore(
  db: admin.firestore.Firestore,
  contactId: string,
  teamId: string,
  month: string,
  settings: GamificationSettings,
  _activityScoresCache: Record<string, number> | null,
): Promise<{ totalPoints: number; finalScore: number; sessionsCount: number }> {
  const monthDate = new Date(`${month}-01T00:00:00`)
  const mStart = Timestamp.fromDate(startOfMonth(monthDate))
  const mEnd = Timestamp.fromDate(endOfMonth(monthDate))

  const [sessionsErr, sessionsSnap] = await to(
    db.collection(SESSIONS_COLLECTION)
      .where('teamId', '==', teamId)
      .where('start', '>=', mStart)
      .where('start', '<=', mEnd)
      .get(),
  )
  if (sessionsErr || !sessionsSnap || sessionsSnap.empty) {
    return { totalPoints: 0, finalScore: 0, sessionsCount: 0 }
  }

  let totalPoints = 0
  let sessionsCount = 0

  for (const sessionDoc of sessionsSnap.docs) {
    const partRef = db
      .collection(SESSIONS_COLLECTION)
      .doc(sessionDoc.id)
      .collection('participants')
      .doc(contactId)
    const [, partSnap] = await to(partRef.get())
    if (!partSnap || !partSnap.exists) continue

    const sessionData = sessionDoc.data()
    const startDate: Date | undefined = sessionData.start?.toDate()
    if (!startDate) continue

    const actId = sessionData.activityId as string | undefined
    let baseScore = settings.default_base_score
    if (actId) {
      const [, actDoc] = await to(db.collection(ACTIVITIES_COLLECTION).doc(actId).get())
      if (actDoc && actDoc.exists) {
        const bs = actDoc.data()?.base_score
        if (bs != null) baseScore = bs as number
      }
    }

    const timeMultiplier = getTimeMultiplier(startDate, settings.time_multipliers)
    totalPoints += calculateAttendancePoints(baseScore, timeMultiplier)
    sessionsCount++
  }

  const finalScore = calculateMonthlyScore(totalPoints, settings.monthly_cap)
  return { totalPoints, finalScore, sessionsCount }
}

export async function computeContactStreak(
  db: admin.firestore.Firestore,
  contactId: string,
  teamId: string,
  settings: GamificationSettings,
): Promise<{ current_streak: number; streak_last_qualified_week: string | null; max_streak: number }> {
  const currentIsoWeek = format(new Date(), ISO_WEEK_FORMAT)
  const weeklySessionCounts: Record<string, number> = {}
  const weeklyTotalSessionCounts: Record<string, number> = {}
  const PARALLEL_BATCH = 10
  const now = new Date()

  for (let i = 0; i < 12; i++) {
    const targetDate = i === 0 ? now : subMonths(now, i)
    const mStart = Timestamp.fromDate(startOfMonth(targetDate))
    const mEnd = Timestamp.fromDate(endOfMonth(targetDate))

    const [sessionsErr, sessionsSnap] = await to(
      db.collection(SESSIONS_COLLECTION)
        .where('teamId', '==', teamId)
        .where('start', '>=', mStart)
        .where('start', '<=', mEnd)
        .get(),
    )
    if (sessionsErr || !sessionsSnap || sessionsSnap.empty) continue

    for (const sessionDoc of sessionsSnap.docs) {
      const startDate: Date | undefined = sessionDoc.data().start?.toDate()
      if (!startDate) continue
      const isoWeek = format(startDate, ISO_WEEK_FORMAT)
      weeklyTotalSessionCounts[isoWeek] = (weeklyTotalSessionCounts[isoWeek] ?? 0) + 1
    }

    for (let b = 0; b < sessionsSnap.docs.length; b += PARALLEL_BATCH) {
      const batchDocs = sessionsSnap.docs.slice(b, b + PARALLEL_BATCH)
      const checks = batchDocs.map(async (sessionDoc) => {
        const partRef = db.collection(SESSIONS_COLLECTION).doc(sessionDoc.id).collection('participants').doc(contactId)
        const [getErr, partSnap] = await to(partRef.get())
        if (getErr || !partSnap || !partSnap.exists) return null
        return sessionDoc
      })
      const results = await Promise.all(checks)
      for (const sessionDoc of results.filter(Boolean) as admin.firestore.QueryDocumentSnapshot[]) {
        const startDate: Date | undefined = sessionDoc.data().start?.toDate()
        if (!startDate) continue
        const isoWeek = format(startDate, ISO_WEEK_FORMAT)
        weeklySessionCounts[isoWeek] = (weeklySessionCounts[isoWeek] ?? 0) + 1
      }
    }
  }

  return calculateStreak(weeklySessionCounts, settings.streak_min_sessions, currentIsoWeek, weeklyTotalSessionCounts)
}
