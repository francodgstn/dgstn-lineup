import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

export const getTeamInvitationDetails = onCall(async (request) => {
  const { token } = request.data as { token: string }
  if (!token) throw new HttpsError('invalid-argument', 'Token is required')

  const snap = await admin.firestore().collectionGroup('team_invitations').where('token', '==', token).limit(1).get()
  if (snap.empty) throw new HttpsError('not-found', 'Invitation not found')

  const invitation = snap.docs[0].data()
  const teamId = snap.docs[0].ref.parent.parent!.id

  if (invitation.expires_at && invitation.expires_at.toDate() < new Date()) {
    throw new HttpsError('deadline-exceeded', 'Invitation has expired')
  }

  if (invitation.accepted_at) {
    throw new HttpsError('already-exists', 'Invitation already accepted')
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
