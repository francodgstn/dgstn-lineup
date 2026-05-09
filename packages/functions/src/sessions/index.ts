import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import { addMonths } from 'date-fns'
import { to } from '../utils/async'
import { calculateOccurrences, validateRecurrence } from '../utils/recurrence'
import { sendEmail } from '../utils/email'
import { getHostingUrl } from '../utils/env'

setGlobalOptions({ region: 'europe-west6' })

const SESSION_SERIES_COLLECTION = 'session_series'
const SESSIONS_COLLECTION = 'sessions'
const TEAMS_COLLECTION = 'teams'
const ACTIVITIES_COLLECTION = 'activities'

// ─── generateRecurringSessions ────────────────────────────────────────────────

export const generateRecurringSessions = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { seriesId, fromDate, toDate } = request.data as {
    seriesId?: string
    fromDate?: string
    toDate?: string
  }
  if (!seriesId) throw new HttpsError('invalid-argument', 'seriesId is required')

  const db = admin.firestore()
  const seriesRef = db.collection(SESSION_SERIES_COLLECTION).doc(seriesId)
  const [seriesErr, seriesDoc] = await to(seriesRef.get())

  if (seriesErr) throw new HttpsError('internal', 'Error fetching series document')
  if (!seriesDoc || !seriesDoc.exists) throw new HttpsError('not-found', `Recurrence series ${seriesId} not found`)

  const seriesData = seriesDoc.data()!
  const teamId = (seriesData.teamId || seriesData.teacher) as string

  if (seriesData.teacher !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You do not have permission to generate sessions for this series')
  }

  const validation = validateRecurrence(seriesData.recurrence)
  if (!validation.valid) {
    throw new HttpsError('invalid-argument', `Invalid recurrence pattern: ${validation.errors.join(', ')}`)
  }

  const now = new Date()
  const generationStart = fromDate ? new Date(fromDate) : now
  const generationEnd = toDate ? new Date(toDate) : addMonths(now, 6)

  const occurrences = calculateOccurrences(seriesData.recurrence, generationStart, generationEnd)
  console.log(`Calculated ${occurrences.length} occurrences for series ${seriesId}`)

  let generatedCount = 0
  const BATCH_SIZE = 500

  for (let i = 0; i < occurrences.length; i += BATCH_SIZE) {
    const batchOccurrences = occurrences.slice(i, i + BATCH_SIZE)
    const batch = db.batch()

    for (const occurrence of batchOccurrences) {
      const [existErr, existSnap] = await to(
        db.collection(SESSIONS_COLLECTION)
          .where('seriesId', '==', seriesId)
          .where('instanceDate', '==', admin.firestore.Timestamp.fromDate(occurrence.start))
          .limit(1)
          .get(),
      )
      if (!existErr && existSnap && !existSnap.empty) continue

      const sessionRef = db.collection(SESSIONS_COLLECTION).doc()
      batch.set(sessionRef, {
        seriesId,
        instanceDate: admin.firestore.Timestamp.fromDate(occurrence.start),
        start: admin.firestore.Timestamp.fromDate(occurrence.start),
        end: admin.firestore.Timestamp.fromDate(occurrence.end),
        activityId: seriesData.template?.activityId ?? null,
        location: seriesData.template?.location ?? null,
        tags: seriesData.template?.tags ?? [],
        notes: seriesData.template?.notes ?? '',
        allowBooking: seriesData.template?.allowBooking ?? false,
        instructorName: seriesData.template?.instructorName ?? null,
        instructorId: seriesData.template?.instructorId ?? null,
        teamId,
        teacher: seriesData.teacher,
        createdBy: seriesData.createdBy || seriesData.teacher,
        participants_count: 0,
        isException: false,
        exceptionType: null,
      })
      generatedCount++
    }

    if (generatedCount > 0) await batch.commit()
  }

  await to(seriesRef.update({
    lastGeneratedUntil: admin.firestore.Timestamp.fromDate(generationEnd),
    totalOccurrences: admin.firestore.FieldValue.increment(generatedCount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }))

  return { success: true, generatedCount, message: `Successfully generated ${generatedCount} sessions` }
})

// ─── cancelSession ────────────────────────────────────────────────────────────

async function getTeamData(db: admin.firestore.Firestore, teamId: string) {
  const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (!teamErr && teamDoc && teamDoc.exists) {
    const team = teamDoc.data()!
    return {
      name: (team.name as string) || 'Our Team',
      language: (team.language as string) || 'en',
      slug: (team.slug as string) || null,
      ctaUrl: (team.settings?.trialBookingCtaUrl as string) || null,
    }
  }
  return { name: 'Our Team', language: 'en', slug: null, ctaUrl: null }
}

function buildCancellationEmail(params: {
  firstname: string
  teamName: string
  activityName: string
  sessionStart: Date
  sessionEnd: Date
  rebookUrl: string | null
}): { subject: string; html: string; text: string } {
  const dateStr = params.sessionStart.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = `${params.sessionStart.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })} – ${params.sessionEnd.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`
  const rebookLine = params.rebookUrl ? `<p><a href="${params.rebookUrl}">Book another session</a></p>` : ''
  const subject = `Session Cancelled – ${params.activityName}`
  const html = `<p>Hi ${params.firstname},</p><p>Your session <strong>${params.activityName}</strong> on ${dateStr} at ${timeStr} has been cancelled by ${params.teamName}.</p>${rebookLine}<p>We apologise for the inconvenience.</p>`
  const text = `Hi ${params.firstname},\n\nYour session ${params.activityName} on ${dateStr} at ${timeStr} has been cancelled by ${params.teamName}.\n${params.rebookUrl ? `Book another session: ${params.rebookUrl}\n` : ''}We apologise for the inconvenience.`
  return { subject, html, text }
}

