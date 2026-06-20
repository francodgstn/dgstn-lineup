// Ported from hmd-lineup/functions/src/getInTouchForm/index.js
// HTTP endpoint for the "get in touch" contact form on team bio-links.
// Validates origin against team's allowed_origins, rate-limits by IP,
// stores submission in Firestore, and emails the team owner/manager.
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { sendEmail } from '../utils/email'
import { getTeamBySlug } from '../utils/teams'
import { detailsBox } from '../utils/emailLayout'
import { wrapInLayout } from '../utils/emailLayout'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function sanitizeText(val: unknown): string {
  if (typeof val !== 'string') return ''
  return val.replace(/<[^>]*>/g, '').trim()
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(fields)) {
    const clean = sanitizeText(val)
    if (clean) result[sanitizeText(key)] = clean
  }
  return result
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const db = admin.firestore()
  const windowKey = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS).toString()
  const ref = db
    .collection('rate_limits')
    .doc(ip.replace(/[./]/g, '_'))
    .collection('get_in_touch')
    .doc(windowKey)

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const count = snap.exists ? (snap.data()!.count as number) : 0
    if (count >= RATE_LIMIT_MAX) return false
    tx.set(ref, { count: count + 1, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
}

async function resolveTeam(slug: string): Promise<{
  email: string
  teamId: string
  teamName: string
  allowedOrigins: string[]
} | null> {
  const team = await getTeamBySlug(slug)
  if (!team) return null

  const db = admin.firestore()
  const settings = (team.settings as Record<string, unknown>) ?? {}
  const notificationType = (settings.notificationType as string) || 'owner'
  let email: string | null = null

  if (notificationType === 'custom' && settings.teamEmail) {
    email = settings.teamEmail as string
  } else {
    let ownerIdToFetch = settings.notificationOwnerUserId as string | undefined
    if (!ownerIdToFetch) {
      const snap = await db
        .collection('teams')
        .doc(team.id!)
        .collection('team_members')
        .where('role', '==', 'owner')
        .limit(1)
        .get()
      if (!snap.empty) ownerIdToFetch = snap.docs[0].id
    }
    if (ownerIdToFetch) {
      const userDoc = await db.collection('users').doc(ownerIdToFetch).get()
      if (userDoc.exists) email = userDoc.data()!.email as string
    }
  }

  if (!email) return null

  return {
    email,
    teamId: team.id!,
    teamName: team.name ?? slug,
    allowedOrigins: (settings.allowed_origins as string[]) ?? [],
  }
}

function buildNotificationEmail(fields: Record<string, string>, teamName: string): string {
  const rows = Object.entries(fields)
    .map(
      ([key, val]) =>
        `<tr><td style="padding:8px 12px;font-weight:600;color:#555;white-space:nowrap;vertical-align:top;">${key}</td><td style="padding:8px 12px;color:#333;">${val.replace(/\n/g, '<br>')}</td></tr>`
    )
    .join('')
  const table = `<table style="width:100%;border-collapse:collapse;">${rows}</table>`
  const source = teamName ? `<strong>${teamName}</strong>` : 'your website'
  const content = `
    <p>A new "get in touch" submission has been received from ${source}.</p>
    ${detailsBox({ title: 'Submission Details', content: table })}
    <p style="color:#666;font-size:14px;">Submitted at: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/Zurich' })}</p>
  `
  return wrapInLayout({ language: 'en', headerIcon: '✉️', headerTitle: 'New Message', content })
}

export const getInTouchForm = onRequest(async (req, res) => {
  const origin = req.headers.origin as string | undefined

  // Preflight: return CORS headers so browser proceeds with the POST.
  // Origin allowlist is enforced on the POST below (returns 403 if not allowed).
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', origin ?? '*')
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).send('')
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' })
    return
  }

  const { team, website, fields } = req.body ?? {}

  // Spam trap
  if (website) {
    res.status(200).json({ success: true })
    return
  }
  if (!team?.trim()) {
    res.status(400).json({ success: false, error: 'Missing required field: team' })
    return
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    res.status(400).json({ success: false, error: 'fields must be a non-empty object' })
    return
  }

  let resolved: { email: string; teamId: string; teamName: string; allowedOrigins: string[] } | null
  try {
    resolved = await resolveTeam(team.trim())
  } catch (err) {
    console.error('Failed to resolve team:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
    return
  }

  if (!resolved) {
    res.status(400).json({ success: false, error: 'Unknown team' })
    return
  }

  const { allowedOrigins } = resolved
  if (allowedOrigins.length === 0) {
    res
      .status(403)
      .json({ success: false, error: 'This team has not configured any allowed origins' })
    return
  }

  // Set CORS header based on team's allowed origins
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
  }

  // OPTIONS preflight is handled above (before the POST guard), so this is a no-op here

  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ success: false, error: 'Origin not allowed' })
    return
  }

  const sanitizedFields = sanitizeFields(fields as Record<string, unknown>)
  if (Object.keys(sanitizedFields).length === 0) {
    res.status(400).json({ success: false, error: 'fields must contain at least one value' })
    return
  }

  const emailValue = sanitizedFields.email ?? sanitizedFields.Email
  if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    res.status(400).json({ success: false, error: 'Invalid email address' })
    return
  }

  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket?.remoteAddress) || 'unknown'

  let allowed: boolean
  try {
    allowed = await checkRateLimit(ip)
  } catch (err) {
    console.error('Rate limit check failed:', err)
    allowed = true // fail open
  }

  if (!allowed) {
    res.status(429).json({ success: false, error: 'Too many submissions. Please try again later.' })
    return
  }

  try {
    await admin
      .firestore()
      .collection('teams')
      .doc(resolved.teamId)
      .collection('get_in_touch_submissions')
      .add({
        fields: sanitizedFields,
        team_id: resolved.teamId,
        team_slug: team.trim(),
        submitted_at: FieldValue.serverTimestamp(),
        source: origin ?? 'unknown',
        ip,
      })
  } catch (err) {
    console.error('Failed to store submission:', err)
    res.status(500).json({ success: false, error: 'Failed to store submission' })
    return
  }

  try {
    await sendEmail({
      to: resolved.email,
      teamId: resolved.teamId,
      subject: `New message from ${sanitizedFields.name ?? sanitizedFields.Name ?? team.trim()}`,
      html: buildNotificationEmail(sanitizedFields, resolved.teamName),
    })
  } catch (err) {
    console.error('Failed to send notification email:', err)
  }

  res.status(200).json({ success: true })
})
