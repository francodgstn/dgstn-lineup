// Port from hmd-lineup/functions/src/sendTeamInvitation/index.js
// TODO: copy email template HTML from hmd-lineup and update branding to "Linyup"
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { isTeamMember, hasTeamRole, hasCapability, getTeam, requireExtraUserPlan } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { getHostingUrl } from '../utils/env'

export const sendTeamInvitation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated')

  const { teamId, email, role } = request.data as {
    teamId: string
    email: string
    role: 'manager' | 'coach' | 'viewer'
  }
  const userId = request.auth.uid

  if (!teamId || !email || !role)
    throw new HttpsError('invalid-argument', 'teamId, email, and role are required')
  if (!['manager', 'coach', 'viewer'].includes(role))
    throw new HttpsError('invalid-argument', 'Invalid role')

  const isOwner = await hasTeamRole(userId, teamId, 'owner')
  if (role === 'coach') {
    // Coach invitations are gated by the coaches.manage capability — owner and
    // manager hold it by default; a coach only if the studio granted it. This
    // lets studios delegate coach onboarding without full member management.
    const canManageCoaches = isOwner || (await hasCapability(userId, teamId, 'coaches.manage'))
    if (!canManageCoaches)
      throw new HttpsError('permission-denied', 'You do not have permission to manage coaches')
  } else if (!isOwner) {
    throw new HttpsError('permission-denied', 'Only team owners can send invitations')
  }

  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  // A SECOND USER IS A STUDIO FEATURE (`multiple_managers`). This gate used to
  // refuse the Free plan alone, which contradicted the flag and let a Coach
  // team invite managers it was never sold. Franco settled it on 2026-08-18:
  // the flag is right, so the invite follows it — and it reads the flag rather
  // than a tier literal so the two cannot drift apart again.
  //
  // The refusal is thrown for EVERY role this callable can invite, including
  // 'coach': the coaches roster that sends those is itself Studio-only, so a
  // coach invitation on a lower tier arrives from no shipped surface.
  await requireExtraUserPlan(teamId)

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
      // Pending until accepted/cancelled — the members + coaches lists filter on
      // this, and manageTeamInvitation('cancel') requires it.
      status: 'pending',
      invitedBy: userId,
      created: FieldValue.serverTimestamp(),
      expires_at: expiresAt,
    })

  // getHostingUrl(), not process.env + a local fallback: this was the only
  // place reading the raw env var, and its hardcoded 'https://linyup.com'
  // default pointed at the marketing site, which 404s on /public/*.
  const invitationUrl = `${getHostingUrl()}/public/team-invitation/${token}`

  const { html, text } = buildEmailTemplate({
    title: `You've been invited to join ${team.name} on Linyup`,
    body: `
        <p>You have been invited to join <strong>${team.name}</strong> as a <strong>${role}</strong>.</p>
        <p style="margin:16px 0;">${ctaButton(invitationUrl, 'Accept Invitation')}</p>
        <p>This invitation expires in 7 days.</p>
        <p>If you did not expect this invitation, you can safely ignore this email.</p>
      `,
  })

  await sendEmail({ to: email, subject: `Invitation to join ${team.name} on Linyup`, html, text, teamId })

  return { invitationId: invRef.id }
})
