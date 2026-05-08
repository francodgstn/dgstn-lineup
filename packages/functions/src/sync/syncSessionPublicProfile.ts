// Keeps sessions/{sessionId}/public_profile/{sessionId} in sync
import { regionalFunctions } from '../utils/functions'

export const syncSessionPublicProfile = regionalFunctions.firestore
  .document('sessions/{sessionId}')
  .onWrite(async (change, context) => {
    const { sessionId } = context.params

    if (!change.after.exists) {
      await change.after.ref.collection('public_profile').doc(sessionId).delete()
      return
    }

    const data = change.after.data()!

    const publicProfile = {
      teamId: data.teamId,
      activityId: data.activityId || null,
      activityName: data.activityName || null,
      start: data.start,
      end: data.end,
      allowBooking: data.allowBooking === true,
    }

    await change.after.ref.collection('public_profile').doc(sessionId).set(publicProfile)
  })
