import * as admin from 'firebase-admin'
import { regionalFunctions } from '../utils/functions'
import { isAdmin, createTeamRecord } from '../utils/teams'

export const createTeam = regionalFunctions.https.onCall(
  async (data: { name: string; description?: string }, context) => {
    if (!context.auth) throw new (await import('firebase-functions')).https.HttpsError('unauthenticated', 'Not authenticated')

    const userId = context.auth.uid
    const hasAdmin = await isAdmin(userId)
    if (!hasAdmin) throw new (await import('firebase-functions')).https.HttpsError('permission-denied', 'Admin role required to create teams')

    if (!data.name?.trim()) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'Team name is required')

    const teamId = await createTeamRecord({ name: data.name.trim(), description: data.description }, userId)
    return { teamId }
  }
)
