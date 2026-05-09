import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'

setGlobalOptions({ region: 'europe-west6' })

// TODO: port full implementation from hmd-lineup/functions/src/recalculateScores/index.js
export const recalculateScores = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')
  // TODO: implement score recalculation
  return { success: false, message: 'Not yet implemented' }
})

// TODO: port full implementation from hmd-lineup/functions/src/resetScores/index.js
export const resetScores = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')
  // TODO: implement score reset
  return { success: false, message: 'Not yet implemented' }
})
