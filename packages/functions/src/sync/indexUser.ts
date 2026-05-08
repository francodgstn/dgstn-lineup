// Keeps users/{userId}/public_profile/{userId} in sync
import { regionalFunctions } from '../utils/functions'

export const indexUser = regionalFunctions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const { userId } = context.params

    if (!change.after.exists) {
      await change.after.ref.collection('public_profile').doc(userId).delete()
      return
    }

    const data = change.after.data()!

    const publicProfile = {
      displayName: data.displayName || null,
      firstname: data.firstname || null,
      lastname: data.lastname || null,
    }

    await change.after.ref.collection('public_profile').doc(userId).set(publicProfile)
  })
