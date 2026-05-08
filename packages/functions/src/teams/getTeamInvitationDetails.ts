import * as admin from 'firebase-admin'
import { regionalFunctions } from '../utils/functions'

export const getTeamInvitationDetails = regionalFunctions.https.onCall(async (data: { token: string }) => {
  const { token } = data
  if (!token) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'Token is required')

  const snap = await admin.firestore().collectionGroup('team_invitations').where('token', '==', token).limit(1).get()
  if (snap.empty) throw new (await import('firebase-functions')).https.HttpsError('not-found', 'Invitation not found')

  const invitation = snap.docs[0].data()
  const teamId = snap.docs[0].ref.parent.parent!.id

  if (invitation.expires_at && invitation.expires_at.toDate() < new Date()) {
    throw new (await import('firebase-functions')).https.HttpsError('deadline-exceeded', 'Invitation has expired')
  }

  if (invitation.accepted_at) {
    throw new (await import('firebase-functions')).https.HttpsError('already-exists', 'Invitation already accepted')
  }

  const teamDoc = await admin.firestore().collection('teams').doc(teamId).get()
  const team = teamDoc.data()

  return {
    invitationId: snap.docs[0].id,
    teamId,
    teamName: team?.name,
    email: invitation.email,
    role: invitation.role,
  }
})
