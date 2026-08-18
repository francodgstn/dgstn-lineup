import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { regionalFunctions } from '../utils/functions'
import { addTeamMember, setUserCurrentTeam, getUserCurrentTeam, requireExtraUserPlan } from '../utils/teams'

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

    // THE INVITE GATE ALONE IS NOT THE GATE. An invitation lives for seven days,
    // and this is the call that writes the `team_members` doc — so a team that
    // dropped below Studio after inviting somebody must not gain the seat when
    // that link is finally clicked. Re-checked here, against the plan as it is
    // NOW rather than as it was when the mail was sent.
    await requireExtraUserPlan(teamId)

    const userId = context.auth.uid
    await addTeamMember(teamId, userId, invitation.role, invitation.invitedBy)

    const currentTeam = await getUserCurrentTeam(userId)
    if (!currentTeam) await setUserCurrentTeam(userId, teamId)

    await invDoc.ref.update({ accepted_at: FieldValue.serverTimestamp(), acceptedBy: userId })

    return { teamId }
  }
)