async function cancelSingleSession(
  db: admin.firestore.Firestore,
  sessionId: string,
  sessionRef: admin.firestore.DocumentReference,
  sessionData: admin.firestore.DocumentData,
  teamData: { name: string; language: string; slug: string | null; ctaUrl: string | null },
  markAsException: boolean,
): Promise<{ sent: number; failed: number }> {
  let sent = 0; let failed = 0

  const [bookingsErr, bookingsSnap] = await to(sessionRef.collection('bookings').get())
  const bookingsToNotify = bookingsErr ? [] : (bookingsSnap?.docs ?? [])

  if (bookingsToNotify.length > 0) {
    let activityName = 'Session'
    if (sessionData.activityId) {
      const [actErr, actDoc] = await to(db.collection(ACTIVITIES_COLLECTION).doc(sessionData.activityId as string).get())
      if (!actErr && actDoc && actDoc.exists) activityName = (actDoc.data()?.name as string) || 'Session'
    }

    const rebookUrl = teamData.slug && sessionData.activityId
      ? `${getHostingUrl()}/portal/${teamData.slug}/booking?activity=${sessionData.activityId}`
      : null

    for (const bookingDoc of bookingsToNotify) {
      const booking = bookingDoc.data()
      if (!booking.email) continue
      try {
        const email = buildCancellationEmail({
          firstname: (booking.firstname as string) || 'Guest',
          teamName: teamData.name,
          activityName,
          sessionStart: (sessionData.start as admin.firestore.Timestamp).toDate(),
          sessionEnd: (sessionData.end as admin.firestore.Timestamp).toDate(),
          rebookUrl,
        })
        await sendEmail({ to: booking.email as string, subject: email.subject, html: email.html, text: email.text })
        if (booking.contact) {
          await to(db.collection('contacts').doc(booking.contact as string).update({
            pending_bookings_count: admin.firestore.FieldValue.increment(-1),
          }))
        }
        sent++
      } catch (err) {
        console.error(`Error sending cancellation to ${booking.email}:`, err)
        failed++
      }
    }
  }

  if (markAsException) {
    await sessionRef.update({
      isException: true,
      exceptionType: 'cancelled',
      cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
    })
  } else {
    // Delete bookings subcollection
    const [allBookErr, allBookSnap] = await to(sessionRef.collection('bookings').get())
    if (!allBookErr && allBookSnap && !allBookSnap.empty) {
      const bk = db.batch()
      allBookSnap.docs.forEach((d) => bk.delete(d.ref))
      await bk.commit()
    }
    // Delete participants subcollection
    const [partErr, partSnap] = await to(sessionRef.collection('participants').get())
    if (!partErr && partSnap && !partSnap.empty) {
      const bk = db.batch()
      partSnap.docs.forEach((d) => bk.delete(d.ref))
      await bk.commit()
    }
    await sessionRef.delete()
  }

  return { sent, failed }
}

export const cancelSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { sessionId, deleteScope } = request.data as { sessionId?: string; deleteScope?: string }
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId is required')

  const db = admin.firestore()
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId)
  const [sessionErr, sessionDoc] = await to(sessionRef.get())

  if (sessionErr) throw new HttpsError('internal', 'Error fetching session')
  if (!sessionDoc || !sessionDoc.exists) throw new HttpsError('not-found', 'Session not found')

  const session = sessionDoc.data()!
  const teamId = (session.teamId || session.teacher) as string

  if (session.teacher !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You do not have permission to cancel this session')
  }

  let sessionsToCancel: Array<{ id: string; ref: admin.firestore.DocumentReference; data: admin.firestore.DocumentData }> = []

  if (deleteScope === 'future' && session.seriesId) {
    const [futureErr, futureSnap] = await to(
      db.collection(SESSIONS_COLLECTION)
        .where('seriesId', '==', session.seriesId)
        .where('start', '>=', session.start)
        .where('isException', '==', false)
        .get(),
    )
    if (futureErr) throw new HttpsError('internal', 'Failed to fetch future sessions')
    sessionsToCancel = (futureSnap?.docs ?? []).map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() }))
  } else {
    sessionsToCancel = [{ id: sessionId, ref: sessionRef, data: session }]
  }

  const teamData = await getTeamData(db, teamId)
  let totalSent = 0; let totalFailed = 0

  for (const s of sessionsToCancel) {
    const { sent, failed } = await cancelSingleSession(
      db, s.id, s.ref, s.data, teamData,
      deleteScope === 'single' && !!session.seriesId,
    )
    totalSent += sent; totalFailed += failed
  }

  return {
    success: true,
    cancelledCount: sessionsToCancel.length,
    notificationsSent: totalSent,
    notificationsFailed: totalFailed,
  }
})
