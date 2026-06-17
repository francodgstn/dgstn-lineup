/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { assertVerifiableCode } from './verificationCode'


// ─────────────────────────────────────────────────────────────────────────────
// verifyMembershipCode
// ─────────────────────────────────────────────────────────────────────────────

export const verifyMembershipCode = onCall(async (request) => {
  const data = request.data as { codeId?: string; code?: string }

  if (!data?.codeId || !data?.code) {
    throw new HttpsError('invalid-argument', 'codeId and code are required')
  }

  if (!/^\d{6}$/.test(data.code)) {
    throw new HttpsError('invalid-argument', 'Code must be 6 digits')
  }

  const codeRef = admin.firestore().collection('verification_codes').doc(data.codeId)
  const codeData = await assertVerifiableCode(codeRef, data.code)

  return { verified: true, email: codeData.email, teamId: codeData.team_id }
})

// ─────────────────────────────────────────────────────────────────────────────
// completeMembershipSignup
// ─────────────────────────────────────────────────────────────────────────────

export const completeMembershipSignup = onCall(async (request) => {
  const data = request.data as {
    codeId?: string
    contactDetails?: {
      firstname: string
      lastname: string
      phone?: string
      birthdate?: string
      notes?: string
      privacyConsent: boolean
    }
  }

  if (!data?.codeId || !data?.contactDetails) {
    throw new HttpsError('invalid-argument', 'codeId and contactDetails are required')
  }

  const { contactDetails } = data

  if (!contactDetails.firstname || !contactDetails.lastname) {
    throw new HttpsError('invalid-argument', 'firstname and lastname are required')
  }

  if (!contactDetails.privacyConsent) {
    throw new HttpsError('failed-precondition', 'Privacy consent is required')
  }

  const codeRef = admin.firestore().collection('verification_codes').doc(data.codeId)
  const codeDoc = await codeRef.get()
  if (!codeDoc.exists) throw new HttpsError('not-found', 'Invalid verification code')

  const codeData = codeDoc.data()!

  if (!codeData.verified) {
    throw new HttpsError('failed-precondition', 'Email not verified. Please verify your email first.')
  }
  if (codeData.used) {
    throw new HttpsError('already-exists', 'This verification code has already been used')
  }

  const email: string = codeData.email
  const teamId: string = codeData.team_id

  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  const teamName = team.name || 'Team'

  // Get owner emails for notification
  const ownersSnap = await admin.firestore().collection('teams').doc(teamId).collection('team_members').where('role', '==', 'owner').get()
  const ownerEmails: string[] = []
  for (const memberDoc of ownersSnap.docs) {
    const userDoc = await admin.firestore().collection('users').doc(memberDoc.id).get()
    if (userDoc.exists) {
      const ownerEmail = userDoc.get('email')
      if (ownerEmail) ownerEmails.push(ownerEmail)
    }
  }

  const sanitized = {
    firstname: contactDetails.firstname.trim(),
    lastname: contactDetails.lastname.trim(),
    phone: contactDetails.phone?.trim() || null,
    birthdate: contactDetails.birthdate ? Timestamp.fromDate(new Date(contactDetails.birthdate)) : null,
    notes: contactDetails.notes?.trim() || null,
  }

  // Create contact
  const contactRef = admin.firestore().collection('contacts').doc()
  await contactRef.set({
    firstname: sanitized.firstname,
    lastname: sanitized.lastname,
    email,
    phone: sanitized.phone,
    birthdate: sanitized.birthdate,
    notes: sanitized.notes,
    type: 'student',
    teamId,
    membership_status: 'requested',
    membership_active: false,
    archived_at: null,
    deleted_at: null,
    created_at: FieldValue.serverTimestamp(),
  })
  const contactId = contactRef.id

  // Mark code as used
  await codeRef.update({ used: true, usedAt: FieldValue.serverTimestamp(), contactId })

  // Send welcome email
  try {
    const { html, text } = buildEmailTemplate({
      title: `Welcome to ${teamName}!`,
      body: `<p>Hi ${sanitized.firstname},</p><p>Thanks for signing up with <strong>${teamName}</strong>. Your membership request has been received and is under review.</p><p>We'll be in touch soon.</p>`,
    })
    await sendEmail({ to: email, subject: `Welcome to ${teamName}!`, html, text })
    console.log(`Welcome email sent to ${email}`)
  } catch (err) {
    console.error('Error sending welcome email:', err)
  }

  // Notify owners
  for (const ownerEmail of ownerEmails) {
    try {
      const { html, text } = buildEmailTemplate({
        title: `New Member Signup: ${sanitized.firstname} ${sanitized.lastname}`,
        body: `<p>A new membership request has been submitted.</p><p><strong>Name:</strong> ${sanitized.firstname} ${sanitized.lastname}</p><p><strong>Email:</strong> ${email}</p>${sanitized.phone ? `<p><strong>Phone:</strong> ${sanitized.phone}</p>` : ''}`,
      })
      await sendEmail({ to: ownerEmail, subject: `New Member Signup: ${sanitized.firstname} ${sanitized.lastname}`, html, text })
    } catch (err) {
      console.error('Error sending owner notification:', err)
    }
  }

  return { success: true, contactId }
})
