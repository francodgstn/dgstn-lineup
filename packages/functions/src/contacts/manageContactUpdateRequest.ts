// Ported from hmd-lineup/functions/src/manageContactUpdateRequest/index.js
// Admin callable — approve or discard a contact data update request.
// On approve: applies whitelisted fields to the contact, sends confirmation email.
// On discard: sends rejection email.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { hasTeamRole, getTeam } from '../utils/teams'
import { sendEmail } from '../utils/email'
import { wrapInLayout, gradients, detailsBox } from '../utils/emailLayout'
import { systemEmailEnabled } from '../utils/systemEmails'
import { formatTimestamp } from '../utils/dateFormatting'

const CONTACT_REQUESTS_SUBCOLLECTION = 'contact_requests'

const ALLOWED_UPDATE_FIELDS = [
  'firstname', 'lastname', 'phone', 'birthdate', 'gender',
  'birthplace', 'residence', 'emergencyContact', 'notes',
]

const UPDATE_REQUEST_FOOTER = `<p>Best regards,<br><strong>Linyup Team</strong></p><p>This is an automated message. Please do not reply to this email.</p>`

function buildApprovedEmail(contactName: string, teamName: string) {
  const subject = `Your data update has been approved — ${teamName}`
  const html = wrapInLayout({
    headerGradient: gradients.success,
    headerTitle: 'Data Update Approved',
    content: [
      `<p>Hello ${contactName},</p>`,
      detailsBox({
        content: `<p style="margin:0;"><strong>Your data update request for ${teamName} has been reviewed and approved.</strong></p><p style="margin:10px 0 0 0;">Your personal information has been updated successfully.</p>`,
      }),
      `<p>If you have any questions, please contact your team manager.</p>`,
    ].join('\n'),
    footerContent: UPDATE_REQUEST_FOOTER,
  })
  const text = `Hello ${contactName},\n\nYour data update request for ${teamName} has been reviewed and approved.\nYour personal information has been updated successfully.\n\nIf you have any questions, please contact your team manager.\n\nBest regards,\nLinyup Team`
  return { subject, html, text }
}

function buildDiscardedEmail(contactName: string, teamName: string) {
  const subject = `Data update request — ${teamName}`
  const html = wrapInLayout({
    headerGradient: gradients.neutral,
    headerTitle: 'Data Update Request',
    content: [
      `<p>Hello ${contactName},</p>`,
      detailsBox({
        content: `<p style="margin:0;">Your request to update your personal data for <strong>${teamName}</strong> could not be processed at this time.</p>`,
      }),
      `<p>If you believe this is an error, please contact your team manager directly.</p>`,
    ].join('\n'),
    footerContent: UPDATE_REQUEST_FOOTER,
  })
  const text = `Hello ${contactName},\n\nYour request to update your personal data for ${teamName} could not be processed at this time.\n\nIf you believe this is an error, please contact your team manager directly.\n\nBest regards,\nLinyup Team`
  return { subject, html, text }
}

export const manageContactUpdateRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const callerId = request.auth.uid
  const { teamId, requestId, action } = request.data as { teamId: string; requestId: string; action: string }

  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required')
  if (!action || !['approve', 'discard'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Valid action is required: approve or discard')
  }

  const hasPermission = await hasTeamRole(callerId, teamId, 'manager')
  if (!hasPermission) throw new HttpsError('permission-denied', 'Only team owners and managers can manage update requests')

  const db = admin.firestore()
  const requestRef = db.collection('teams').doc(teamId).collection(CONTACT_REQUESTS_SUBCOLLECTION).doc(requestId)
  const requestDoc = await requestRef.get()
  if (!requestDoc.exists) throw new HttpsError('not-found', 'Request not found')

  const requestData = requestDoc.data()!
  if (requestData.status !== 'pending') throw new HttpsError('failed-precondition', `Request is already ${requestData.status as string}`)

  const team = await getTeam(teamId)
  const teamName = team?.name ?? 'Our Team'
  const contactName = (requestData.contact_name as string) || 'Member'
  // Outcome emails to the contact are per-team toggleable (Automations → System emails).
  const notifyContact = systemEmailEnabled(team, 'contact_update_review')
  const contactEmail = notifyContact ? (requestData.contact_email as string | undefined) : undefined

  if (action === 'approve') {
    const submittedData = requestData.submitted_data as Record<string, unknown> | undefined
    if (!submittedData) throw new HttpsError('failed-precondition', 'Request has no submitted data')

    const updateData: Record<string, unknown> = {}
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (submittedData[field] !== undefined) updateData[field] = submittedData[field]
    }
    updateData.updatedAt = FieldValue.serverTimestamp()

    // Append notes instead of overwriting
    if (submittedData.notes) {
      const contactRef = db.collection('contacts').doc(requestData.contact_id as string)
      const contactDoc = await contactRef.get()
      const existingNotes = contactDoc.exists ? (contactDoc.get('notes') as string) || '' : ''
      const language = (team?.language as string) || 'en'
      const timestamp = formatTimestamp(new Date(), language)
      updateData.notes = existingNotes
        ? `${existingNotes}\n\n[${timestamp}] Data Update Request:\n${submittedData.notes as string}`
        : (submittedData.notes as string)
    }

    await db.collection('contacts').doc(requestData.contact_id as string).update(updateData)
    console.log(`Contact ${requestData.contact_id as string} updated via request ${requestId}`)

    await requestRef.update({ status: 'approved', reviewed_at: FieldValue.serverTimestamp(), reviewed_by: callerId })

    if (contactEmail) {
      try {
        const emailContent = buildApprovedEmail(contactName, teamName)
        await sendEmail({ to: contactEmail, subject: emailContent.subject, html: emailContent.html, text: emailContent.text, teamId })
        console.log(`Approval email sent to ${contactEmail}`)
      } catch (err) {
        console.error('Error sending approval email:', (err as Error).message ?? err)
      }
    }

    return { success: true, action: 'approved', contactId: requestData.contact_id }
  }

  // discard
  await requestRef.update({ status: 'discarded', reviewed_at: FieldValue.serverTimestamp(), reviewed_by: callerId })
  console.log(`Contact update request ${requestId} discarded`)

  if (contactEmail) {
    try {
      const emailContent = buildDiscardedEmail(contactName, teamName)
      await sendEmail({ to: contactEmail, subject: emailContent.subject, html: emailContent.html, text: emailContent.text, teamId })
      console.log(`Rejection email sent to ${contactEmail}`)
    } catch (err) {
      console.error('Error sending rejection email:', (err as Error).message ?? err)
    }
  }

  return { success: true, action: 'discarded' }
})
