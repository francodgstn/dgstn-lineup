import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { addMonths, getDay } from 'date-fns'
import { to } from '../utils/async'
import { calculateOccurrences, validateRecurrence } from '../utils/recurrence'
import { sendEmail } from '../utils/email'
import { getHostingUrl } from '../utils/env'


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
          .where('instanceDate', '==', Timestamp.fromDate(occurrence.start))
          .limit(1)
          .get(),
      )
      if (!existErr && existSnap && !existSnap.empty) continue

      const sessionRef = db.collection(SESSIONS_COLLECTION).doc()
      batch.set(sessionRef, {
        seriesId,
        instanceDate: Timestamp.fromDate(occurrence.start),
        start: Timestamp.fromDate(occurrence.start),
        end: Timestamp.fromDate(occurrence.end),
        activityId: seriesData.template?.activityId ?? null,
        activityName: seriesData.template?.activityName ?? null,
        activityType: seriesData.template?.activityType ?? null,
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
    lastGeneratedUntil: Timestamp.fromDate(generationEnd),
    totalOccurrences: FieldValue.increment(generatedCount),
    updatedAt: FieldValue.serverTimestamp(),
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
          sessionStart: (sessionData.start as Timestamp).toDate(),
          sessionEnd: (sessionData.end as Timestamp).toDate(),
          rebookUrl,
        })
        await sendEmail({ to: booking.email as string, subject: email.subject, html: email.html, text: email.text })
        if (booking.contact) {
          await to(db.collection('contacts').doc(booking.contact as string).update({
            pending_bookings_count: FieldValue.increment(-1),
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
      cancelled_at: FieldValue.serverTimestamp(),
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

// ─── updateRecurringSession ───────────────────────────────────────────────────

function toTimestamp(val: unknown): Timestamp {
  if (!val) return val as Timestamp
  if (val instanceof Timestamp) return val
  const v = val as Record<string, number>
  if (v._seconds !== undefined) return new Timestamp(v._seconds, v._nanoseconds ?? 0)
  if (v.seconds !== undefined) return new Timestamp(v.seconds, v.nanoseconds ?? 0)
  if (val instanceof Date) return Timestamp.fromDate(val)
  const parsed = new Date(val as string | number)
  return isNaN(parsed.getTime()) ? val as Timestamp : Timestamp.fromDate(parsed)
}

export const updateRecurringSession = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const { sessionId, updates, editScope } = request.data as {
    sessionId?: string
    updates?: Record<string, unknown>
    editScope?: 'single' | 'future'
  }
  if (!sessionId || !updates || !editScope) {
    throw new HttpsError('invalid-argument', 'sessionId, updates, and editScope are required')
  }

  const db = admin.firestore()
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId)
  const [sessionErr, sessionDoc] = await to(sessionRef.get())
  if (sessionErr || !sessionDoc || !sessionDoc.exists) throw new HttpsError('not-found', 'Session not found')

  const session = sessionDoc.data()!
  const teamId = (session.teamId || session.teacher) as string

  if (session.teacher !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You do not have permission to update this session')
  }
  if (!session.seriesId) throw new HttpsError('invalid-argument', 'This is not a recurring session')

  // Whitelist allowed update fields — prevents overwriting privileged fields
  // like teacher, teamId, seriesId, isException, createdBy, etc.
  const ALLOWED_UPDATE_FIELDS = new Set([
    'title', 'description', 'start', 'end', 'duration',
    'location', 'tags', 'maxParticipants', 'type', 'notes', 'recurrence',
    'activityId', 'activityName', 'activityType', 'instructorName', 'instructorId', 'allowBooking',
  ])
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k]) => ALLOWED_UPDATE_FIELDS.has(k))
  )
  if (Object.keys(safeUpdates).length === 0) {
    throw new HttpsError('invalid-argument', 'No valid fields to update')
  }

  if (editScope === 'single') {
    const { location: _loc, tags: _tags, ...regularUpdates } = safeUpdates
    const normalized: Record<string, unknown> = { ...regularUpdates }
    if (regularUpdates.start !== undefined) normalized.start = toTimestamp(regularUpdates.start)
    if (regularUpdates.end !== undefined) normalized.end = toTimestamp(regularUpdates.end)
    // Inline location/tags update (no separate function)
    if (_loc !== undefined) normalized.location = _loc
    if (_tags !== undefined) normalized.tags = _tags

    await sessionRef.update({ ...normalized, isException: true, exceptionType: 'modified', updatedAt: FieldValue.serverTimestamp() })
    return { success: true, message: 'Session updated as exception.', updatedCount: 1 }
  }

  // editScope === 'future'
  const seriesRef = db.collection(SESSION_SERIES_COLLECTION).doc(session.seriesId as string)
  const [seriesErr, seriesDoc] = await to(seriesRef.get())
  if (seriesErr || !seriesDoc || !seriesDoc.exists) throw new HttpsError('not-found', 'Recurrence series not found')

  const [futureErr, futureSnap] = await to(
    db.collection(SESSIONS_COLLECTION)
      .where('seriesId', '==', session.seriesId)
      .where('start', '>=', session.start)
      .where('isException', '==', false)
      .get(),
  )
  if (futureErr) throw new HttpsError('internal', 'Failed to fetch future sessions')

  const { location, tags, start, end, duration, recurrence: recurrenceUpdates, ...regularUpdates } = safeUpdates

  let newTimeHours: number | null = null
  let newTimeMinutes: number | null = null
  let newDuration: number | null = null

  if (start !== undefined) {
    const ts = toTimestamp(start).toDate()
    newTimeHours = ts.getUTCHours()
    newTimeMinutes = ts.getUTCMinutes()
  }
  if (start !== undefined && end !== undefined) {
    newDuration = Math.round((toTimestamp(end).toDate().getTime() - toTimestamp(start).toDate().getTime()) / 60000)
  } else if (duration !== undefined) {
    newDuration = duration as number
  }

  const batch = db.batch()
  for (const doc of (futureSnap?.docs ?? [])) {
    const perDoc: Record<string, unknown> = { ...regularUpdates, updatedAt: FieldValue.serverTimestamp() }
    if (location !== undefined) perDoc.location = location
    if (tags !== undefined) perDoc.tags = tags

    if (newTimeHours !== null && newTimeMinutes !== null) {
      const orig = (doc.data().start as Timestamp).toDate()
      const newStart = new Date(Date.UTC(orig.getUTCFullYear(), orig.getUTCMonth(), orig.getUTCDate(), newTimeHours, newTimeMinutes, 0, 0))
      perDoc.start = Timestamp.fromDate(newStart)
      perDoc.instanceDate = perDoc.start
      if (newDuration) perDoc.end = Timestamp.fromDate(new Date(newStart.getTime() + newDuration * 60000))
    } else if (newDuration) {
      const orig = (doc.data().start as Timestamp).toDate()
      perDoc.end = Timestamp.fromDate(new Date(orig.getTime() + newDuration * 60000))
      perDoc.duration = newDuration
    }

    batch.update(doc.ref, perDoc)
  }

  const generationEnd = addMonths(new Date(), 6)
  const seriesUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    lastGeneratedUntil: Timestamp.fromDate(generationEnd),
  }
  if (updates.activityId !== undefined) seriesUpdates['template.activityId'] = updates.activityId
  if (updates.activityName !== undefined) seriesUpdates['template.activityName'] = updates.activityName
  if (updates.activityType !== undefined) seriesUpdates['template.activityType'] = updates.activityType
  if (location !== undefined) seriesUpdates['template.location'] = location
  if (tags !== undefined) seriesUpdates['template.tags'] = tags
  if (updates.notes !== undefined) seriesUpdates['template.notes'] = updates.notes
  if (updates.allowBooking !== undefined) seriesUpdates['template.allowBooking'] = updates.allowBooking
  if (updates.instructorName !== undefined) seriesUpdates['template.instructorName'] = updates.instructorName
  if (updates.instructorId !== undefined) seriesUpdates['template.instructorId'] = updates.instructorId

  if (start !== undefined && newTimeHours !== null && newTimeMinutes !== null) {
    const seriesData = seriesDoc.data()!
    const currentStart = (seriesData.recurrence.startDate as Timestamp).toDate()
    seriesUpdates['recurrence.startDate'] = Timestamp.fromDate(
      new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth(), currentStart.getUTCDate(), newTimeHours, newTimeMinutes, 0, 0)),
    )
  }
  if (newDuration) {
    seriesUpdates['recurrence.duration'] = newDuration
    seriesUpdates['template.duration'] = newDuration
  }

  let recurrenceChanged = false
  let newRecurrence: Record<string, unknown> | null = null

  if (recurrenceUpdates && typeof recurrenceUpdates === 'object') {
    const ru = recurrenceUpdates as Record<string, unknown>
    const seriesData = seriesDoc.data()!
    newRecurrence = { ...seriesData.recurrence as Record<string, unknown>, ...(seriesUpdates['recurrence.startDate'] ? { startDate: seriesUpdates['recurrence.startDate'] } : {}) }

    for (const key of ['frequency', 'interval', 'daysOfWeek', 'endCondition', 'maxOccurrences'] as const) {
      if (ru[key] !== undefined) { seriesUpdates[`recurrence.${key}`] = ru[key]; (newRecurrence as Record<string, unknown>)[key] = ru[key]; recurrenceChanged = true }
    }
    if (ru.endDate !== undefined) {
      const endDateVal = ru.endDate ? toTimestamp(ru.endDate) : null
      seriesUpdates['recurrence.endDate'] = endDateVal
      newRecurrence.endDate = endDateVal
      recurrenceChanged = true
    }
  }

  batch.update(seriesRef, seriesUpdates)
  await batch.commit()

  let deletedCount = 0
  let generatedCount = 0

  if (recurrenceChanged && newRecurrence) {
    const sessionStart = session.start as Timestamp
    const [allFutureErr, allFutureSnap] = await to(
      db.collection(SESSIONS_COLLECTION)
        .where('seriesId', '==', session.seriesId)
        .where('start', '>=', sessionStart)
        .where('isException', '==', false)
        .get(),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newOccurrences = calculateOccurrences(newRecurrence as any, sessionStart.toDate(), generationEnd)
    const sessionsToDelete: admin.firestore.DocumentReference[] = []
    const existingDates = new Set<string>()

    for (const doc of (allFutureSnap?.docs ?? [])) {
      const docStart = (doc.data().start as Timestamp).toDate()
      const dateKey = docStart.toISOString().slice(0, 10)
      if (newRecurrence.frequency === 'weekly' && Array.isArray(newRecurrence.daysOfWeek)) {
        if (!(newRecurrence.daysOfWeek as number[]).includes(getDay(docStart))) {
          sessionsToDelete.push(doc.ref)
        } else {
          existingDates.add(dateKey)
        }
      } else {
        existingDates.add(dateKey)
      }
    }

    if (sessionsToDelete.length > 0) {
      const delBatch = db.batch()
      sessionsToDelete.forEach((ref) => delBatch.delete(ref))
      await delBatch.commit()
      deletedCount = sessionsToDelete.length
    }

    const toCreate = newOccurrences.filter((o) => !existingDates.has(o.start.toISOString().slice(0, 10)))
    if (toCreate.length > 0) {
      const seriesData = seriesDoc.data()!
      const tpl = {
        activityId: (seriesUpdates['template.activityId'] ?? seriesData.template?.activityId) as string | null ?? null,
        activityName: (seriesUpdates['template.activityName'] ?? seriesData.template?.activityName) as string | null ?? null,
        activityType: (seriesUpdates['template.activityType'] ?? seriesData.template?.activityType) as string | null ?? null,
        location: (seriesUpdates['template.location'] ?? seriesData.template?.location) as string | null ?? null,
        tags: (seriesUpdates['template.tags'] ?? seriesData.template?.tags) as string[] ?? [],
        notes: (seriesUpdates['template.notes'] ?? seriesData.template?.notes) as string ?? '',
        allowBooking: (seriesUpdates['template.allowBooking'] ?? seriesData.template?.allowBooking) as boolean ?? false,
        instructorName: (seriesUpdates['template.instructorName'] ?? seriesData.template?.instructorName) as string | null ?? null,
        instructorId: (seriesUpdates['template.instructorId'] ?? seriesData.template?.instructorId) as string | null ?? null,
      }
      const createBatch = db.batch()
      for (const occ of toCreate) {
        const ref = db.collection(SESSIONS_COLLECTION).doc()
        createBatch.set(ref, {
          seriesId: session.seriesId,
          instanceDate: Timestamp.fromDate(occ.start),
          start: Timestamp.fromDate(occ.start),
          end: Timestamp.fromDate(occ.end),
          ...tpl,
          teamId,
          teacher: seriesData.teacher,
          createdBy: seriesData.createdBy || seriesData.teacher,
          participants_count: 0,
          isException: false,
          exceptionType: null,
        })
      }
      await createBatch.commit()
      generatedCount = toCreate.length
    }
  }

  return {
    success: true,
    updatedCount: futureSnap?.size ?? 0,
    deletedCount,
    generatedCount,
  }
})

