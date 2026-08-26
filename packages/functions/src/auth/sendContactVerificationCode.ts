/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getTeam } from '../utils/teams'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { bucketRateLimit } from '../utils/rateLimit'
import { APP_CHECK_ENFORCE_MOBILE, monitorAppCheck } from '../utils/appCheck'
import { reviewAccessCodeFor } from '../ops/reviewAccess'


const CODE_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CODES_PER_HOUR = 5
const MAX_CODES_PER_IP_PER_HOUR = 20

export const sendContactVerificationCode = onCall({ enforceAppCheck: APP_CHECK_ENFORCE_MOBILE }, async (request) => {
  monitorAppCheck(request, 'sendContactVerificationCode')
  const data = request.data as { email?: string; teamId?: string }
  const { email } = data

  if (!email) {
    throw new HttpsError('invalid-argument', 'email is required')
  }

  const requestedTeamId =
    typeof data.teamId === 'string' && data.teamId.trim().length > 0
      ? data.teamId.trim()
      : null

  await bucketRateLimit({
    collection: 'auth_code_attempts',
    key: request.rawRequest?.ip,
    limit: MAX_CODES_PER_IP_PER_HOUR,
    windowMs: 3_600_000,
  })

  const normalizedEmail = email.toLowerCase().trim()

  // THE APP-STORE REVIEW ACCOUNT. Null for every ordinary caller — see
  // ops/reviewAccess.ts for why this exists and what bounds it. Resolved before
  // the per-email rate limit because it must skip that limit: five codes an
  // hour would refuse a reviewer who retries, and the app would look broken.
  const reviewCode = await reviewAccessCodeFor(normalizedEmail)

  let teamData: admin.firestore.DocumentData | null = null
  if (requestedTeamId) {
    teamData = await getTeam(requestedTeamId)
    if (!teamData) throw new HttpsError('not-found', 'Team not found')
  }

  // Rate-limit per email
  const oneHourAgo = Timestamp.fromDate(new Date(Date.now() - 60 * 60 * 1000))
  let recentCodesQuery: admin.firestore.Query = admin
    .firestore()
    .collection('verification_codes')
    .where('email', '==', normalizedEmail)
    .where('createdAt', '>=', oneHourAgo)

  if (requestedTeamId) {
    recentCodesQuery = recentCodesQuery.where('team_id', '==', requestedTeamId)
  }

  if (!reviewCode) {
    const recentCodes = await recentCodesQuery.get()
    if (recentCodes.size >= MAX_CODES_PER_HOUR) {
      throw new HttpsError('resource-exhausted', 'Too many verification codes requested. Please wait before trying again.')
    }
  }

  // Find contacts matching this email
  let contactsQuery: admin.firestore.Query = admin
    .firestore()
    .collection('contacts')
    .where('email', '==', normalizedEmail)

  if (requestedTeamId) {
    contactsQuery = contactsQuery.where('teamId', '==', requestedTeamId)
  }

  const contactsSnap = await contactsQuery.get()
  const matchedContacts = contactsSnap.docs.map((doc) => ({
    id: doc.id,
    firstname: doc.get('firstname') || '',
    lastname: doc.get('lastname') || '',
    phone: doc.get('phone') || '',
    birthdate: doc.get('birthdate') || null,
    gender: doc.get('gender') || '',
    teamId: doc.get('teamId') || null,
  }))

  // Resolve team names for all matched teams
  const matchedTeamIds = [...new Set(
    matchedContacts
      .map((c) => c.teamId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )]

  const allTeamIds = [...new Set([...matchedTeamIds, ...(requestedTeamId ? [requestedTeamId] : [])])]

  const teamNameMap: Record<string, string> = {}
  if (requestedTeamId && teamData) {
    teamNameMap[requestedTeamId] = (teamData as any).name || 'Team'
  }

  const missingTeamIds = allTeamIds.filter((id) => !teamNameMap[id])
  if (missingTeamIds.length > 0) {
    const teamDocs = await Promise.all(
      missingTeamIds.map((id) => admin.firestore().collection('teams').doc(id).get())
    )
    teamDocs.forEach((snap, i) => {
      if (snap.exists) {
        teamNameMap[missingTeamIds[i]] = snap.data()?.name || 'Team'
      }
    })
  }

  const contactsWithTeamName = matchedContacts.map((c) => ({
    ...c,
    teamName: c.teamId ? teamNameMap[c.teamId] || null : null,
  }))

  const teamSummaries = allTeamIds.length
    ? allTeamIds
        .filter((id) => teamNameMap[id])
        .map((id) => ({ id, name: teamNameMap[id] }))
    : null

  // Determine team name for the email
  let teamName = 'Linyup'
  if (requestedTeamId && teamData) {
    teamName = (teamData as any).name || teamName
  } else if (matchedTeamIds.length === 1) {
    teamName = teamNameMap[matchedTeamIds[0]] || teamName
  }

  // Generate code and store. The review account's code is FIXED and comes from
  // `app_settings/review_access`; everyone else gets a fresh random one.
  const code = reviewCode ?? crypto.randomInt(100000, 999999).toString()
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + CODE_EXPIRY_MS))

  const docRef = await admin.firestore().collection('verification_codes').add({
    email: normalizedEmail,
    team_id: requestedTeamId,
    teamIds: teamSummaries ? teamSummaries.map((t) => t.id) : null,
    teamSummaries,
    code,
    expiresAt,
    used: false,
    verified: false,
    attempts: 0,
    matchedContactIds: matchedContacts.length > 0 ? matchedContacts.map((c) => c.id) : null,
    createdAt: FieldValue.serverTimestamp(),
  })

  const { html, text } = buildEmailTemplate({
    title: 'Your Linyup verification code',
    body: `
      <p>Your verification code for <strong>${teamName}</strong> is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f8f9fa;border-radius:8px;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not request this code, please ignore this email.</p>
    `,
  })

  if (reviewCode) {
    // NOT MAILED. The reviewer already has this code from App Store Connect, and
    // sending it would put a static credential in an inbox for its whole
    // lifetime. Logged instead, so Cloud Logging can answer "was it used, when"
    // without reading the database.
    console.log(`[review-otp] issued fixed code for ${normalizedEmail}` + (requestedTeamId ? ` (team ${requestedTeamId})` : '')) // eslint-disable-line no-console
  } else {
    await sendEmail({ to: normalizedEmail, subject: `Your Linyup verification code: ${code}`, html, text, teamId: requestedTeamId ?? undefined })
    console.log(`Verification code sent to ${normalizedEmail}` + (requestedTeamId ? ` for team ${requestedTeamId}` : ''))
  }

  return {
    success: true,
    codeId: docRef.id,
    expiresAt: expiresAt.toMillis(),
    matchedContacts: matchedContacts.length > 1 ? contactsWithTeamName : null,
    teamSummaries,
  }
})
