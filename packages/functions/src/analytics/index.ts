import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { format } from 'date-fns'
import { to } from '../utils/async'
import { getActiveContacts, countByField } from '../utils/contacts'
import {
  ACQUISITION_STAGES,
  CONTACT_WEEKLY_REPORTS_SUBCOLLECTION,
  PARTICIPANTS_SUBCOLLECTION,
  TEAM_WEEKLY_REPORTS_SUBCOLLECTION,
} from '@linyup/shared'

// The acquisition funnel only ever advances forward by design, so a stage that
// moves to a LOWER ordinal is a deliberate manual correction (e.g. undoing a
// mistaken promotion) — not an organic transition. Corrections are logged
// distinctly and must not re-fire conversion analytics or outreach automation.
function stageRank(stage: unknown): number {
  return (ACQUISITION_STAGES as readonly string[]).indexOf(stage as string)
}

const DATE_FORMAT = 'PPP'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function logActivity(teamId: string, entry: Record<string, unknown>): Promise<void> {
  const db = admin.firestore()
  const [err] = await to(
    db
      .collection('teams')
      .doc(teamId)
      .collection('activity_log')
      .add({
        ...entry,
        created_at: FieldValue.serverTimestamp(),
      })
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
      activityEvent = 'booking_created'
      bookingData = newData
    } else if (oldData && !newData) {
      activityEvent = 'booking_cancelled'
      bookingData = oldData
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

    // ── Coaching session: maintain bookings_count and status ─────────────────
    if (session.activityType === 'coaching') {
      const [, confirmedSnap] = await to(
        db
          .collection('sessions')
          .doc(sessionId)
          .collection('bookings')
          .where('status', '==', 'confirmed')
          .get()
      )
      if (confirmedSnap) {
        const count = confirmedSnap.size
        const maxParticipants = (session.max_participants as number) || 1
        const newStatus =
          session.status === 'cancelled' ? 'cancelled' : count >= maxParticipants ? 'full' : 'open'
        await to(
          db.collection('sessions').doc(sessionId).update({
            bookings_count: count,
            status: newStatus,
          })
        )
      }
    }

    const contactFullname =
      `${(bookingData.firstname as string) || ''} ${(bookingData.lastname as string) || ''}`.trim() ||
      event.params.bookingId
    const sessionStart = session.start as Timestamp | undefined
    const sessionDateLabel = sessionStart
      ? format(sessionStart.toDate(), DATE_FORMAT)
      : 'unknown date'
    const isCoaching = session.activityType === 'coaching'

    const descMap: Record<string, string> = {
      booking_created: `${contactFullname} booked a ${isCoaching ? 'coaching session' : 'session'} on ${sessionDateLabel}.`,
      booking_confirmed: `${contactFullname} confirmed for ${isCoaching ? 'coaching session' : 'session'} on ${sessionDateLabel}.`,
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
        activity_type: session.activityType || 'group_class',
        from_bio_link: bookingData.fromBioLink === true,
        authenticated_booking: bookingData.authenticated_booking === true,
      },
      refs: { contact: bookingData.contact || event.params.bookingId, session: sessionId },
    })
  }
)

// ─── trackSessions ────────────────────────────────────────────────────────────

