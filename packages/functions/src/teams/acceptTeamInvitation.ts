import * as admin from 'firebase-admin'
import { regionalFunctions } from '../utils/functions'
import { addTeamMember, setUserCurrentTeam, getUserCurrentTeam } from '../utils/teams'

export const acceptTeamInvitation = regionalFunctions.https.onCall(
  async (data: { token: string; displayName?: string; password?: string }, context) => {
    if (!context.auth) throw new (await import('firebase-functions')).https.HttpsError('unauthenticated', 'Not authenticated')

    const { token } = data
    if (!token) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'Token is required')

    const snap = await admin.firestore().collectionGroup('team_invitations').where('token', '==', token).limit(1).get()
    if (snap.empty) throw new (await import('firebase-functions')).https.HttpsError('not-found', 'Invitation not found')

    const invDoc = snap.docs[0]
    const invitation = invDoc.data()
    const teamId = invDoc.ref.parent.parent!.id

    if (invitation.expires_at?.toDate() < new Date()) {
      throw new (await import('firebase-functions')).https.HttpsError('deadline-exceeded', 'Invitation has expired')
    }
    if (invitation.accepted_at) {
      throw new (await import('firebase-functions')).https.HttpsError('already-exists', 'Invitation already accepted')
    }

    const userId = context.auth.uid
    await addTeamMember(teamId, userId, invitation.role, invitation.invitedBy)

    const currentTeam = await getUserCurrentTeam(userId)
    if (!currentTeam) await setUserCurrentTeam(userId, teamId)

    await invDoc.ref.update({ accepted_at: admin.firestore.FieldValue.serverTimestamp(), acceptedBy: userId })

    return { teamId }
  }
)
