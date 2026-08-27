// `trackPerformanceCheckins` — maintains `Contact.last_checkin_at` and logs the
// `performance_checkin` activity event.
//
// `last_checkin_at` is the max `taken_at` across the whole subcollection,
// recomputed from a FRESH QUERY on every create, update AND delete — the same
// "never trust the incoming document alone" reasoning as
// `trackGoalEvaluations`: an edit to the newest check-in's `taken_at`, or its
// deletion, must not leave a stale high-water mark behind. Idempotent: skips
// the contact write when the recomputed value already matches what's stored.
//
// The activity-log row is different — it is the SUBMISSION event, so it fires
// ONLY on create, never on an edit or on the recompute above touching a
// different check-in.

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  CONTACTS_COLLECTION,
  CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION,
  type PerformanceCheckin,
} from '@linyup/shared'
import { to } from '../utils/async'
import { logActivity } from '../utils/users'
import { fireCheckinSubmitted } from './events'

function timestampEquals(a: Timestamp | null | undefined, b: Timestamp | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.isEqual(b)
}

export const trackPerformanceCheckins = onDocumentWritten(
  `${CONTACTS_COLLECTION}/{contactId}/${CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION}/{checkinId}`,
  async (event) => {
    const beforeExists = event.data?.before.exists ?? false
    const afterExists = event.data?.after.exists ?? false
    if (!beforeExists && !afterExists) return

    const { contactId, checkinId } = event.params
    const db = admin.firestore()
    const contactRef = db.collection(CONTACTS_COLLECTION).doc(contactId)

    // ── ONE WRITER of last_checkin_at — absolute, from the max taken_at in a
    // fresh query (see module header).
    const [queryErr, latestSnap] = await to(
      contactRef
        .collection(CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION)
        .orderBy('taken_at', 'desc')
        .limit(1)
        .get(),
    )
    const latestTakenAt =
      !queryErr && latestSnap && !latestSnap.empty
        ? ((latestSnap.docs[0].data().taken_at as Timestamp | undefined) ?? null)
        : null

    const [contactErr, contactSnap] = await to(contactRef.get())
    if (contactErr || !contactSnap?.exists) return
    const contact = contactSnap.data()!
    const teamId = (contact.teamId as string | undefined) || (contact.teacher as string | undefined)

    const currentLastCheckin = contact.last_checkin_at as Timestamp | undefined
    if (!timestampEquals(currentLastCheckin, latestTakenAt)) {
      const [updateErr] = await to(contactRef.update({ last_checkin_at: latestTakenAt }))
      if (updateErr) {
        console.error(`[coaching] trackPerformanceCheckins: update failed for ${contactId}:`, updateErr) // eslint-disable-line no-console
      }
    }

    // ── Activity log + automation — SUBMISSION only, never an edit ──────────
    if (beforeExists || !afterExists || !teamId) return

    const after = event.data!.after.data() as PerformanceCheckin
    const fullname =
      `${(contact.firstname as string) || ''} ${(contact.lastname as string) || ''}`.trim() || contactId

    const [logErr] = await to(
      logActivity(teamId, {
        event: 'performance_checkin',
        created_at: FieldValue.serverTimestamp(),
        parameters: {
          description: `${fullname} submitted a check-in.`,
          checkin_id: checkinId,
          context: after.context,
          profile_key: after.profile_key ?? null,
          primary_lever: after.primary_lever ?? null,
        },
        refs: { contact: contactId, user: teamId },
      }),
    )
    if (logErr) {
      console.error(`[coaching] trackPerformanceCheckins: activity log failed for ${checkinId}:`, logErr) // eslint-disable-line no-console
    }

    await fireCheckinSubmitted({
      teamId,
      contactId,
      checkinId,
      profileKey: after.profile_key ?? null,
      primaryLever: after.primary_lever ?? null,
    })
  },
)
