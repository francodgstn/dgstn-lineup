import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { isAdmin, createTeamRecord } from '../utils/teams'

export const createTeam = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')

  const { name, description } = request.data as { name: string; description?: string }

  const userId = request.auth.uid
  const hasAdmin = await isAdmin(userId)
  if (!hasAdmin) throw new HttpsError('permission-denied', 'Admin role required to create teams')

  if (!name?.trim()) throw new HttpsError('invalid-argument', 'Team name is required')

  const teamId = await createTeamRecord({ name: name.trim(), description }, userId)
  return { teamId }
})
