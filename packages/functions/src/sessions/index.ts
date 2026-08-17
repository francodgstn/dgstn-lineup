import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { addMonths, getDay } from 'date-fns'
import { to } from '../utils/async'
import { calculateOccurrences, validateRecurrence } from '../utils/recurrence'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { systemEmailEnabledFor } from '../utils/systemEmails'
import { getHostingUrl } from '../utils/env'
import { closeSessionWaitlist } from '../booking/waitlist/teardown'
import {
  DISPOSED_BOOKING_STATUSES,
  replacedBookingWasCounted,
  type ReplacedBookingShape,
} from '../booking'
import { enforceWaiverGate } from '../waivers/gate'
import {
  bookingWasPaidFor,
  confirmClearedHoldFields,
  publicUrl,
  type SeatHold,
} from '@linyup/shared'
import {
  SESSION_SERIES_COLLECTION,
  SESSIONS_COLLECTION,
  SERIES_HORIZON_MONTHS,
  materializeOccurrences,
  seriesHorizonUpdate,
} from './series'

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
  if (!seriesDoc || !seriesDoc.exists)
    throw new HttpsError('not-found', `Recurrence series ${seriesId} not found`)

  const seriesData = seriesDoc.data()!

  if (seriesData.teacher !== request.auth.uid) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to generate sessions for this series'
    )
  }

  const validation = validateRecurrence(seriesData.recurrence)
  if (!validation.valid) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid recurrence pattern: ${validation.errors.join(', ')}`
    )
  }

  const now = new Date()
  const generationStart = fromDate ? new Date(fromDate) : now
  const generationEnd = toDate ? new Date(toDate) : addMonths(now, SERIES_HORIZON_MONTHS)

  const occurrences = calculateOccurrences(seriesData.recurrence, generationStart, generationEnd)
  console.log(`Calculated ${occurrences.length} occurrences for series ${seriesId}`)

  // Shape + dedupe both live in ./series — the same code the daily roller runs,
  // so creating a series and extending it can never drift apart again.
  const generatedCount = await materializeOccurrences(db, seriesId, seriesData, occurrences)

  await to(seriesRef.update(seriesHorizonUpdate(generationEnd, generatedCount)))

  return {
    success: true,
    generatedCount,
    message: `Successfully generated ${generatedCount} sessions`,
  }
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
  const dateStr = params.sessionStart.toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeStr = `${params.sessionStart.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })} – ${params.sessionEnd.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`
  const rebookLine = params.rebookUrl
    ? `<p style="text-align:center;margin-top:24px;">${ctaButton(params.rebookUrl, 'Book another session')}</p>`
    : ''
  const subject = `Session Cancelled – ${params.activityName}`
  const { html } = buildEmailTemplate({
    title: 'Session cancelled',
    body: `<p>Hi ${params.firstname},</p><p>Your session <strong>${params.activityName}</strong> on ${dateStr} at ${timeStr} has been cancelled by ${params.teamName}.</p><p>We apologise for the inconvenience.</p>${rebookLine}`,
  })
  const text = `Hi ${params.firstname},\n\nYour session ${params.activityName} on ${dateStr} at ${timeStr} has been cancelled by ${params.teamName}.\n${params.rebookUrl ? `Book another session: ${params.rebookUrl}\n` : ''}We apologise for the inconvenience.`
  return { subject, html, text }
}

async function cancelSingleSession(
  db: admin.firestore.Firestore,
  sessionId: string,
  sessionRef: admin.firestore.DocumentReference,
  sessionData: admin.firestore.DocumentData,
  teamData: { name: string; language: string; slug: string | null; ctaUrl: string | null },
  markAsException: boolean
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  // THE SESSION IS MARKED CALLED-OFF FIRST, before anything touches the queue.
  // Closing the queue releases claim holds, and every release writes
  // `bookings_count` — which is precisely the `seatFreedEdge` that
  // `promoteWaitlistOnSeatFreed` watches. With the marker not yet written the
  // promoter re-reads a session that still looks bookable and cheerfully mails
  // "A place has opened up" for a class being called off as it does so; a join
  // landing mid-teardown survives it for the same reason. `joinWaitlist` and the
  // promoter both refuse on `isSessionCancelled` / `allowBooking`, so the marker
  // is all the ordering constraint they need.
  if (markAsException) {
    // The exception pair IS the cancellation record for an occurrence of a
    // series (status and allowBooking are deliberately left alone — see
    // isSessionCancelled). Unguarded on purpose: if this write fails the class
    // is NOT cancelled, and mailing everyone that it was would be the worse
    // outcome.
    await sessionRef.update({
      isException: true,
      exceptionType: 'cancelled',
      cancelled_at: FieldValue.serverTimestamp(),
    })
  } else {
    // The delete branch has no marker to write — the document is going away at
    // the end of this function — so it borrows the one every waitlist path
    // already tests. Best-effort: the session is about to be deleted, and a
    // cancellation must complete even if this does not.
    const [markErr] = await to(sessionRef.update({ allowBooking: false }))
    if (markErr) {
      console.error(`cancelSingleSession: could not close bookings on ${sessionId}:`, markErr) // eslint-disable-line no-console
    }
  }

  // BEFORE the bookings are read, because closing the queue deletes the claim
  // holds it owns: a hold is an ordinary `pending` booking, so a teardown that
  // ran afterwards would decrement `pending_bookings_count` twice for the same
  // person (once here, once inside the release). That constraint is about the
  // BOOKINGS READ below, not about the marker above — the two orderings are
  // independent and both hold. The people whose offer was withdrawn come back as
  // `offerHolders` and are mailed alongside the real bookings below — they are
  // the ones who believed they had a seat.
  const offerHolders = await closeSessionWaitlist(sessionRef)

  const [bookingsErr, bookingsSnap] = await to(sessionRef.collection('bookings').get())
  const bookings = bookingsErr ? [] : (bookingsSnap?.docs ?? [])

  // ── THE COUNTER IS A FACT ABOUT THE BOOKING; THE MAIL IS A MESSAGE ABOUT IT ──
  // `pending_bookings_count` used to be decremented INSIDE the notification loop
  // below, so a studio that switched `session_cancellation` off cancelled classes
  // without anybody's counter moving — and the contacts list went on saying those
  // people needed chasing for a session that no longer exists. (UX-76 then made
  // paid bookings notify regardless, which left free and paid decrementing
  // differently: an improvement and an inconsistency.) It is settled here, once
  // per booking, before a single mail is built: no toggle, no delivery outcome
  // and no missing email address can reach it.
  //
  // WHICH documents own a count — decided by the ledger's existing seams, never a
  // fresh expression of the question (booking/index.ts, shape table in
  // docs/waitlist.md, fixtures in booking/pendingBookingsCount.test.ts):
  //  • a DISPOSED booking (cancelled / no_show / rebooked) owns none — whoever
  //    disposed of it already gave the count back, and these documents are still
  //    sitting in the subcollection this read just returned.
  //  • a PLAIN drop-in payment hold (`payment_status: 'required'` without
  //    `waitlist_claim`) is uncounted for its whole life — `replacedBookingWasCounted`
  //    is the one predicate that knows that, and decrementing it here drove a real
  //    person's counter negative, which is the failure somebody notices.
  // A CLAIM hold that was still unclaimed never reaches this read at all:
  // `closeSessionWaitlist` above deleted it and gave its count back, which is
  // exactly why that call has to come first.
  //
  // `increment(-1)`, deliberately, and against the standing preference for an
  // absolute value: this counter is per CONTACT and spans every session they hold
  // a seat in, so this function's read set (one session's bookings) cannot
  // produce the true total, and nothing recounts it. Every writer of the field
  // moves it the same way — see the ledger note in booking/index.ts, which owns
  // that rule (`bookings_count`, which IS recountable, is the one that must be
  // written absolute, and this function does not touch it). Best-effort per
  // contact rather than batched: a purged provisional contact makes `update`
  // throw, and one missing document must not stop the rest of the roster moving.
  for (const bookingDoc of bookings) {
    const booking = bookingDoc.data()
    if (!booking.contact) continue
    if (booking.status && DISPOSED_BOOKING_STATUSES.has(booking.status as string)) continue
    if (!replacedBookingWasCounted(booking as ReplacedBookingShape)) continue
    const [countErr] = await to(
      db
        .collection('contacts')
        .doc(booking.contact as string)
        .update({ pending_bookings_count: FieldValue.increment(-1) })
    )
    if (countErr) {
      console.error( // eslint-disable-line no-console
        `cancelSingleSession: pending_bookings_count decrement failed for contact ${booking.contact}:`,
        countErr
      )
    }
  }

  let bookingsToNotify = bookings

  // Member cancellation notices are per-team toggleable (Automations → System
  // emails) — EXCEPT for someone who paid.
  //
  // Same test as the paid booking's receipt (booking/paidConfirmation.ts) and as
  // the waitlist offer (booking/waitlist/notify.ts): does switching it off
  // quieten the feature, or break it? For a FREE booking it quietens a courtesy
  // — the person loses nothing but news. For a PAID one it breaks it: they have
  // been charged for a class the studio has just called off, and silence means
  // they travel to a locked door and only then start asking for their money
  // back. So a paid seat is notified whatever the toggle says, and the toggle
  // keeps its meaning for everybody else.
  const cancellationTeamId = (sessionData.teamId || sessionData.teacher) as string | undefined
  const cancellationEmailsEnabled =
    bookingsToNotify.length > 0 || offerHolders.length > 0
      ? !!cancellationTeamId &&
        (await systemEmailEnabledFor(cancellationTeamId, 'session_cancellation'))
      : false
  if (bookingsToNotify.length > 0 && !cancellationEmailsEnabled) {
    const paidOnly = bookingsToNotify.filter((d) => bookingWasPaidFor(d.data() as SeatHold))
    console.log( // eslint-disable-line no-console
      `cancelSingleSession: cancellation emails disabled for team ${cancellationTeamId} — ` +
        `notifying ${paidOnly.length} of ${bookingsToNotify.length} booking(s) anyway (they paid)`
    )
    bookingsToNotify = paidOnly
  }

  if (bookingsToNotify.length > 0 || (offerHolders.length > 0 && cancellationEmailsEnabled)) {
    let activityName = 'Session'
    if (sessionData.activityId) {
      const [actErr, actDoc] = await to(
        db
          .collection(ACTIVITIES_COLLECTION)
          .doc(sessionData.activityId as string)
          .get()
      )
      if (!actErr && actDoc && actDoc.exists)
        activityName = (actDoc.data()?.name as string) || 'Session'
    }

    const rebookUrl =
      teamData.slug && sessionData.activityId
        ? publicUrl(getHostingUrl(), teamData.slug, 'booking', { activity: sessionData.activityId })
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
        await sendEmail({
          to: booking.email as string,
          teamId: (sessionData.teamId || sessionData.teacher) as string,
          subject: email.subject,
          html: email.html,
          text: email.text,
        })
        // No counter write here — it was settled above, for every booking this
        // cancellation resolves, whether or not this mail goes out or lands.
        sent++
      } catch (err) {
        console.error(`Error sending cancellation to ${booking.email}:`, err)
        failed++
      }
    }

    // The withdrawn offers. Same class, same story — but their seat was a hold
    // this function already gave back, so the loop above cannot reach them, and
    // being told nothing is the one outcome they would notice: a claim link that
    // silently stops working reads as a bug. No counter to move here; the
    // release decremented it when it deleted the hold.
    if (cancellationEmailsEnabled) {
      for (const holder of offerHolders) {
        if (!holder.email) continue
        try {
          const email = buildCancellationEmail({
            firstname: holder.firstname,
            teamName: teamData.name,
            activityName,
            sessionStart: (sessionData.start as Timestamp).toDate(),
            sessionEnd: (sessionData.end as Timestamp).toDate(),
            rebookUrl,
          })
          await sendEmail({
            to: holder.email,
            teamId: (sessionData.teamId || sessionData.teacher) as string,
            subject: email.subject,
            html: email.html,
            text: email.text,
          })
          sent++
        } catch (err) {
          console.error(`Error sending cancellation to waitlist offer ${holder.email}:`, err)
          failed++
        }
      }
    }
  }

  // The exception marker was written at the top of this function; only the
  // delete branch has work left.
  if (!markAsException) {
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
    // The queue's own documents are removed by the session-delete trigger
    // (`teardownWaitlistOnSessionDeleted`), which owns that job because a
    // standalone session is deleted client-side and never reaches this function.
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

  let sessionsToCancel: Array<{
    id: string
    ref: admin.firestore.DocumentReference
    data: admin.firestore.DocumentData
  }> = []

  if (deleteScope === 'future' && session.seriesId) {
    const [futureErr, futureSnap] = await to(
      db
        .collection(SESSIONS_COLLECTION)
        .where('seriesId', '==', session.seriesId)
        .where('start', '>=', session.start)
        .where('isException', '==', false)
        .get()
    )
    if (futureErr) throw new HttpsError('internal', 'Failed to fetch future sessions')
    sessionsToCancel = (futureSnap?.docs ?? []).map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      data: doc.data(),
    }))
  } else {
    sessionsToCancel = [{ id: sessionId, ref: sessionRef, data: session }]
  }

  const teamData = await getTeamData(db, teamId)
  let totalSent = 0
  let totalFailed = 0

  for (const s of sessionsToCancel) {
    const { sent, failed } = await cancelSingleSession(
      db,
      s.id,
      s.ref,
      s.data,
      teamData,
      deleteScope === 'single' && !!session.seriesId
    )
    totalSent += sent
    totalFailed += failed
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
  return isNaN(parsed.getTime()) ? (val as Timestamp) : Timestamp.fromDate(parsed)
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
  if (sessionErr || !sessionDoc || !sessionDoc.exists)
    throw new HttpsError('not-found', 'Session not found')

  const session = sessionDoc.data()!

  if (session.teacher !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You do not have permission to update this session')
  }
  if (!session.seriesId) throw new HttpsError('invalid-argument', 'This is not a recurring session')

  // Whitelist allowed update fields — prevents overwriting privileged fields
  // like teacher, teamId, seriesId, isException, createdBy, etc.
  const ALLOWED_UPDATE_FIELDS = new Set([
    'title',
    'description',
    'start',
    'end',
    'duration',
    'location',
    'tags',
    'maxParticipants',
    'type',
    'notes',
    'headline',
    'headlinePublic',
    'recurrence',
    'activityId',
    'activityName',
    'activityType',
    'providerName',
    'providerId',
    'allowBooking',
    'max_participants',
    'bookingMandatory',
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

    await sessionRef.update({
      ...normalized,
      isException: true,
      exceptionType: 'modified',
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { success: true, message: 'Session updated as exception.', updatedCount: 1 }
  }

  // editScope === 'future'
  const seriesRef = db.collection(SESSION_SERIES_COLLECTION).doc(session.seriesId as string)
  const [seriesErr, seriesDoc] = await to(seriesRef.get())
  if (seriesErr || !seriesDoc || !seriesDoc.exists)
    throw new HttpsError('not-found', 'Recurrence series not found')

  const [futureErr, futureSnap] = await to(
    db
      .collection(SESSIONS_COLLECTION)
      .where('seriesId', '==', session.seriesId)
      .where('start', '>=', session.start)
      .where('isException', '==', false)
      .get()
  )
  if (futureErr) throw new HttpsError('internal', 'Failed to fetch future sessions')

  const {
    location,
    tags,
    start,
    end,
    duration,
    recurrence: recurrenceUpdates,
    ...regularUpdates
  } = safeUpdates

  let newTimeHours: number | null = null
  let newTimeMinutes: number | null = null
  let newDuration: number | null = null

  if (start !== undefined) {
    const ts = toTimestamp(start).toDate()
    newTimeHours = ts.getUTCHours()
    newTimeMinutes = ts.getUTCMinutes()
  }
  if (start !== undefined && end !== undefined) {
    newDuration = Math.round(
      (toTimestamp(end).toDate().getTime() - toTimestamp(start).toDate().getTime()) / 60000
    )
  } else if (duration !== undefined) {
    newDuration = duration as number
  }

  const batch = db.batch()
  for (const doc of futureSnap?.docs ?? []) {
    const perDoc: Record<string, unknown> = {
      ...regularUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (location !== undefined) perDoc.location = location
    if (tags !== undefined) perDoc.tags = tags

    if (newTimeHours !== null && newTimeMinutes !== null) {
      const orig = (doc.data().start as Timestamp).toDate()
      const newStart = new Date(
        Date.UTC(
          orig.getUTCFullYear(),
          orig.getUTCMonth(),
          orig.getUTCDate(),
          newTimeHours,
          newTimeMinutes,
          0,
          0
        )
      )
      perDoc.start = Timestamp.fromDate(newStart)
      perDoc.instanceDate = perDoc.start
      if (newDuration)
        perDoc.end = Timestamp.fromDate(new Date(newStart.getTime() + newDuration * 60000))
    } else if (newDuration) {
      const orig = (doc.data().start as Timestamp).toDate()
      perDoc.end = Timestamp.fromDate(new Date(orig.getTime() + newDuration * 60000))
      perDoc.duration = newDuration
    }

    batch.update(doc.ref, perDoc)
  }

  const generationEnd = addMonths(new Date(), SERIES_HORIZON_MONTHS)
  // NO `lastGeneratedUntil` HERE. This used to bump the stored horizon to
  // now + 6 months on every "this and following" edit while generating nothing,
  // so the field claimed sessions that did not exist. That is not a cosmetic
  // lie: `rollSessionSeries` reads it to decide whether a series still has
  // runway, so a false horizon parks the roller for three months on precisely
  // the series a manager just touched. The field is now written only where
  // sessions were actually materialised to that instant — the regeneration
  // branch at the end of this function, and nowhere else in here.
  const seriesUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (updates.activityId !== undefined) seriesUpdates['template.activityId'] = updates.activityId
  if (updates.activityName !== undefined)
    seriesUpdates['template.activityName'] = updates.activityName
  if (updates.activityType !== undefined)
    seriesUpdates['template.activityType'] = updates.activityType
  if (location !== undefined) seriesUpdates['template.location'] = location
  if (tags !== undefined) seriesUpdates['template.tags'] = tags
  if (updates.notes !== undefined) seriesUpdates['template.notes'] = updates.notes
  if (updates.headline !== undefined) seriesUpdates['template.headline'] = updates.headline
  if (updates.headlinePublic !== undefined)
    seriesUpdates['template.headlinePublic'] = updates.headlinePublic
  if (updates.allowBooking !== undefined)
    seriesUpdates['template.allowBooking'] = updates.allowBooking
  if (updates.providerName !== undefined)
    seriesUpdates['template.providerName'] = updates.providerName
  if (updates.providerId !== undefined)
    seriesUpdates['template.providerId'] = updates.providerId
  if (updates.max_participants !== undefined)
    seriesUpdates['template.max_participants'] = updates.max_participants
  if (updates.bookingMandatory !== undefined)
    seriesUpdates['template.bookingMandatory'] = updates.bookingMandatory

  if (start !== undefined && newTimeHours !== null && newTimeMinutes !== null) {
    const seriesData = seriesDoc.data()!
    const currentStart = (seriesData.recurrence.startDate as Timestamp).toDate()
    seriesUpdates['recurrence.startDate'] = Timestamp.fromDate(
      new Date(
        Date.UTC(
          currentStart.getUTCFullYear(),
          currentStart.getUTCMonth(),
          currentStart.getUTCDate(),
          newTimeHours,
          newTimeMinutes,
          0,
          0
        )
      )
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
    newRecurrence = {
      ...(seriesData.recurrence as Record<string, unknown>),
      ...(seriesUpdates['recurrence.startDate']
        ? { startDate: seriesUpdates['recurrence.startDate'] }
        : {}),
    }

    for (const key of [
      'frequency',
      'interval',
      'daysOfWeek',
      'endCondition',
      'maxOccurrences',
    ] as const) {
      if (ru[key] !== undefined) {
        seriesUpdates[`recurrence.${key}`] = ru[key]
        ;(newRecurrence as Record<string, unknown>)[key] = ru[key]
        recurrenceChanged = true
      }
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
      db
        .collection(SESSIONS_COLLECTION)
        .where('seriesId', '==', session.seriesId)
        .where('start', '>=', sessionStart)
        .where('isException', '==', false)
        .get()
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newOccurrences = calculateOccurrences(
      newRecurrence as any,
      sessionStart.toDate(),
      generationEnd
    )
    const sessionsToDelete: admin.firestore.DocumentReference[] = []
    const existingDates = new Set<string>()

    for (const doc of allFutureSnap?.docs ?? []) {
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

    const toCreate = newOccurrences.filter(
      (o) => !existingDates.has(o.start.toISOString().slice(0, 10))
    )
    if (toCreate.length > 0) {
      const seriesData = seriesDoc.data()!
      // The template as it stands AFTER this edit. Fields this callable cannot
      // change (placeId, roomId, autoConfirm) are carried through untouched so
      // the regenerated sessions keep the shape `buildSeriesSessionDoc` writes
      // everywhere else.
      const tpl = {
        ...(seriesData.template ?? {}),
        activityId:
          ((seriesUpdates['template.activityId'] ?? seriesData.template?.activityId) as
            | string
            | null) ?? null,
        activityName:
          ((seriesUpdates['template.activityName'] ?? seriesData.template?.activityName) as
            | string
            | null) ?? null,
        activityType:
          ((seriesUpdates['template.activityType'] ?? seriesData.template?.activityType) as
            | string
            | null) ?? null,
        location:
          ((seriesUpdates['template.location'] ?? seriesData.template?.location) as
            | string
            | null) ?? null,
        tags: ((seriesUpdates['template.tags'] ?? seriesData.template?.tags) as string[]) ?? [],
        notes: ((seriesUpdates['template.notes'] ?? seriesData.template?.notes) as string) ?? '',
        headline:
          ((seriesUpdates['template.headline'] ?? seriesData.template?.headline) as
            | string
            | null) ?? null,
        headlinePublic:
          ((seriesUpdates['template.headlinePublic'] ??
            seriesData.template?.headlinePublic) as boolean) ?? false,
        allowBooking:
          ((seriesUpdates['template.allowBooking'] ??
            seriesData.template?.allowBooking) as boolean) ?? false,
        providerName:
          ((seriesUpdates['template.providerName'] ?? seriesData.template?.providerName) as
            | string
            | null) ?? null,
        providerId:
          ((seriesUpdates['template.providerId'] ?? seriesData.template?.providerId) as
            | string
            | null) ?? null,
        max_participants:
          ((seriesUpdates['template.max_participants'] ??
            seriesData.template?.max_participants) as number) ?? null,
        bookingMandatory:
          ((seriesUpdates['template.bookingMandatory'] ??
            seriesData.template?.bookingMandatory) as boolean) ?? false,
      }
      generatedCount = await materializeOccurrences(
        db,
        session.seriesId as string,
        { ...seriesData, template: tpl },
        toCreate
      )
    }

    // Written HERE and only here: these sessions now exist up to generationEnd,
    // so the horizon is a fact rather than a claim. (`buildSeriesSessionDoc` is
    // referenced through materializeOccurrences — same shape as the callable and
    // the daily roller.)
    await to(seriesRef.update(seriesHorizonUpdate(generationEnd, generatedCount)))
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
  if (!contactId)
    throw new HttpsError('permission-denied', 'Invalid membership session. Please log in again.')

  const { teamSlug, sessionId: requestedSessionId } = request.data as {
    teamSlug?: string
    sessionId?: string
  }
  if (!teamSlug) throw new HttpsError('invalid-argument', 'teamSlug is required')

  const db = admin.firestore()
  const DEFAULT_WINDOW_MINUTES = 15

  // Resolve slug → teamId via public_profile collectionGroup
  const slugSnap = await db
    .collectionGroup('public_profile')
    .where('slug', '==', teamSlug)
    .limit(5)
    .get()
  const teamDoc = slugSnap.docs.find((d) => {
    const segs = d.ref.path.split('/')
    return segs[0] === 'teams' && segs.length === 4
  })
  if (!teamDoc) throw new HttpsError('not-found', 'Team not found for this QR code')

  const teamId = teamDoc.ref.parent.parent!.id
  const [teamErr, teamSnap] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  if (teamErr || !teamSnap || !teamSnap.exists) throw new HttpsError('not-found', 'Team not found')

  const windowMinutes: number =
    (teamSnap.data()?.settings?.selfCheckInWindowMinutes as number) ?? DEFAULT_WINDOW_MINUTES
  const windowMs = windowMinutes * 60 * 1000

  const [contactErr, contactSnap] = await to(db.collection('contacts').doc(contactId).get())
  if (contactErr || !contactSnap || !contactSnap.exists)
    throw new HttpsError('not-found', 'Contact not found')
  const contact = contactSnap.data()!
  if ((contact.teamId || contact.teacher) !== teamId)
    throw new HttpsError('permission-denied', 'You are not a member of this team')

  const now = Timestamp.now()

  let sessionsToProcess: Array<Record<string, unknown> & { id: string }> = []

  if (requestedSessionId) {
    const [sErr, sSnap] = await to(db.collection('sessions').doc(requestedSessionId).get())
    if (sErr || !sSnap || !sSnap.exists) throw new HttpsError('not-found', 'Session not found')
    const s = sSnap.data()!
    if ((s.teamId || s.teacher) !== teamId)
      throw new HttpsError('permission-denied', 'Session does not belong to this team')
    sessionsToProcess = [{ id: requestedSessionId, ...s }]
  } else {
    const LOOKBACK_MS = 4 * 60 * 60 * 1000
    const queryStart = Timestamp.fromMillis(now.toMillis() - LOOKBACK_MS)
    const queryEnd = Timestamp.fromMillis(now.toMillis() + windowMs)
    const [sessErr, sessSnap] = await to(
      db
        .collection('sessions')
        .where('teamId', '==', teamId)
        .where('start', '>=', queryStart)
        .where('start', '<=', queryEnd)
        .orderBy('start', 'asc')
        .get()
    )
    sessionsToProcess = (sessSnap?.docs ?? [])
      .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })
      .filter((s) => {
        const end =
          (s.end as Timestamp | undefined) ||
          Timestamp.fromMillis(
            (s.start as Timestamp).toMillis() +
              ((s.duration as number | undefined) || 60) * 60 * 1000
          )
        const checkInOpens = Timestamp.fromMillis((s.start as Timestamp).toMillis() - windowMs)
        return now >= checkInOpens && end.toMillis() > now.toMillis()
      })
  }

  if (sessionsToProcess.length === 0) return { status: 'no_sessions' }

  // Resolve activity names
  const uniqueActivityIds = [
    ...new Set(
      sessionsToProcess.map((s) => s.activityId as string | undefined).filter(Boolean) as string[]
    ),
  ]
  const activityNameMap: Record<string, string> = {}
  await Promise.all(
    uniqueActivityIds.map(async (aid) => {
      const snap = await db.collection(ACTIVITIES_COLLECTION).doc(aid).get()
      if (snap.exists) activityNameMap[aid] = (snap.data()?.name as string) || aid
    })
  )
  const resolveActivityName = (s: Record<string, unknown>) =>
    activityNameMap[s.activityId as string] || (s.activityId as string) || 'Session'

  if (sessionsToProcess.length > 1 && !requestedSessionId) {
    return {
      status: 'session_required',
      sessions: sessionsToProcess.map((s) => ({
        id: s.id,
        activityName: resolveActivityName(s),
        start: s.start,
        end:
          (s.end as Timestamp) ||
          Timestamp.fromMillis(
            (s.start as Timestamp).toMillis() + ((s.duration as number) || 60) * 60 * 1000
          ),
      })),
    }
  }

  const session = sessionsToProcess[0]
  const resolvedSessionId = session.id
  const sessionStart = session.start as Timestamp
  const sessionEnd =
    (session.end as Timestamp) ||
    Timestamp.fromMillis(sessionStart.toMillis() + ((session.duration as number) || 60) * 60 * 1000)
  const checkInWindowStart = Timestamp.fromMillis(sessionStart.toMillis() - windowMs)

  if (now < checkInWindowStart || now > sessionEnd)
    throw new HttpsError('failed-precondition', 'Check-in window is not open for this session')

  const sessionRef = db.collection('sessions').doc(resolvedSessionId)
  const participantRef = sessionRef.collection('participants').doc(contactId)
  const [pErr, participantDoc] = await to(participantRef.get())
  if (!pErr && participantDoc && participantDoc.exists) {
    return {
      status: 'checked_in',
      alreadyCheckedIn: true,
      sessionName: resolveActivityName(session),
      sessionStart: sessionStart.toMillis(),
    }
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

  // ── The waiver gate — REFUSE ONLY ──────────────────────────────────────────
  // This callable writes `participants` with NO booking required and none looked
  // for (the booking read above only CONFIRMS an existing one; its absence is
  // not an error). Left ungated, a member who never signed — or whose signature
  // a `require_resign` publish superseded — walks up, scans the kiosk QR, and is
  // written into the room. They attend unsigned and the studio's evidence is
  // nothing at all.
  //
  // It is gated because it CAN be: it is a callable, the contactId is on the
  // contact-session token, and the cost is the same one policy read plus a
  // signer read per applicable waiver every other rail pays.
  //
  // It writes NO acceptance, because a check-in collects no tick — there is no
  // consent step on a QR scan and inventing one would record a signature nobody
  // gave.
  //
  // ── THE REFUSAL CARRIES ITS OWN WAY OUT, and it has to come from HERE ──────
  // The mobile app is the surface that raises this refusal most, and it cannot
  // build the link itself: the web origin lives in a server-side env param
  // (`HOSTING_URL`), the app has no equivalent, and a client that guessed one
  // would send a member at a door to a hostname that may not exist. So the
  // server — which holds both the origin and the team slug the QR carried —
  // attaches `signUrl` to the refusal, pointing at the member's own Space, the
  // one surface a person standing at a door can complete on their phone.
  try {
    await enforceWaiverGate({
      teamId,
      activityId: (session.activityId as string | undefined) ?? null,
      subject: {
        contactId,
        name: `${(contact.firstname as string) ?? ''} ${(contact.lastname as string) ?? ''}`.trim(),
        email: (contact.email as string) ?? null,
      },
      submissions: [],
      source: 'kiosk',
      signerEmailVerifiedBy: 'session',
      ip: request.rawRequest?.ip ?? null,
      userAgent: null,
      locale: null,
      nowMs: Date.now(),
    })
  } catch (err) {
    const e = err as HttpsError & { details?: { reason?: string } }
    const reason = e?.details?.reason
    if (typeof reason === 'string' && reason.startsWith('waiver_')) {
      throw new HttpsError(e.code ?? 'failed-precondition', e.message, {
        ...(e.details as Record<string, unknown>),
        signUrl: publicUrl(getHostingUrl(), teamSlug, 'space'),
      })
    }
    throw err
  }

  const batch = db.batch()
  batch.set(participantRef, participantData)

  if (!bErr && bookingDoc && bookingDoc.exists) {
    const bStatus = bookingDoc.data()?.status as string | undefined
    if (!bStatus || bStatus === 'pending') {
      batch.update(bookingRef, {
        status: 'confirmed',
        confirmed_at: FieldValue.serverTimestamp(),
        // A confirmed seat is an ordinary booking — the hold markers go with the
        // same write. The claim flag is not an oversell any more
        // (bookingHoldsSeat no longer expires a SETTLED claim), but it still
        // hides this person from `sendBookingReminders` forever; and a claim
        // that was mid-payment also carries `payment_status: 'required'` +
        // `expires_at`, which DO still cost the seat (freed at the deadline by
        // the recount, then hard-deleted at 02:00 by
        // releaseExpiredBookingHolds). `confirmClearedHoldFields` is the one
        // patch every confirm surface applies; absent fields are a no-op.
        ...confirmClearedHoldFields(bookingDoc.data() as SeatHold, FieldValue.delete()),
      })
      // No `bookings_count` here: a confirmed booking still HOLDS its seat
      // (bookingHoldsSeat), so decrementing on check-in was a leftover from the
      // pre-merge counter model — it put the class one seat under for whoever
      // won the race with trackBookings' recount of this same status flip.
      batch.update(sessionRef, {
        conversions_count: FieldValue.increment(1),
      })
      batch.update(db.collection('contacts').doc(contactId), {
        pending_bookings_count: FieldValue.increment(-1),
      })
    }
  }

  await batch.commit()
  return {
    status: 'checked_in',
    alreadyCheckedIn: false,
    sessionName: resolveActivityName(session),
    sessionStart: sessionStart.toMillis(),
  }
})
