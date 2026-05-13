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
// Only creates a report if one doesn't exist yet for the week — once created,
// it is never overwritten, so incremental updates from event triggers are preserved.

async function getActiveContacts(
  db: admin.firestore.Firestore,
  teamId: string,
): Promise<admin.firestore.DocumentData[]> {
  const [err, snap] = await to(
    db.collection('contacts')
      .where('teamId', '==', teamId)
      .where('deleted_at', '==', null)
      .where('archived_at', '==', null)
      .get(),
  )
  if (err || !snap) return []
  return snap.docs.map((d) => d.data())
}

function countByField(contacts: admin.firestore.DocumentData[], field: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of contacts) {
    const val = c[field] as string | undefined
    if (!val) continue
    counts[val] = (counts[val] ?? 0) + 1
  }
  return counts
}

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
        const reportRef = db.collection('teams').doc(teamId).collection('weekly_reports').doc(weekLabel)

        // If a report already exists for this week, skip — never overwrite, to preserve
        // any increments applied mid-week by event triggers (trackContacts, trackSessions).
        const [existErr, existSnap] = await to(reportRef.get())
        if (!existErr && existSnap?.exists) continue

        const contacts = await getActiveContacts(db, teamId)
        const active_contacts_count = contacts.length

        const contacts_count_by_type = countByField(contacts, 'type')
        const contacts_count_by_membership_status = countByField(contacts, 'membership_status')
        const contacts_count_by_subscription_type = countByField(contacts, 'subscription_type_id')
        const contacts_count_by_recurrence = countByField(
          contacts.filter((c) => c.subscription_type_id),
          'subscription_recurrence',
        )

        const weekStart = admin.firestore.Timestamp.fromMillis(now.getTime() - 7 * 24 * 3600 * 1000)
        const [, sessionsSnap] = await to(
          db.collection('sessions')
            .where('teamId', '==', teamId)
            .where('start', '>=', weekStart)
            .where('start', '<=', admin.firestore.Timestamp.fromDate(now))
            .get(),
        )
        const sessions_count = sessionsSnap?.size ?? 0

        await reportRef.set({
          iso_week: weekLabel,
          generated_at: admin.firestore.FieldValue.serverTimestamp(),
          active_contacts_count,
          contacts_count_by_type,
          contacts_count_by_membership_status,
          contacts_count_by_subscription_type,
          contacts_count_by_recurrence,
          sessions_count,
          // Start at 0; incremented by trackContacts triggers as events occur during the week
          trial_conversions_count: 0,
          trial_dropouts_count: 0,
        })
      } catch (err) {
        console.error(`weeklyReports: error for team ${teamId}:`, err)
      }
    }
  },
)
