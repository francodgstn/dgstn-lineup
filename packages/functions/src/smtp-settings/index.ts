/* eslint-disable no-console */
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { encryptPassword } from '../utils/crypto'
import { getSmtpTransporter, getSenderAddress } from '../utils/email'
import { hasTeamRole } from '../utils/teams'
import type { SmtpIntegration } from '@linyup/shared'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function assertTeamOwner(uid: string, teamId: string): Promise<void> {
  const ok = await hasTeamRole(uid, teamId, 'owner')
  if (!ok) throw new HttpsError('permission-denied', 'Team owner access required')
}

async function assertOrgAdmin(uid: string, orgId: string): Promise<void> {
  const memberDoc = await admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('org_members').doc(uid)
    .get()
  if (!memberDoc.exists || memberDoc.data()?.role !== 'org_admin') {
    throw new HttpsError('permission-denied', 'Organization admin access required')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// saveSmtpConfig — encrypts the SMTP password and persists the config
// ─────────────────────────────────────────────────────────────────────────────

interface SaveSmtpConfigRequest {
  scope: 'team' | 'org'
  entityId: string
  config: {
    host: string
    port: number
    secure: boolean
    user: string
    password: string       // plaintext — encrypted server-side; empty = keep existing
    from_name: string
    from_email: string
    use_org_smtp?: boolean // team scope only
  }
}

export const saveSmtpConfig = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as SaveSmtpConfigRequest

  // ── Input validation ───────────────────────────────────────────────────────
  if (!data?.scope || !['team', 'org'].includes(data.scope)) {
    throw new HttpsError('invalid-argument', 'scope must be "team" or "org"')
  }
  if (!data.entityId?.trim()) {
    throw new HttpsError('invalid-argument', 'entityId is required')
  }
  if (!data.config) {
    throw new HttpsError('invalid-argument', 'config is required')
  }

  const { scope, entityId, config } = data

  // When use_org_smtp is set we only need to store that flag, the other
  // SMTP fields can be empty. Otherwise validate the full set.
  const useOrgSmtp = scope === 'team' && config.use_org_smtp === true

  if (!useOrgSmtp) {
    if (!config.host?.trim()) throw new HttpsError('invalid-argument', 'config.host is required')
    if (!config.port || config.port < 1 || config.port > 65535) {
      throw new HttpsError('invalid-argument', 'config.port must be a valid port number (1–65535)')
    }
    if (typeof config.secure !== 'boolean') {
      throw new HttpsError('invalid-argument', 'config.secure must be a boolean')
    }
    if (!config.user?.trim()) throw new HttpsError('invalid-argument', 'config.user is required')
    if (!config.from_name?.trim()) throw new HttpsError('invalid-argument', 'config.from_name is required')
    if (!config.from_email?.trim()) throw new HttpsError('invalid-argument', 'config.from_email is required')
  }

  // ── Authorization ──────────────────────────────────────────────────────────
  if (scope === 'team') {
    await assertTeamOwner(request.auth.uid, entityId)
  } else {
    await assertOrgAdmin(request.auth.uid, entityId)
  }

  const db = admin.firestore()
  const docRef = scope === 'team'
    ? db.collection('teams').doc(entityId).collection('integrations').doc('email_smtp')
    : db.collection('organizations').doc(entityId).collection('integrations').doc('email_smtp')

  // ── Resolve encrypted password ─────────────────────────────────────────────
  let passwordEnc: string

  if (useOrgSmtp) {
    // When delegating to org SMTP the local password fields are irrelevant;
    // preserve whatever was stored or use an empty sentinel.
    const existing = await docRef.get()
    passwordEnc = existing.exists ? (existing.data() as SmtpIntegration).password_enc : ''
  } else if (config.password) {
    // Fresh password provided — encrypt it
    passwordEnc = await encryptPassword(config.password)
  } else {
    // Empty password = keep the previously stored ciphertext
    const existing = await docRef.get()
    if (!existing.exists) {
      throw new HttpsError('failed-precondition', 'No existing SMTP config found. A password is required for the initial save.')
    }
    passwordEnc = (existing.data() as SmtpIntegration).password_enc
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  const payload: Omit<SmtpIntegration, 'updatedAt'> & { updatedAt: ReturnType<typeof FieldValue.serverTimestamp> } = {
    type: 'email_smtp',
    host: useOrgSmtp ? '' : config.host.trim(),
    port: useOrgSmtp ? 0 : config.port,
    secure: useOrgSmtp ? false : config.secure,
    user: useOrgSmtp ? '' : config.user.trim(),
    password_enc: passwordEnc,
    from_name: config.from_name?.trim() ?? '',
    from_email: config.from_email?.trim() ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (scope === 'team') {
    payload.use_org_smtp = config.use_org_smtp === true
  }

  await docRef.set(payload, { merge: false })

  console.log(`saveSmtpConfig: saved SMTP config for ${scope} ${entityId}`)
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// testSmtpConfig — sends a test email using the saved config for the entity
// ─────────────────────────────────────────────────────────────────────────────

interface TestSmtpConfigRequest {
  scope: 'team' | 'org'
  entityId: string
}

export const testSmtpConfig = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const data = request.data as TestSmtpConfigRequest

  if (!data?.scope || !['team', 'org'].includes(data.scope)) {
    throw new HttpsError('invalid-argument', 'scope must be "team" or "org"')
  }
  if (!data.entityId?.trim()) {
    throw new HttpsError('invalid-argument', 'entityId is required')
  }

  const { scope, entityId } = data

  // ── Authorization ──────────────────────────────────────────────────────────
  if (scope === 'team') {
    await assertTeamOwner(request.auth.uid, entityId)
  } else {
    await assertOrgAdmin(request.auth.uid, entityId)
  }

  // ── Resolve recipient — caller's own email address ─────────────────────────
  const recipientEmail = request.auth.token.email
  if (!recipientEmail) {
    throw new HttpsError('failed-precondition', 'Your account has no email address — cannot send test email')
  }

  // ── Get transporter using the correct hierarchy ───────────────────────────
  const teamId = scope === 'team' ? entityId : undefined
  let transporter: ReturnType<typeof import('nodemailer').createTransport>

  try {
    transporter = await getSmtpTransporter(teamId)
  } catch (err) {
    console.error('testSmtpConfig: failed to resolve SMTP config:', err)
    throw new HttpsError('failed-precondition', 'No SMTP configuration found for this entity')
  }

  // ── Determine from address from the saved config ───────────────────────────
  const db = admin.firestore()
  let fromAddress: string

  try {
    const docRef = scope === 'team'
      ? db.collection('teams').doc(entityId).collection('integrations').doc('email_smtp')
      : db.collection('organizations').doc(entityId).collection('integrations').doc('email_smtp')

    const docSnap = await docRef.get()

    if (docSnap.exists) {
      const cfg = docSnap.data() as SmtpIntegration
      if (cfg.use_org_smtp !== true && cfg.from_name && cfg.from_email) {
        fromAddress = getSenderAddress({ name: cfg.from_name, email: cfg.from_email })
      } else {
        fromAddress = getSenderAddress()
      }
    } else {
      fromAddress = getSenderAddress()
    }
  } catch {
    fromAddress = getSenderAddress()
  }

  // ── Send the test email ────────────────────────────────────────────────────
  try {
    await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: 'Linyup SMTP test — configuration working',
      text: [
        'This is a test email sent by Linyup to verify your SMTP configuration.',
        '',
        'If you received this message, your outbound SMTP settings are working correctly.',
        '',
        '---',
        'Sent via Linyup (linyup.com)',
      ].join('\n'),
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:24px 20px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">Linyup SMTP Test</h1>
  </div>
  <div style="background:#fff;padding:24px 20px;border:1px solid #e0e0e0;border-top:none;">
    <p>This is a test email sent by <strong>Linyup</strong> to verify your outbound SMTP configuration.</p>
    <p>If you received this message, your SMTP settings are <strong style="color:#22c55e;">working correctly</strong>.</p>
  </div>
  <div style="background:#f8f9fa;padding:16px 20px;text-align:center;font-size:13px;color:#666;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;">
    Sent via Linyup &mdash; <a href="https://linyup.com" style="color:#667eea;text-decoration:none;">linyup.com</a>
  </div>
</body>
</html>`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('testSmtpConfig: send failed:', err)
    throw new HttpsError('internal', `SMTP test failed: ${message}`)
  }

  console.log(`testSmtpConfig: test email sent to ${recipientEmail} for ${scope} ${entityId}`)
  return { success: true, sentTo: recipientEmail }
})
