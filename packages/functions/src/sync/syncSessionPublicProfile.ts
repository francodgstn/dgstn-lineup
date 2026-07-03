// Keeps sessions/{sessionId}/public_profile/{sessionId} in sync.
// Regular sessions: synced when allowBooking === true.
// Coaching sessions (activityType === 'coaching'): always synced when status !== 'cancelled'.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import type { Timestamp } from 'firebase-admin/firestore'
import { resolveActivityAccessRule } from '@linyup/shared'


export const syncSessionPublicProfile = onDocumentWritten('sessions/{sessionId}', async (event) => {
  const { sessionId } = event.params
  const afterRef = event.data!.after.ref

  const data = event.data!.after.exists ? event.data!.after.data()! : null
  const isCoaching = data?.activityType === 'coaching'

  // Remove public profile when:
  // - session deleted
  // - regular session with allowBooking disabled
  // - coaching session explicitly cancelled
  const shouldBePublic = data && (isCoaching ? data.status !== 'cancelled' : data.allowBooking === true)

  if (!shouldBePublic) {
    await afterRef.collection('public_profile').doc(sessionId).delete()
    return
  }

  if (isCoaching) {
    // Coaching session — public profile includes slot-specific fields
    const publicProfile = {
      type: 'coaching_session',
      teamId: data.teamId,
      activityType: 'coaching',
      activityName: data.activityName || null,
      coachId: data.coachId || null,
      coachName: data.coachName || null,
      templateId: data.templateId || null,
      start: data.start as Timestamp,
      end: data.end as Timestamp,
      duration_minutes: data.duration_minutes || null,
      location: data.location || null,
      onlineUrl: data.onlineUrl || null,
      max_participants: data.max_participants || null,
      bookings_count: data.bookings_count || 0,
      isFreeTrial: data.isFreeTrial !== false,
      // Coaching carries its own access gate on the session doc.
      accessRule: resolveActivityAccessRule({ accessRule: data.accessRule, isFreeTrial: data.isFreeTrial }),
      status: data.status || 'open',
      allowBooking: true,
      bookingMandatory: data.bookingMandatory === true,
    }
    await afterRef.collection('public_profile').doc(sessionId).set(publicProfile)
  } else {
    // Regular group-class session
    const publicProfile = {
      type: 'session',
      teamId: data.teamId,
      activityType: data.activityType || 'group_class',
      activityId: data.activityId || null,
      activityName: data.activityName || null,
      activityColor: data.activityColor || null,
      start: data.start as Timestamp,
      end: data.end as Timestamp,
      location: data.location || null,
      capacity: data.capacity || null,
      participants_count: data.participants_count || 0,
      allowBooking: true,
      slug: data.slug || null,
      instructorName: data.instructorName || null,
      instructorId: data.instructorId || null,
      max_participants: data.max_participants || null,
      bookings_count: data.bio_link_bookings_count || 0,
      bookingMandatory: data.bookingMandatory === true,
    }
    await afterRef.collection('public_profile').doc(sessionId).set(publicProfile)
  }
})
