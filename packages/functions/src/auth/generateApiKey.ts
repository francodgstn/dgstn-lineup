// Ported from hmd-lineup/functions/src/generateApiKey/index.js
// Generates API credentials for an authenticated user. The secret is returned once
// and never stored plaintext — only the hash is persisted.
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { generateSecureToken, hashVerificationCode } from '../utils/crypto'

const USERS_COLLECTION = 'users'

export const generateApiKey = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be authenticated to generate an API key.')

  const uid = request.auth.uid

  const [getUserErr, userSnap] = await to(admin.firestore().collection(USERS_COLLECTION).doc(uid).get())
  if (getUserErr) throw new HttpsError('internal', `Failed to read user record: ${getUserErr.message}`)

  const userData = userSnap && userSnap.exists ? userSnap.data()! : {}
  const currentTeam = (userData.currentTeam as string) || uid

  const apiKey = generateSecureToken(16)
  const apiSecret = generateSecureToken(32)
  const apiSecretHash = hashVerificationCode(apiSecret, apiKey)

  const [writeErr] = await to(
    admin.firestore().collection(USERS_COLLECTION).doc(uid).set(
      { api_key: apiKey, api_secret_hash: apiSecretHash, api_team_id: currentTeam },
      { merge: true }
    )
  )
  if (writeErr) throw new HttpsError('internal', `Failed to save API credentials: ${writeErr.message}`)

  // Return the secret once — caller must store it securely
  return { api_key: apiKey, api_secret: apiSecret }
})
