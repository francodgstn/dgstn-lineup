import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { to } from '../utils/async'
import { CONTACTS_COLLECTION, TEAMS_COLLECTION } from '@lineup/shared'

const BATCH_SIZE = 400

export async function resetMonthlyScores(): Promise<{ skipped?: boolean; reset?: number; teams?: number }> {
  const now = new Date()

  if (now.getDate() !== 1) {
    return { skipped: true }
  }

  const db = admin.firestore()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  console.log(`resetMonthlyScores: running for new month ${currentMonth}`) // eslint-disable-line no-console

  const [err, snap] = await to(
    db.collection(CONTACTS_COLLECTION).where('current_month_score', '>', 0).get(),
  )

  if (err) {
    console.error('resetMonthlyScores: error fetching contacts', err) // eslint-disable-line no-console
    throw err
  }

  if (!snap || snap.empty) {
    console.log('resetMonthlyScores: no contacts with scores to reset') // eslint-disable-line no-console
    return { reset: 0, teams: 0 }
  }

  console.log(`resetMonthlyScores: clearing scores for ${snap.size} contacts`) // eslint-disable-line no-console

  const affectedTeamIds = new Set<string>()
  let batch = db.batch()
  let count = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const teamId = (data.teamId || data.teacher) as string | undefined
    if (teamId) affectedTeamIds.add(teamId)

    batch.update(doc.ref, { current_month_score: FieldValue.delete() })
    count++

    if (count % BATCH_SIZE === 0) {
      await batch.commit()
      batch = db.batch()
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit()
  }

  // Reset each team's leaderboard/current to empty for the new month
  for (const teamId of affectedTeamIds) {
    const [lbErr] = await to(
      db
        .collection(TEAMS_COLLECTION)
        .doc(teamId)
        .collection('leaderboard')
        .doc('current')
        .set({
          month: currentMonth,
          entries: [],
          entries_count: 0,
          updated_at: FieldValue.serverTimestamp(),
        }),
    )
    if (lbErr) {
      console.error(`resetMonthlyScores: failed to reset leaderboard for team ${teamId}`, lbErr) // eslint-disable-line no-console
    }
  }

  console.log(`resetMonthlyScores: done — reset ${count} contacts across ${affectedTeamIds.size} teams`) // eslint-disable-line no-console

  return { reset: count, teams: affectedTeamIds.size }
}
