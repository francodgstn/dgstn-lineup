// Source: hmd-lineup/functions/src/sendMembershipVerificationCode/index.js
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { regionalFunctions } from '../utils/functions'
import { getTeamBySlug } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'

const CODE_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CODES_PER_HOUR = 5

export const sendMembershipVerificationCode = regionalFunctions.https.onCall(
  async (data: { email: string; teamSlug: string }, _context) => {
    const { email, teamSlug } = data
    if (!email || !teamSlug) throw new (await import('firebase-functions')).https.HttpsError('invalid-argument', 'email and teamSlug are required')

    const normalizedEmail = email.toLowerCase().trim()
    const team = await getTeamBySlug(teamSlug)
    if (!team) throw new (await import('firebase-functions')).https.HttpsError('not-found', 'Team not found')

    // Rate limiting: max 5 codes per hour per email+team
    const oneHourAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 60 * 60 * 1000))
    const recentCodes = await admin
      .firestore()
      .collection('verification_codes')
      .where('email', '==', normalizedEmail)
      .where('team_id', '==', team.id)
      .where('createdAt', '>=', oneHourAgo)
      .get()

    if (recentCodes.size >= MAX_CODES_PER_HOUR) {
      throw new (await import('firebase-functions')).https.HttpsError('resource-exhausted', 'Too many verification codes requested. Please wait before trying again.')
    }

    const code = crypto.randomInt(100000, 999999).toString()
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + CODE_EXPIRY_MS))

    await admin.firestore().collection('verification_codes').add({
      email: normalizedEmail,
      team_id: team.id,
      code,
      expiresAt,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const { html, text } = buildEmailTemplate({
      title: 'Your Lineup verification code',
      body: `
        <p>Your verification code for <strong>${team.name}</strong> is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f8f9fa;border-radius:8px;">${code}</p>
        <p>This code expires in 15 minutes.</p>
        <p>If you did not request this code, please ignore this email.</p>
      `,
    })

    await sendEmail({ to: normalizedEmail, subject: `Your Lineup verification code: ${code}`, html, text })

    return { success: true }
  }
)
