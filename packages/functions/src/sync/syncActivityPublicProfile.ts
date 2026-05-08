// Keeps activities/{activityId}/public_profile/{activityId} in sync
import { regionalFunctions } from '../utils/functions'

export const syncActivityPublicProfile = regionalFunctions.firestore
  .document('activities/{activityId}')
  .onWrite(async (change, context) => {
    const { activityId } = context.params

    if (!change.after.exists) {
      await change.after.ref.collection('public_profile').doc(activityId).delete()
      return
    }

    const data = change.after.data()!

    const publicProfile = {
      teamId: data.teamId,
      name: data.name || '',
      description: data.description || '',
      slug: data.slug || '',
      color: data.color || null,
    }

    await change.after.ref.collection('public_profile').doc(activityId).set(publicProfile)
  })