// ─── selfCheckIn ──────────────────────────────────────────────────────────────

export const selfCheckIn = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const contactId = (request.auth.token as Record<string, string>)?.contactId
  if (!contactId) throw new HttpsError('permission-denied', 'Invalid membership session. Please log in again.')

  const { teamSlug, sessionId: requestedSessionId } = request.data as { teamSlug?: string; sessionId?: string }
  if (!teamSlug) throw new HttpsError('invalid-argument', 'teamSlug is required')

  const db = admin.firestore()
  const DEFAULT_WINDOW_MINUTES = 15

  // Resolve slug → teamId via public_profile collectionGroup
  const slugSnap = await db.collectionGroup('public_profile').where('slug', '==', teamSlug).limit(5).get()
  const teamDoc = slugSnap.docs.find((d) => { const segs = d.ref.path.split('/'); return segs[0] === 'teams' && segs.length === 4 })
  if (!teamDoc) throw new HttpsError('not-found', 'Team not found for this QR code')

  const teamId = teamDoc.ref.parent.parent!.id
  const [teamErr, teamSnap] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamErr || !teamSnap || !teamSnap.exists) throw new HttpsError('not-found', 'Team not found')

  const windowMinutes: number = (teamSnap.data()?.settings?.selfCheckInWindowMinutes as number) ?? DEFAULT_WINDOW_MINUTES
  const windowMs = windowMinutes * 60 * 1000

  const [contactErr, contactSnap] = await to(db.collection('contacts').doc(contactId).get())
  if (contactErr || !contactSnap || !contactSnap.exists) throw new HttpsError('not-found', 'Contact not found')
  const contact = contactSnap.data()!
  if ((contact.teamId || contact.teacher) !== teamId) throw new HttpsError('permission-denied', 'You are not a member of this team')

  const now = Timestamp.now()

  let sessionsToProcess: Array<Record<string, unknown> & { id: string }> = []

  if (requestedSessionId) {
    const [sErr, sSnap] = await to(db.collection('sessions').doc(requestedSessionId).get())
    if (sErr || !sSnap || !sSnap.exists) throw new HttpsError('not-found', 'Session not found')
    const s = sSnap.data()!
    if ((s.teamId || s.teacher) !== teamId) throw new HttpsError('permission-denied', 'Session does not belong to this team')
    sessionsToProcess = [{ id: requestedSessionId, ...s }]
  } else {
    const LOOKBACK_MS = 4 * 60 * 60 * 1000
    const queryStart = Timestamp.fromMillis(now.toMillis() - LOOKBACK_MS)
    const queryEnd = Timestamp.fromMillis(now.toMillis() + windowMs)
    const [sessErr, sessSnap] = await to(
      db.collection('sessions').where('teamId', '==', teamId).where('start', '>=', queryStart).where('start', '<=', queryEnd).orderBy('start', 'asc').get(),
    )
    sessionsToProcess = (sessSnap?.docs ?? [])
      .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }))
      .filter((s) => {
        const end = (s.end as Timestamp | undefined) || Timestamp.fromMillis((s.start as Timestamp).toMillis() + ((s.duration as number | undefined) || 60) * 60 * 1000)
        const checkInOpens = Timestamp.fromMillis((s.start as Timestamp).toMillis() - windowMs)
        return now >= checkInOpens && end.toMillis() > now.toMillis()
      })
  }

  if (sessionsToProcess.length === 0) return { status: 'no_sessions' }

  // Resolve activity names
  const uniqueActivityIds = [...new Set(sessionsToProcess.map((s) => s.activityId as string | undefined).filter(Boolean) as string[])]
  const activityNameMap: Record<string, string> = {}
  await Promise.all(uniqueActivityIds.map(async (aid) => {
    const snap = await db.collection(ACTIVITIES_COLLECTION).doc(aid).get()
    if (snap.exists) activityNameMap[aid] = (snap.data()?.name as string) || aid
  }))
  const resolveActivityName = (s: Record<string, unknown>) => activityNameMap[s.activityId as string] || (s.activityId as string) || 'Session'

  if (sessionsToProcess.length > 1 && !requestedSessionId) {
    return {
      status: 'session_required',
      sessions: sessionsToProcess.map((s) => ({
        id: s.id,
        activityName: resolveActivityName(s),
        start: s.start,
        end: (s.end as Timestamp) || Timestamp.fromMillis((s.start as Timestamp).toMillis() + ((s.duration as number) || 60) * 60 * 1000),
      })),
    }
  }

  const session = sessionsToProcess[0]
  const resolvedSessionId = session.id
  const sessionStart = session.start as Timestamp
  const sessionEnd = (session.end as Timestamp) || Timestamp.fromMillis(sessionStart.toMillis() + ((session.duration as number) || 60) * 60 * 1000)
  const checkInWindowStart = Timestamp.fromMillis(sessionStart.toMillis() - windowMs)

  if (now < checkInWindowStart || now > sessionEnd) throw new HttpsError('failed-precondition', 'Check-in window is not open for this session')

  const sessionRef = db.collection('sessions').doc(resolvedSessionId)
  const participantRef = sessionRef.collection('participants').doc(contactId)
  const [pErr, participantDoc] = await to(participantRef.get())
  if (!pErr && participantDoc && participantDoc.exists) {
    return { status: 'checked_in', alreadyCheckedIn: true, sessionName: resolveActivityName(session), sessionStart: sessionStart.toMillis() }
  }

  const participantData = {
    contact: contactId,
    session: resolvedSessionId,
    fullname: `${(contact.lastname as string) || ''} ${(contact.firstname as string) || ''}`.trim(),
    firstname: (contact.firstname as string) || '',
    lastname: (contact.lastname as string) || '',
    avatar_url: (contact.avatar_url as string) || null,
    checkedInAt: FieldValue.serverTimestamp(),
    checkedInBy: 'self-scan',
  }

  const bookingRef = sessionRef.collection('bookings').doc(contactId)
  const [bErr, bookingDoc] = await to(bookingRef.get())

  const batch = db.batch()
  batch.set(participantRef, participantData)

  if (!bErr && bookingDoc && bookingDoc.exists) {
    const bStatus = bookingDoc.data()?.status as string | undefined
    if (!bStatus || bStatus === 'pending') {
      batch.update(bookingRef, { status: 'confirmed', confirmed_at: FieldValue.serverTimestamp() })
      batch.update(sessionRef, { portal_bookings_count: FieldValue.increment(-1), conversions_count: FieldValue.increment(1) })
      batch.update(db.collection('contacts').doc(contactId), { pending_bookings_count: FieldValue.increment(-1) })
    }
  }

  await batch.commit()
  return { status: 'checked_in', alreadyCheckedIn: false, sessionName: resolveActivityName(session), sessionStart: sessionStart.toMillis() }
})
