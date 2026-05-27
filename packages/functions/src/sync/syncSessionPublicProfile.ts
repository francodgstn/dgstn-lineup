// Keeps sessions/{sessionId}/public_profile/{sessionId} in sync
import { onDocumentWritten } from 'firebase-functions/v2/firestore'


export const syncSessionPublicProfile = onDocumentWritten('sessions/{sessionId}', async (event) => {
  const { sessionId } = event.params
  const afterRef = event.data!.after.ref

  // Remove public profile when session is deleted or booking is closed
  if (!event.data!.after.exists || !event.data!.after.data()?.allowBooking) {
    await afterRef.collection('public_profile').doc(sessionId).delete()
    return
  }

  const data = event.data!.after.data()!

  const publicProfile = {
    type: 'session',
    teamId: data.teamId,
    activityId: data.activityId || null,
    activityName: data.activityName || null,
    activityColor: data.activityColor || null,
    start: data.start,
    end: data.end,
    location: data.location || null,
    capacity: data.capacity || null,
    participants_count: data.participants_count || 0,
    allowBooking: true,
    slug: data.slug || null,
  }

  await afterRef.collection('public_profile').doc(sessionId).set(publicProfile)
})
