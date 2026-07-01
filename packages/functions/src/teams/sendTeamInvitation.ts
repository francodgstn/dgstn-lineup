// Port from hmd-lineup/functions/src/sendTeamInvitation/index.js
// TODO: copy email template HTML from hmd-lineup and update branding to "Linyup"
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { regionalFunctions } from '../utils/functions'
import { isTeamMember, hasTeamRole, getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'

export const sendTeamInvitation = regionalFunctions.https.onCall(
  async (data: { teamId: string; email: string; role: 'manager' | 'coach' | 'viewer' }, context) => {
    if (!context.auth)
      throw new (await import('firebase-functions')).https.HttpsError(
        'unauthenticated',
        'Not authenticated'
      )

    const { teamId, email, role } = data
    const userId = context.auth.uid

    if (!teamId || !email || !role)
      throw new (await import('firebase-functions')).https.HttpsError(
        'invalid-argument',
        'teamId, email, and role are required'
      )
    if (!['manager', 'coach', 'viewer'].includes(role))
      throw new (await import('firebase-functions')).https.HttpsError(
        'invalid-argument',
        'Invalid role'
      )

    const isOwner = await hasTeamRole(userId, teamId, 'owner')
    if (!isOwner)
      throw new (await import('firebase-functions')).https.HttpsError(
        'permission-denied',
        'Only team owners can send invitations'
      )

    const team = await getTeam(teamId)
    if (!team)
      throw new (await import('firebase-functions')).https.HttpsError('not-found', 'Team not found')

    // The Free plan is single-user — inviting members requires a paid plan.
    // The message is a stable code the web app maps to localized copy.
    if ((team.plan ?? 'free') === 'free') {
      throw new (await import('firebase-functions')).https.HttpsError(
        'failed-precondition',
        'free-plan-single-user'
      )
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))

    const invRef = await admin
      .firestore()
      .collection('teams')
      .doc(teamId)
      .collection('team_invitations')
      .add({
        teamId,
        email: email.toLowerCase().trim(),
        role,
        token,
        invitedBy: userId,
        created: FieldValue.serverTimestamp(),
        expires_at: expiresAt,
      })

    const hostingUrl = process.env.HOSTING_URL || 'https://linyup.com'
    const invitationUrl = `${hostingUrl}/public/team-invitation/${token}`

    const { html, text } = buildEmailTemplate({
      title: `You've been invited to join ${team.name} on Linyup`,
      body: `
        <p>You have been invited to join <strong>${team.name}</strong> as a <strong>${role}</strong>.</p>
        <p><a href="${invitationUrl}" style="background:#667eea;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Accept Invitation</a></p>
        <p>This invitation expires in 7 days.</p>
        <p>If you did not expect this invitation, you can safely ignore this email.</p>
      `,
    })

    await sendEmail({ to: email, subject: `Invitation to join ${team.name} on Linyup`, html, text, teamId })

    return { invitationId: invRef.id }
  }
)