export const trackSessions = onDocumentWritten('sessions/{sessionId}', async (event) => {
  const newData = event.data?.after.exists ? event.data.after.data() : null
  const oldData = event.data?.before.exists ? event.data.before.data() : null

  const teamId = (newData?.teamId || newData?.teacher || oldData?.teamId || oldData?.teacher) as
    | string
    | undefined
  if (!teamId) return

  const increment = newData && !oldData ? 1 : !newData && oldData ? -1 : 0
  if (increment === 0) return

  const db = admin.firestore()
  const sessionDate = (newData?.start || oldData?.start) as Timestamp | undefined
  const month = sessionDate ? format(sessionDate.toDate(), 'yyyy-MM') : null
  if (!month) return

  const activityType =
    ((newData?.activityType || oldData?.activityType) as string | undefined) || 'group_class'

  // Upsert a monthly session counter for the team — total + per-type breakdown
  const counterRef = db.collection('teams').doc(teamId).collection('session_counts').doc(month)
  await to(
    counterRef.set(
      {
        month,
        sessions_count: FieldValue.increment(increment),
        [`sessions_count_by_type.${activityType}`]: FieldValue.increment(increment),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  )
})

// ─── trackContacts ────────────────────────────────────────────────────────────

export const trackContacts = onDocumentWritten('contacts/{contactId}', async (event) => {
  const newData = event.data?.after.exists ? event.data.after.data() : null
  const oldData = event.data?.before.exists ? event.data.before.data() : null

  const teamId = (newData?.teamId || newData?.teacher || oldData?.teamId || oldData?.teacher) as
    | string
    | undefined
  if (!teamId) return

  // No logging after anonymization (GDPR)
  if (newData?.anonymized_at) return

  const db = admin.firestore()
  const firstname = ((newData?.firstname || oldData?.firstname) as string | undefined) ?? ''
  const lastname = ((newData?.lastname || oldData?.lastname) as string | undefined) ?? ''
  const fullname = `${firstname} ${lastname}`.trim() || event.params.contactId
  const contactId = event.params.contactId

  const baseRefs = { contact: contactId, user: teamId }

  // Contact created
  if (!oldData && newData) {
    await logActivity(teamId, {
      event: 'contact_add',
      parameters: {
        description: `${fullname} was added as a contact.`,
        contact_firstname: firstname,
        contact_lastname: lastname,
      },
      refs: baseRefs,
    })
    return
  }

  if (!oldData || !newData) return

  const promises: Promise<void>[] = []

  // Soft-delete
  if (!oldData.deleted_at && newData.deleted_at) {
    promises.push(
      logActivity(teamId, {
        event: 'contact_delete',
        parameters: {
          description: `${fullname} was moved to trash.`,
          contact_firstname: firstname,
          contact_lastname: lastname,
        },
        refs: baseRefs,
      })
    )
  }

  // Archive / unarchive
  if (!oldData.archived_at && newData.archived_at) {
    promises.push(
      logActivity(teamId, {
        event: 'contact_archive',
        parameters: {
          description: `${fullname} was archived.`,
          contact_firstname: firstname,
          contact_lastname: lastname,
        },
        refs: baseRefs,
      })
    )
    // Trial dropout: archived while still in the trial funnel (never joined)
    if (oldData.acquisition_stage === 'trial_booked' || oldData.acquisition_stage === 'trial_attended') {
      const weekLabel = format(new Date(), "R-'W'II")
      promises.push(
        db
          .collection('teams')
          .doc(teamId)
          .collection(TEAM_WEEKLY_REPORTS_SUBCOLLECTION)
          .doc(weekLabel)
          .set({ trial_dropouts_count: FieldValue.increment(1) }, { merge: true })
          .then(() => undefined)
          .catch((err) => {
            console.error('trackContacts: trial_dropouts_count update failed', err)
          })
      )
    }
  } else if (oldData.archived_at && !newData.archived_at) {
    promises.push(
      logActivity(teamId, {
        event: 'contact_unarchive',
        parameters: {
          description: `${fullname} was restored from archive.`,
          contact_firstname: firstname,
          contact_lastname: lastname,
        },
        refs: baseRefs,
      })
    )
  }

  // Acquisition stage change
  if (
    oldData.acquisition_stage &&
    newData.acquisition_stage &&
    oldData.acquisition_stage !== newData.acquisition_stage
  ) {
    const isCorrection = stageRank(newData.acquisition_stage) < stageRank(oldData.acquisition_stage)
    if (isCorrection) {
      // Backward move = manual correction. Log it distinctly for the audit trail.
      promises.push(
        logActivity(teamId, {
          event: 'acquisition_stage_correction',
          parameters: {
            description: `${fullname} stage was corrected from ${oldData.acquisition_stage as string} to ${newData.acquisition_stage as string}.`,
            contact_firstname: firstname,
            contact_lastname: lastname,
            acquisition_stage: { before: oldData.acquisition_stage, after: newData.acquisition_stage },
          },
          refs: baseRefs,
        })
      )
      // Reverse the weekly conversion tally when undoing a 'joined'. Best-effort:
      // exact for same-week corrections (the common case); clamped at >= 0 so a
      // cross-week correction can never push the counter negative.
      if (oldData.acquisition_stage === 'joined' && newData.acquisition_stage !== 'joined') {
        const weekLabel = format(new Date(), "R-'W'II")
        const reportRef = db
          .collection('teams')
          .doc(teamId)
          .collection(TEAM_WEEKLY_REPORTS_SUBCOLLECTION)
          .doc(weekLabel)
        promises.push(
          db
            .runTransaction(async (tx) => {
              const snap = await tx.get(reportRef)
              const current = (snap.get('trial_conversions_count') as number | undefined) ?? 0
              if (current <= 0) return
              tx.set(reportRef, { trial_conversions_count: current - 1 }, { merge: true })
            })
            .then(() => undefined)
            .catch((err) => {
              console.error('trackContacts: trial_conversions_count reversal failed', err)
            })
        )
      }
    } else {
      promises.push(
        logActivity(teamId, {
          event: 'acquisition_stage_change',
          parameters: {
            description: `${fullname} moved from ${oldData.acquisition_stage as string} to ${newData.acquisition_stage as string}.`,
            contact_firstname: firstname,
            contact_lastname: lastname,
            acquisition_stage: { before: oldData.acquisition_stage, after: newData.acquisition_stage },
          },
          refs: baseRefs,
        })
      )
      // Trial conversion: crossed into the community (reached 'joined')
      if (newData.acquisition_stage === 'joined' && oldData.acquisition_stage !== 'joined') {
        const weekLabel = format(new Date(), "R-'W'II")
        promises.push(
          db
            .collection('teams')
            .doc(teamId)
            .collection(TEAM_WEEKLY_REPORTS_SUBCOLLECTION)
            .doc(weekLabel)
            .set({ trial_conversions_count: FieldValue.increment(1) }, { merge: true })
            .then(() => undefined)
            .catch((err) => {
              console.error('trackContacts: trial_conversions_count update failed', err)
            })
        )
      }
    }
  }

  // Subscription change
  if ((oldData.subscription_type_id ?? null) !== (newData.subscription_type_id ?? null)) {
    const before = (oldData.subscription_type_name ??
      oldData.subscription_type_id ??
      'none') as string
    const after = (newData.subscription_type_name ??
      newData.subscription_type_id ??
      'none') as string
    promises.push(
      logActivity(teamId, {
        event: 'subscription_change',
        parameters: {
          description: `${fullname} subscription changed from "${before}" to "${after}".`,
          contact_firstname: firstname,
          contact_lastname: lastname,
          subscription: { before, after },
        },
        refs: baseRefs,
      })
    )
  }

  // Rank changes — one log entry per system that changed
  const oldRanks = (oldData.ranks ?? {}) as Record<string, number>
  const newRanks = (newData.ranks ?? {}) as Record<string, number>
  const allSystems = new Set([...Object.keys(oldRanks), ...Object.keys(newRanks)])
  for (const systemId of allSystems) {
    const before = oldRanks[systemId] ?? null
    const after = newRanks[systemId] ?? null
    if (before !== after) {
      promises.push(
        logActivity(teamId, {
          event: 'rank_change',
          parameters: {
            description: `${fullname} rank changed in system "${systemId}".`,
            contact_firstname: firstname,
            contact_lastname: lastname,
            systemId,
            rank: { before, after },
          },
          refs: baseRefs,
        })
      )
    }
  }

  await Promise.all(promises)
})

// ─── trackSessionParticipants ─────────────────────────────────────────────────

export const trackSessionParticipants = onDocumentWritten(
  'sessions/{sessionId}/participants/{participantId}',
  async (event) => {
    const { sessionId } = event.params
    const newData = event.data?.after.exists ? event.data.after.data() : null
    const oldData = event.data?.before.exists ? event.data.before.data() : null

    const activityEvent =
      !oldData && newData
        ? 'session_participant_add'
        : oldData && !newData
          ? 'session_participant_delete'
          : null
    if (!activityEvent) return

    const participantData = newData ?? oldData!
    const contactId = participantData.contactId as string | undefined
    if (!contactId) return

    const db = admin.firestore()

    const [sessionErr, sessionDoc] = await to(db.collection('sessions').doc(sessionId).get())
    if (sessionErr || !sessionDoc?.exists) return
    const session = sessionDoc.data()!
    const teamId = (session.teamId || session.teacher) as string | undefined
    if (!teamId) return

    const [, contactDoc] = await to(db.collection('contacts').doc(contactId).get())
    const contact = contactDoc?.data()
    const firstname = (contact?.firstname as string | undefined) ?? ''
    const lastname = (contact?.lastname as string | undefined) ?? ''
    const fullname = `${firstname} ${lastname}`.trim() || contactId

    const sessionStart = session.start as Timestamp | undefined
    const sessionDateLabel = sessionStart
      ? format(sessionStart.toDate(), DATE_FORMAT)
      : 'unknown date'

    // Update denormalized counters on the contact
    const counterUpdate: Record<string, unknown> = {
      total_sessions: FieldValue.increment(activityEvent === 'session_participant_add' ? 1 : -1),
    }
    if (activityEvent === 'session_participant_add' && sessionStart) {
      counterUpdate.last_session_at = sessionStart
    }
    // First attendance promotes the acquisition stage trial_booked → trial_attended.
    // Sticky high-water mark: only advance on attendance, never regress on removal.
    if (activityEvent === 'session_participant_add' && contact?.acquisition_stage === 'trial_booked') {
      counterUpdate.acquisition_stage = 'trial_attended'
      counterUpdate.acquisition_stage_updated_at = FieldValue.serverTimestamp()
      counterUpdate.trial_attended_at = sessionStart ?? FieldValue.serverTimestamp()
    }
    await to(db.collection('contacts').doc(contactId).update(counterUpdate))

    const description =
      activityEvent === 'session_participant_add'
        ? `${fullname} attended a session on ${sessionDateLabel}.`
        : `${fullname} was removed from a session on ${sessionDateLabel}.`

    await logActivity(teamId, {
      event: activityEvent,
      parameters: {
        description,
        contact_firstname: firstname,
        contact_lastname: lastname,
        session_date: sessionStart ?? null,
      },
      refs: { contact: contactId, session: sessionId, user: teamId },
    })
  }
)

// ─── weeklyReports ────────────────────────────────────────────────────────────
// Runs every Monday at 00:05 UTC. Generates per-team weekly summary snapshots.
// Only creates a report if one doesn't exist yet for the week — once created,
// it is never overwritten, so incremental updates from event triggers are preserved.

// getActiveContacts and countByField are imported from '../utils/contacts'

export const weeklyReports = onSchedule(
  { schedule: 'every monday 00:05', timeZone: 'UTC', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const db = admin.firestore()
    const now = new Date()
    const weekLabel = format(now, `R-'W'II`)

    const [teamsErr, teamsSnap] = await to(
      db.collection('teams').where('archived_at', '==', null).get()
    )
    if (teamsErr || !teamsSnap || teamsSnap.empty) return

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id
      try {
        const reportRef = db
          .collection('teams')
          .doc(teamId)
          .collection(TEAM_WEEKLY_REPORTS_SUBCOLLECTION)
          .doc(weekLabel)

        // If a report already exists for this week, skip — never overwrite, to preserve
        // any increments applied mid-week by event triggers (trackContacts, trackSessions).
        const [existErr, existSnap] = await to(reportRef.get())
        if (!existErr && existSnap?.exists) continue

        const contacts = await getActiveContacts(db, teamId)
        const active_contacts_count = contacts.length

        const contacts_count_by_stage = countByField(contacts, 'acquisition_stage')
        const contacts_with_active_affiliation = contacts.filter(
          (c) => (c.affiliation_summary as { has_active?: boolean } | undefined)?.has_active === true
        ).length
        const contacts_count_by_subscription_type = countByField(contacts, 'subscription_type_id')
        const contacts_count_by_recurrence = countByField(
          contacts.filter((c) => c.subscription_type_id),
          'subscription_recurrence'
        )

        const weekStart = Timestamp.fromMillis(now.getTime() - 7 * 24 * 3600 * 1000)
        const [, sessionsSnap] = await to(
          db
            .collection('sessions')
            .where('teamId', '==', teamId)
            .where('start', '>=', weekStart)
            .where('start', '<=', Timestamp.fromDate(now))
            .get()
        )
        const sessions_count = sessionsSnap?.size ?? 0

        // Per-type breakdown: group_class vs coaching (and any future types)
        const sessions_count_by_type: Record<string, number> = {}
        if (sessionsSnap) {
          for (const s of sessionsSnap.docs) {
            const t = (s.data().activityType as string | undefined) || 'group_class'
            sessions_count_by_type[t] = (sessions_count_by_type[t] ?? 0) + 1
          }
        }

        // Bookings in the same window — count by session type
        const [, bookingsSnap] = await to(
          db
            .collectionGroup('bookings')
            .where('teamId', '==', teamId)
            .where('joinedAt', '>=', weekStart)
            .where('joinedAt', '<=', Timestamp.fromDate(now))
            .where('status', '==', 'confirmed')
            .get()
        )
        const bookings_count_by_type: Record<string, number> = {}
        const bookings_count = bookingsSnap?.size ?? 0
        if (bookingsSnap) {
          // Resolve activityType per booking via parent session
          const sessionTypeCache: Record<string, string> = {}
          for (const b of bookingsSnap.docs) {
            const sessionRef = b.ref.parent.parent
            if (!sessionRef) continue
            if (!sessionTypeCache[sessionRef.id]) {
              const [, sDoc] = await to(sessionRef.get())
              sessionTypeCache[sessionRef.id] =
                (sDoc?.data()?.activityType as string | undefined) || 'group_class'
            }
            const t = sessionTypeCache[sessionRef.id]
            bookings_count_by_type[t] = (bookings_count_by_type[t] ?? 0) + 1
          }
        }

        await reportRef.set({
          iso_week: weekLabel,
          generated_at: FieldValue.serverTimestamp(),
          active_contacts_count,
          contacts_count_by_stage,
          contacts_with_active_affiliation,
          contacts_count_by_subscription_type,
          contacts_count_by_recurrence,
          sessions_count,
          sessions_count_by_type,
          bookings_count,
          bookings_count_by_type,
          // Start at 0; incremented by trackContacts triggers as events occur during the week
          trial_conversions_count: 0,
          trial_dropouts_count: 0,
        })

        // Per-contact weekly reports — feeds the StatsPanel trend chart
        if (sessionsSnap && !sessionsSnap.empty) {
          const contactSessionCounts: Record<string, number> = {}

          for (const sessionDoc of sessionsSnap.docs) {
            const [, partsSnap] = await to(
              sessionDoc.ref.collection(PARTICIPANTS_SUBCOLLECTION).get()
            )
            if (!partsSnap || partsSnap.empty) continue
            for (const partDoc of partsSnap.docs) {
              // Participant doc ID is contactId; fallback to 'contact' field for safety
              const contactId = partDoc.id || (partDoc.data().contact as string | undefined)
              if (contactId) {
                contactSessionCounts[contactId] = (contactSessionCounts[contactId] ?? 0) + 1
              }
            }
          }

          for (const [contactId, sessions_count_contact] of Object.entries(contactSessionCounts)) {
            const contactReportRef = db
              .collection('contacts')
              .doc(contactId)
              .collection(CONTACT_WEEKLY_REPORTS_SUBCOLLECTION)
              .doc(weekLabel)
            const [, existSnap] = await to(contactReportRef.get())
            if (existSnap?.exists) continue // never overwrite mid-week increments
            await to(
              contactReportRef.set({
                iso_week: weekLabel,
                sessions_count: sessions_count_contact,
                generated_at: FieldValue.serverTimestamp(),
              })
            )
          }
        }
      } catch (err) {
        console.error(`weeklyReports: error for team ${teamId}:`, err)
      }
    }
  }
)
