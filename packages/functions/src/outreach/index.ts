// Ported from hmd-lineup/functions/src/sendOutreachEmail/index.js
// Sends outreach emails to one or more contacts using a team-defined template.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import { isTeamMember, requireCapability } from '../utils/teams'
import { sendEmail } from '../utils/email'
import { logActivity } from '../utils/users'
import { substituteVariables, renderBody, buildOutreachEmail } from '../utils/outreachEmail'

const TEAMS_COLLECTION = 'teams'
const CONTACTS_COLLECTION = 'contacts'
const OUTREACH_TEMPLATES_SUBCOLLECTION = 'outreach_templates'

export const sendOutreachEmail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.')

  const { contactIds, templateId, teamId } = request.data as {
    contactIds: string[]
    templateId: string
    teamId: string
  }

  console.log('[sendOutreachEmail] Called with:', { contactCount: contactIds?.length ?? 0, templateId, teamId })

  if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
    throw new HttpsError('invalid-argument', 'contactIds must be a non-empty array.')
  }
  if (!templateId) throw new HttpsError('invalid-argument', 'templateId is required.')
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required.')

  const callerId = request.auth.uid
  const db = admin.firestore()

  const [memberErr, isMember] = await to(isTeamMember(callerId, teamId))
  if (memberErr || !isMember) throw new HttpsError('permission-denied', 'You are not a member of this team.')
  // Sending outreach is a write action — viewers (read-only) may not send.
  await requireCapability(callerId, teamId, 'contacts.manage')

  const [templateErr, templateDoc] = await to(
    db.collection(TEAMS_COLLECTION).doc(teamId).collection(OUTREACH_TEMPLATES_SUBCOLLECTION).doc(templateId).get()
  )
  if (templateErr || !templateDoc || !templateDoc.exists) throw new HttpsError('not-found', 'Outreach template not found.')

  const template = templateDoc.data()!
  if (!template.active) throw new HttpsError('not-found', 'Outreach template is inactive.')

  const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
  const teamData = (!teamErr && teamDoc && teamDoc.exists ? teamDoc.data() : {}) as Record<string, unknown>
  const teamName = (teamData.name as string) || ''

  const stats = { total: contactIds.length, sent: 0, failed: 0, errors: [] as Array<{ contactId: string; error: string }> }

  await Promise.allSettled(
    contactIds.map(async (contactId) => {
      try {
        const [contactErr, contactDoc] = await to(db.collection(CONTACTS_COLLECTION).doc(contactId).get())
        if (contactErr || !contactDoc || !contactDoc.exists) throw new Error('Contact not found')

        const contact = contactDoc.data()! as Record<string, unknown>
        const contactTeamId = (contact.teamId ?? contact.teacher) as string | undefined
        if (contactTeamId !== teamId) throw new Error('Contact does not belong to this team')
        if (!contact.email) throw new Error('Contact has no email address')

        const now = new Date()
        const subject = substituteVariables(template.subject as string, contact, teamName, now, teamData)
        const rawBody = substituteVariables(template.body as string, contact, teamName, now, teamData)
        const htmlBody = renderBody(template as { body_mode?: string }, rawBody)
        const { html, text } = buildOutreachEmail({ body: htmlBody, teamName, language: (template.language as string) || 'en', teamData })

        await sendEmail({ to: contact.email as string, subject, html, text, teamId })

        await to(
          logActivity(teamId, {
            created_at: FieldValue.serverTimestamp(),
            event: 'outreach_email_sent',
            parameters: {
              description: `Outreach email "${template.name as string}" sent to ${contact.firstname as string} ${contact.lastname as string}.`,
              template_name: template.name,
              template_id: templateId,
              subject,
              automated: false,
            },
            refs: { contact: contactId, user: callerId },
          })
        )

        stats.sent++
        console.log(`[sendOutreachEmail] ✓ Sent to ${contact.email as string}`)
      } catch (error) {
        const err = error as Error
        console.error(`[sendOutreachEmail] ✗ Failed for contact ${contactId}:`, err.message)
        stats.failed++
        stats.errors.push({ contactId, error: err.message })
      }
    })
  )

  console.log(`[sendOutreachEmail] Done. Sent: ${stats.sent}, Failed: ${stats.failed}`)
  return { success: true, stats }
})
