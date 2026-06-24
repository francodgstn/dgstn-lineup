import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { CONTACTS_COLLECTION, TEAMS_COLLECTION } from '@linyup/shared'

const BATCH_SIZE = 500

export async function autoArchiveTrialContacts(): Promise<{ processed: number; archived: number; errors: number }> {
  const db = admin.firestore()
  const now = Timestamp.now()
  const results = { processed: 0, archived: 0, errors: 0 }

  const teamsSnap = await db.collection(TEAMS_COLLECTION).get()
  const activeTeams = teamsSnap.docs.filter((d) => (d.data().settings?.trial_auto_archive_days ?? 0) > 0)

  if (activeTeams.length === 0) {
    console.log('autoArchiveTrialContacts: no teams with auto-archive configured') // eslint-disable-line no-console
    return results
  }

  for (const teamDoc of activeTeams) {
    const days = teamDoc.data().settings.trial_auto_archive_days as number
    const teamId = teamDoc.id
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffTs = Timestamp.fromDate(cutoff)

    console.log(`autoArchiveTrialContacts: processing team ${teamId}, threshold ${days} days`) // eslint-disable-line no-console

    try {
      // Auto-archive targets the trial funnel (not-yet-joined). Attendance promotes
      // the stage, so a contact with a session is 'trial_attended' and one without is
      // 'trial_booked' — joined members are excluded by the stage filter.
      // Query A: attended trials inactive past the threshold (trial_attended)
      // Query B: booked trials that never attended, created before threshold (trial_booked)
      const [withActivity, withoutActivity] = await Promise.all([
        db
          .collection(CONTACTS_COLLECTION)
          .where('teamId', '==', teamId)
          .where('acquisition_stage', '==', 'trial_attended')
          .where('archived_at', '==', null)
          .where('last_session_at', '<', cutoffTs)
          .get(),
        db
          .collection(CONTACTS_COLLECTION)
          .where('teamId', '==', teamId)
          .where('acquisition_stage', '==', 'trial_booked')
          .where('archived_at', '==', null)
          .where('last_session_at', '==', null)
          .where('created_at', '<', cutoffTs)
          .get(),
      ])

      const allDocs = [...withActivity.docs, ...withoutActivity.docs]
      results.processed += allDocs.length

      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        const batch = db.batch()
        const chunk = allDocs.slice(i, i + BATCH_SIZE)
        chunk.forEach((doc) => {
          batch.update(doc.ref, { archived_at: now, archived_reason: 'auto_inactivity' })
        })
        await batch.commit()
        results.archived += chunk.length
      }

      console.log(`autoArchiveTrialContacts: archived ${allDocs.length} contacts for team ${teamId}`) // eslint-disable-line no-console
    } catch (err) {
      console.error(`autoArchiveTrialContacts: error for team ${teamId}`, (err as Error).message || err) // eslint-disable-line no-console
      results.errors++
    }
  }

  return results
}
