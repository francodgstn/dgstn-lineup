/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'


const CODE_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CODES_PER_HOUR = 5

export const sendMembershipVerificationCode = onCall(async (request) => {
  const data = request.data as { email?: string; teamId?: string }
  const { email, teamId } = data

  if (!email || !teamId) {
    throw new HttpsError('invalid-argument', 'email and teamId are required')
  }

  const normalizedEmail = email.toLowerCase().trim()
  const team = await getTeam(teamId)
  if (!team) throw new HttpsError('not-found', 'Team not found')

  const oneHourAgo = Timestamp.fromDate(new Date(Date.now() - 60 * 60 * 1000))
  const recentCodes = await admin
    .firestore()
    .collection('verification_codes')
    .where('email', '==', normalizedEmail)
    .where('team_id', '==', teamId)
    .where('createdAt', '>=', oneHourAgo)
    .get()

  if (recentCodes.size >= MAX_CODES_PER_HOUR) {
    throw new HttpsError('resource-exhausted', 'Too many verification codes requested. Please wait before trying again.')
  }

  const code = crypto.randomInt(100000, 999999).toString()
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + CODE_EXPIRY_MS))

  const docRef = await admin.firestore().collection('verification_codes').add({
    email: normalizedEmail,
    team_id: teamId,
    code,
    expiresAt,
    used: false,
    verified: false,
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  })

  const { html, text } = buildEmailTemplate({
    title: 'Your Linyup verification code',
    body: `
      <p>Your verification code for <strong>${team.name}</strong> is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f8f9fa;border-radius:8px;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not request this code, please ignore this email.</p>
    `,
  })

  await sendEmail({ to: normalizedEmail, subject: `Your Linyup verification code: ${code}`, html, text, teamId })
  console.log(`Membership verification code sent to ${normalizedEmail} for team ${teamId}`)

  return { success: true, codeId: docRef.id }
})
