import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import { format } from 'date-fns'
import { to } from '../utils/async'

setGlobalOptions({ region: 'europe-west6' })

const DATE_FORMAT = 'PPP'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function logActivity(teamId: string, entry: Record<string, unknown>): Promise<void> {
  const db = admin.firestore()
  const [err] = await to(
    db.collection('teams').doc(teamId).collection('activity_log').add({
      ...entry,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    }),
  )
  if (err) console.error('logActivity error:', err)
}

// ─── trackBookings ────────────────────────────────────────────────────────────

const STATUS_EVENT: Record<string, string> = {
  pending: 'booking_created',
  confirmed: 'booking_confirmed',
  cancelled: 'booking_cancelled',
  rebooked: 'booking_rebooked',
}

export const trackBookings = onDocumentWritten(
  'sessions/{sessionId}/bookings/{bookingId}',
  async (event) => {
    const { sessionId } = event.params
    const newData = event.data?.after.exists ? event.data.after.data() : null
    const oldData = event.data?.before.exists ? event.data.before.data() : null

    let activityEvent: string
    let bookingData: Record<string, unknown>

    if (!oldData && newData) {
      activityEvent = 'booking_created'; bookingData = newData
    } else if (oldData && !newData) {
      activityEvent = 'booking_cancelled'; bookingData = oldData
    } else if (oldData && newData) {
      const newStatus = newData.status as string | undefined
      const oldStatus = oldData.status as string | undefined
      if (newStatus === oldStatus) return
      activityEvent = STATUS_EVENT[newStatus ?? '']
      if (!activityEvent) return
      bookingData = newData
    } else {
      return
    }

    const db = admin.firestore()
    const [sessionErr, sessionDoc] = await to(db.collection('sessions').doc(sessionId).get())
    if (sessionErr || !sessionDoc || !sessionDoc.exists) return

    const session = sessionDoc.data()!
    const teamId = (session.teamId || session.teacher) as string | undefined
    if (!teamId) return

    const contactFullname = `${(bookingData.firstname as string) || ''} ${(bookingData.lastname as string) || ''}`.trim() || event.params.bookingId
    const sessionStart = session.start as admin.firestore.Timestamp | undefined
    const sessionDateLabel = sessionStart ? format(sessionStart.toDate(), DATE_FORMAT) : 'unknown date'

    const descMap: Record<string, string> = {
      booking_created: `${contactFullname} booked a session on ${sessionDateLabel}.`,
      booking_confirmed: `${contactFullname} confirmed for session on ${sessionDateLabel}.`,
      booking_cancelled: `Booking for ${contactFullname} on ${sessionDateLabel} was cancelled.`,
      booking_rebooked: `${contactFullname} rebooked from session on ${sessionDateLabel}.`,
    }

    await logActivity(teamId, {
      event: activityEvent,
      parameters: {
        description: descMap[activityEvent] ?? activityEvent,
        contact_firstname: bookingData.firstname,
        contact_lastname: bookingData.lastname,
        session_date: sessionStart ?? null,
        session_id: sessionId,
        from_portal: bookingData.fromPortal === true,
        authenticated_booking: bookingData.authenticated_booking === true,
      },
      refs: { contact: bookingData.contact || event.params.bookingId, session: sessionId },
    })
  },
)

// ─── trackSessions ────────────────────────────────────────────────────────────

export const trackSessions = onDocumentWritten('sessions/{sessionId}', async (event) => {
  const newData = event.data?.after.exists ? event.data.after.data() : null
  const oldData = event.data?.before.exists ? event.data.before.data() : null

  const teamId = ((newData?.teamId || newData?.teacher || oldData?.teamId || oldData?.teacher) as string | undefined)
  if (!teamId) return

  const increment = newData && !oldData ? 1 : !newData && oldData ? -1 : 0
  if (increment === 0) return

  const db = admin.firestore()
  const sessionDate = (newData?.start || oldData?.start) as admin.firestore.Timestamp | undefined
  const month = sessionDate ? format(sessionDate.toDate(), 'yyyy-MM') : null
  if (!month) return

  // Upsert a monthly session counter for the team
  const counterRef = db.collection('teams').doc(teamId).collection('session_counts').doc(month)
  await to(counterRef.set(
    { month, sessions_count: admin.firestore.FieldValue.increment(increment), updated_at: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  ))
})

// ─── weeklyReports ────────────────────────────────────────────────────────────
// Runs every Monday at 00:05 UTC. Generates per-team weekly summary snapshots.

export const weeklyReports = onSchedule(
  { schedule: 'every monday 00:05', timeZone: 'UTC', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = admin.firestore()
    const now = new Date()
    const weekLabel = format(now, `R-'W'II`)

    const [teamsErr, teamsSnap] = await to(db.collection('teams').where('archived_at', '==', null).get())
    if (teamsErr || !teamsSnap || teamsSnap.empty) return

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id
      try {
        // Count active contacts
        const [, contactsSnap] = await to(
          db.collection('contacts')
            .where('teamId', '==', teamId)
            .where('deleted_at', '==', null)
            .where('archived_at', '==', null)
            .get(),
        )
        const activeContacts = contactsSnap?.size ?? 0

        // Count sessions in the past 7 days
        const weekStart = admin.firestore.Timestamp.fromMillis(now.getTime() - 7 * 24 * 3600 * 1000)
        const [, sessionsSnap] = await to(
          db.collection('sessions')
            .where('teamId', '==', teamId)
            .where('start', '>=', weekStart)
            .where('start', '<=', admin.firestore.Timestamp.fromDate(now))
            .get(),
        )
        const weekSessions = sessionsSnap?.size ?? 0

        await db.collection('teams').doc(teamId).collection('weekly_reports').doc(weekLabel).set({
          week: weekLabel,
          generated_at: admin.firestore.FieldValue.serverTimestamp(),
          active_contacts: activeContacts,
          sessions_count: weekSessions,
        })
      } catch (err) {
        console.error(`weeklyReports: error for team ${teamId}:`, err)
      }
    }
  },
)
