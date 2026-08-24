// Keeps users/{userId}/public_profile/{userId} in sync
import { onDocumentWritten } from 'firebase-functions/v2/firestore'

export const indexUser = onDocumentWritten('users/{userId}', async (event) => {
  const { userId } = event.params
  const after = event.data?.after
  if (!after) return

  if (!after.exists) {
    await after.ref.collection('public_profile').doc(userId).delete()
    return
  }

  const data = after.data()!

  const publicProfile = {
    displayName: data.displayName || null,
    firstname: data.firstname || null,
    lastname: data.lastname || null,
  }

  await after.ref.collection('public_profile').doc(userId).set(publicProfile)
})
