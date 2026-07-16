// Keeps sessions/{sessionId}/public_profile/{sessionId} in sync.
// Regular sessions: synced when allowBooking === true.
// Appointment sessions (activityType === 'appointment'): always synced when status !== 'cancelled'.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import type { Timestamp } from 'firebase-admin/firestore'
import { resolveActivityAccessRule } from '@linyup/shared'


export const syncSessionPublicProfile = onDocumentWritten('sessions/{sessionId}', async (event) => {
  const { sessionId } = event.params
  const afterRef = event.data!.after.ref

  const data = event.data!.after.exists ? event.data!.after.data()! : null
  const isAppointment = data?.activityType === 'appointment'

  // Remove public profile when:
  // - session deleted
  // - regular session with allowBooking disabled
  // - appointment session explicitly cancelled
  const shouldBePublic = data && (isAppointment ? data.status !== 'cancelled' : data.allowBooking === true)

  if (!shouldBePublic) {
    await afterRef.collection('public_profile').doc(sessionId).delete()
    return
  }

  if (isAppointment) {
    // Appointment session — public profile includes slot-specific fields
    const publicProfile = {
      type: 'appointment_session',
      teamId: data.teamId,
      activityType: 'appointment',
      activityName: data.activityName || null,
      providerId: data.providerId || null,
      providerName: data.providerName || null,
      templateId: data.templateId || null,
      start: data.start as Timestamp,
      end: data.end as Timestamp,
      duration_minutes: data.duration_minutes || null,
      location: data.location || null,
      onlineUrl: data.onlineUrl || null,
      max_participants: data.max_participants || null,
      bookings_count: data.bookings_count || 0,
      isFreeTrial: data.isFreeTrial !== false,
      // Appointments carry their own access gate on the session doc.
      accessRule: resolveActivityAccessRule({ accessRule: data.accessRule, isFreeTrial: data.isFreeTrial }),
      status: data.status || 'open',
      allowBooking: true,
      bookingMandatory: data.bookingMandatory === true,
    }
    await afterRef.collection('public_profile').doc(sessionId).set(publicProfile)
  } else {
    // Regular class session
    const publicProfile = {
      type: 'session',
      teamId: data.teamId,
      activityType: data.activityType || 'class',
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
      providerName: data.providerName || null,
      providerId: data.providerId || null,
      max_participants: data.max_participants || null,
      bookings_count: data.bookings_count || 0,
      bookingMandatory: data.bookingMandatory === true,
    }
    await afterRef.collection('public_profile').doc(sessionId).set(publicProfile)
  }
})
